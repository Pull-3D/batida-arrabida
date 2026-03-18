// @ts-nocheck
import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createDecipheriv } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'

let getMainWindow = () => null
let backendReady = false

export function registerArrabidaBackend(windowGetter) {
  getMainWindow = windowGetter || (() => null)
  if (backendReady) return
  backendReady = true
  ensureConfigLoaded()
  sendLog(`Config file: ${configPath}`)
  sendLog('Arrábida backend ready')
}

const API_CLIENT_ID = 'ryZ8LuyQVPqbK2mBX2Hwt4qSMtnWuTYSqBPO92yQ'
const TOKEN_ENDPOINT = '/auth/o/token/'
const AUTH_ENDPOINT = `/auth/o/authorize/?client_id=${API_CLIENT_ID}&response_type=code`
const LOGIN_ENDPOINT = '/auth/login/'
const SEARCH_ENDPOINT = (query) => `/catalog/search/?q=${encodeURIComponent(query)}&order_by=-publish_date&is_available_for_streaming=true`
const STORE_BASE_URL = {
  beatport: 'https://api.beatport.com/v4',
  beatsource: 'https://api.beatsource.com/v4'
}

const DEFAULT_HEADERS = {
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  'accept-language': 'en-US,en;q=0.9',
  'cache-control': 'max-age=0',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
}

const DEFAULT_TAG_MAPPINGS = {
  flac: {
    track_name: 'TITLE',
    track_artists: 'ARTIST',
    track_number: 'TRACKNUMBER',
    track_subgenre_or_genre: 'GENRE',
    track_key: 'KEY',
    track_bpm: 'BPM',
    track_isrc: 'ISRC',
    release_name: 'ALBUM',
    release_artists: 'ALBUMARTIST',
    release_date: 'DATE',
    release_track_count: 'TOTALTRACKS',
    release_catalog_number: 'CATALOGNUMBER',
    release_label: 'LABEL'
  },
  m4a: {
    track_name: 'TITLE',
    track_artists: 'ARTIST',
    track_number: 'TRACKNUMBER',
    track_genre: 'GENRE',
    track_key: 'KEY',
    track_bpm: 'BPM',
    track_isrc: 'ISRC',
    release_name: 'ALBUM',
    release_artists: 'ALBUMARTIST',
    release_date: 'DATE',
    release_track_count: 'TOTALTRACKS',
    release_catalog_number: 'CATALOGNUMBER',
    release_label: 'LABEL'
  }
}



const DEFAULT_COVER_SIZE = '1400x1400'

function ffmpegInstalled() {
  try {
    const result = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    return !result.error && result.status === 0
  } catch {
    return false
  }
}

function maybeUppercaseTag(name = '') {
  return name.endsWith('_raw') ? name.slice(0, -4) : String(name).toUpperCase()
}

function formattedImageUrl(image, size) {
  if (!image) return ''
  if (image.dynamic_uri) return String(image.dynamic_uri).replace('{w}x{h}', size)
  if (image.uri) return image.uri
  return ''
}

function requireCover() {
  const fixTags = !!config.fixTags && (config.coverSize !== DEFAULT_COVER_SIZE || config.quality !== 'lossless')
  const keepCover = !!config.keepCover && !!config.sortByContext
  return fixTags || keepCover
}

async function fetchBuffer(url, options = {}) {
  const response = await fetch(url, options)
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`request failed (${response.status}): ${text || response.statusText}`)
  }
  const ab = await response.arrayBuffer()
  return Buffer.from(ab)
}

function parseAttributeList(input = '') {
  const attrs = {}
  const regex = /([A-Z0-9-]+)=((?:"[^"]*")|[^,]*)/gi
  let match
  while ((match = regex.exec(input))) {
    const key = match[1]
    let value = match[2] || ''
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1)
    attrs[key] = value
  }
  return attrs
}

async function getStreamSegments(streamUrl) {
  const response = await fetch(streamUrl, { headers: { ...DEFAULT_HEADERS } })
  if (!response.ok) throw new Error(`stream playlist failed (${response.status}): ${response.statusText}`)
  const text = await response.text()
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const playlistUrl = new URL(streamUrl)
  const segments = []
  let key = null
  for (const line of lines) {
    if (line.startsWith('#EXT-X-KEY:')) {
      const attrs = parseAttributeList(line.slice('#EXT-X-KEY:'.length))
      if (attrs.METHOD && attrs.METHOD !== 'AES-128') throw new Error(`unsupported HLS encryption method: ${attrs.METHOD}`)
      const keyUrl = attrs.URI ? new URL(attrs.URI, playlistUrl).toString() : ''
      const keyValue = keyUrl ? await fetchBuffer(keyUrl, { headers: { ...DEFAULT_HEADERS } }) : null
      let iv = null
      if (attrs.IV) iv = Buffer.from(attrs.IV.replace(/^0x/i, ''), 'hex')
      key = { value: keyValue, iv }
      continue
    }
    if (line.startsWith('#')) continue
    segments.push(new URL(line, playlistUrl).toString())
  }
  if (!segments.length) throw new Error('stream playlist contains no segments')
  return { segments, key }
}

function decryptSegment(segmentBuffer, key, index) {
  if (!key?.value) return segmentBuffer
  const iv = key.iv || Buffer.from(index.toString(16).padStart(32, '0'), 'hex')
  const decipher = createDecipheriv('aes-128-cbc', key.value, iv)
  decipher.setAutoPadding(false)
  const decrypted = Buffer.concat([decipher.update(segmentBuffer), decipher.final()])
  const padding = decrypted[decrypted.length - 1]
  if (padding > 0 && padding <= 16) return decrypted.subarray(0, decrypted.length - padding)
  return decrypted
}

async function downloadSegments(directory, segmentUrls, key, job) {
  const tempPath = path.join(directory, `${Date.now()}-${Math.random().toString(36).slice(2)}.aac`)
  const writable = fs.createWriteStream(tempPath)
  try {
    for (let index = 0; index < segmentUrls.length; index += 1) {
      const url = segmentUrls[index]
      const encrypted = await fetchBuffer(url, { headers: { ...DEFAULT_HEADERS } })
      const decrypted = decryptSegment(encrypted, key, index)
      await new Promise((resolve, reject) => writable.write(decrypted, (err) => err ? reject(err) : resolve()))
      if (job) {
        job.progress = 35 + Math.round(((index + 1) / segmentUrls.length) * 45)
        sendJobs()
      }
    }
  } finally {
    await new Promise((resolve) => writable.end(resolve))
  }
  return tempPath
}

async function runCommand(cmd, args, context = 'command') {
  await new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${context} failed (${code}): ${stderr.trim() || 'unknown error'}`))
    })
  })
}

async function remuxToM4A(inputPath, outputPath) {
  await runCommand('ffmpeg', ['-y', '-i', inputPath, '-map_metadata', '-1', '-c:a', 'copy', outputPath], 'ffmpeg remux')
}

function buildTagValues(track) {
  const release = track.release || {}
  const releaseDate = release.new_release_date || release.date || ''
  const releaseYear = /^\d{4}/.test(releaseDate) ? releaseDate.slice(0, 4) : ''
  const releaseTrackCount = release.track_count || release.trackCount || 0
  return {
    track_id: String(track.id || ''),
    track_url: track.url || resultUrl(config.provider, 'track', track.id, track.slug),
    track_name: `${track.name || ''}${track.mix_name && track.mix_name !== 'Original Mix' ? ` (${track.mix_name})` : ''}`,
    track_artists: displayArtists(track.artists, 0, ''),
    track_remixers: displayArtists(track.remixers, 0, ''),
    track_artists_limited: displayArtists(track.artists, config.artistsLimit, config.artistsShortForm),
    track_remixers_limited: displayArtists(track.remixers, config.artistsLimit, config.artistsShortForm),
    track_number: String(track.number || 0),
    track_number_with_padding: numberWithPadding(track.number || 0, releaseTrackCount, Number(config.trackNumberPadding || 2)),
    track_number_with_total: `${track.number || 0}/${releaseTrackCount || 0}`,
    track_genre: track.genre?.name || '',
    track_subgenre: track.sub_genre?.name || '',
    track_genre_with_subgenre: genreWithSubgenre(track).replace(' - ', ' | '),
    track_subgenre_or_genre: subgenreOrGenre(track),
    track_key: displayKey(track),
    track_bpm: String(track.bpm || ''),
    track_isrc: track.isrc || '',
    release_id: String(release.id || ''),
    release_url: release.url || resultUrl(config.provider, 'release', release.id, release.slug),
    release_name: release.name || '',
    release_artists: displayArtists(release.artists, 0, ''),
    release_remixers: displayArtists(release.remixers, 0, ''),
    release_artists_limited: displayArtists(release.artists, config.artistsLimit, config.artistsShortForm),
    release_remixers_limited: displayArtists(release.remixers, config.artistsLimit, config.artistsShortForm),
    release_date: releaseDate,
    release_year: releaseYear,
    release_track_count: String(releaseTrackCount || ''),
    release_track_count_with_padding: numberWithPadding(releaseTrackCount || 0, releaseTrackCount || 0, Number(config.trackNumberPadding || 2)),
    release_catalog_number: release.catalog_number || '',
    release_upc: release.upc || '',
    release_label: release.label?.name || '',
    release_label_url: release.label?.url || ''
  }
}

async function convertCoverToJpeg(inputPath) {
  if (!inputPath) return ''
  if (!ffmpegInstalled()) throw new Error('ffmpeg not found for cover conversion')
  const outputPath = `${inputPath}.converted.jpg`
  await runCommand('ffmpeg', ['-y', '-i', inputPath, '-frames:v', '1', '-update', '1', '-q:v', '2', outputPath], 'ffmpeg cover conversion')
  return outputPath
}

async function applyTagsWithFfmpeg(filePath, track, coverPath = '', job = null) {
  if (!config.fixTags) return
  if (!ffmpegInstalled()) throw new Error('ffmpeg not found for tag writing')
  const ext = path.extname(filePath).toLowerCase()
  const format = ext === '.flac' ? 'flac' : 'm4a'
  const mappings = config.tagMappings?.[format] || {}
  const values = buildTagValues(track)
  const tempPath = `${filePath}.tagged${ext}`
  let jpegCoverPath = ''
  try {
    const args = ['-y', '-i', filePath]
    if (coverPath) {
      jpegCoverPath = await convertCoverToJpeg(coverPath)
      if (job) logJob(job, 'Converted cover art to JPEG')
      args.push('-i', jpegCoverPath)
    }
    args.push('-map_metadata', '-1', '-map', '0:a')
    if (jpegCoverPath) args.push('-map', '1:v')
    args.push('-c:a', 'copy')
    if (jpegCoverPath) {
      args.push('-c:v', 'mjpeg')
      args.push('-disposition:v:0', 'attached_pic')
      args.push('-metadata:s:v', 'title=Cover', '-metadata:s:v', 'comment=Cover (front)')
      if (job) logJob(job, 'Embedding JPEG artwork')
    }
    for (const [field, rawProperty] of Object.entries(mappings)) {
      const value = values[field]
      if (!value) continue
      const property = maybeUppercaseTag(String(rawProperty || ''))
      if (!property) continue
      args.push('-metadata', `${property}=${String(value)}`)
    }
    args.push(tempPath)
    await runCommand('ffmpeg', args, 'ffmpeg tag write')
    fs.renameSync(tempPath, filePath)
  } finally {
    if (jpegCoverPath) {
      try { fs.unlinkSync(jpegCoverPath) } catch {}
    }
  }
}

async function downloadCoverForTrack(track, directory) {
  const imageUrl = formattedImageUrl(track.release?.image, config.coverSize || DEFAULT_COVER_SIZE)
  if (!imageUrl) return ''
  const coverPath = path.join(directory, `${Date.now()}-${Math.random().toString(36).slice(2)}.cover`)
  const response = await fetch(imageUrl, { headers: { ...DEFAULT_HEADERS } })
  await saveResponseBodyToFile(response, coverPath)
  return coverPath
}

function finalizeCoverFile(coverPath) {
  if (!coverPath) return
  if (config.keepCover && config.sortByContext) {
    const target = path.join(path.dirname(coverPath), 'cover.jpg')
    if (coverPath !== target) {
      try { fs.renameSync(coverPath, target) } catch { try { fs.copyFileSync(coverPath, target) } catch {} ; try { fs.unlinkSync(coverPath) } catch {} }
    }
    return
  }
  try { fs.unlinkSync(coverPath) } catch {}
}

const DEFAULT_CONFIG = {
  username: '',
  password: '',
  quality: 'lossless',
  showProgress: true,
  writeErrorLog: false,
  downloadsDirectory: path.join(os.homedir(), 'Downloads', 'BeatportDL'),
  sortByContext: false,
  sortByLabel: false,
  forceReleaseDirectories: false,
  trackExists: 'update',
  trackNumberPadding: 2,
  coverSize: '1400x1400',
  keepCover: false,
  fixTags: true,
  tagMappings: DEFAULT_TAG_MAPPINGS,
  trackFileTemplate: '{artists} - {name}',
  releaseDirectoryTemplate: '[{catalog_number}] {artists} - {name}',
  playlistDirectoryTemplate: '{name} [{created_date}]',
  chartDirectoryTemplate: '{name} [{published_date}]',
  labelDirectoryTemplate: '{name} [{updated_date}]',
  artistDirectoryTemplate: '{name}',
  whitespaceCharacter: '',
  artistsLimit: 3,
  artistsShortForm: 'VA',
  keySystem: 'standard-short',
  maxGlobalWorkers: 15,
  maxDownloadWorkers: 15,
  proxy: '',
  theme: 'system',
  accent: 'violet',
  compact: false,
  autoTag: true,
  notifications: true,
  provider: 'beatport',
  tokenCache: {}
}

let logs = []
let jobs = []
let nextJobId = 1
let config = { ...DEFAULT_CONFIG }
let configPath = ''
let activeWorkers = 0

function toPlainJson(value) {
  return JSON.parse(JSON.stringify(value))
}

function normalizeConfig(input = {}) {
  const merged = { ...DEFAULT_CONFIG, ...toPlainJson(input || {}) }
  merged.tagMappings = toPlainJson(merged.tagMappings || DEFAULT_TAG_MAPPINGS)
  merged.tokenCache = toPlainJson(merged.tokenCache || {})
  return merged
}

function sendJobs() {
  getMainWindow?.()?.webContents.send('jobs-updated', toPlainJson(jobs))
}

function sendLog(message) {
  const line = `[${new Date().toLocaleTimeString()}] ${message}`
  logs = [...logs.slice(-399), line]
  getMainWindow?.()?.webContents.send('app-log', line)
}

function logJob(job, message) {
  job.output = [...(job.output || []), message]
  sendLog(`#${job.id} · ${message}`)
  sendJobs()
}

function configFilePath() {
  return path.join(app.getPath('userData'), 'beatportdl-desktop.json')
}

function credentialsFilePath() {
  return path.join(app.getPath('userData'), 'beatportdl-credentials.json')
}

function ensureConfigLoaded() {
  configPath = configFilePath()
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf8')
      config = normalizeConfig(JSON.parse(raw))
    } else {
      fs.mkdirSync(path.dirname(configPath), { recursive: true })
      fs.writeFileSync(configPath, JSON.stringify(normalizeConfig(DEFAULT_CONFIG), null, 2))
      config = normalizeConfig(DEFAULT_CONFIG)
      sendLog(`Created config at ${configPath}`)
    }
  } catch (error) {
    config = normalizeConfig(DEFAULT_CONFIG)
    sendLog(`Failed to load config, using defaults: ${error.message}`)
  }
}

function persistConfig() {
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  fs.writeFileSync(configPath, JSON.stringify(normalizeConfig(config), null, 2))
}

function persistCredentialsMirror() {
  const credentialPath = credentialsFilePath()
  const tokenCache = config.tokenCache?.[config.provider] || {}
  const mirror = {
    provider: config.provider,
    username: config.username,
    password: config.password,
    tokenCache
  }
  fs.writeFileSync(credentialPath, JSON.stringify(mirror, null, 2))
}

function resultUrl(store, type, id, slug = '') {
  const domain = store === 'beatsource' ? 'beatsource.com' : 'beatport.com'
  return slug
    ? `https://www.${domain}/${type}/${slug}/${id}`
    : `https://www.${domain}/${type}/${id}`
}

function displayArtists(value, limit = config.artistsLimit || 3, shortForm = config.artistsShortForm || 'VA') {
  if (!Array.isArray(value)) return value || ''
  if (shortForm && value.length > limit) return shortForm
  return value.map((entry) => entry?.name).filter(Boolean).join(', ')
}

function mapTrack(store, item) {
  return {
    id: String(item.id),
    name: `${item.name || 'Untitled'}${item.mix_name && item.mix_name !== 'Original Mix' ? ` (${item.mix_name})` : ''}`,
    artists: displayArtists(item.artists),
    genre: item.sub_genre?.name || item.genre?.name || '',
    bpm: item.bpm || '',
    key: item.key?.name || item.key?.short_name || '',
    label: item.release?.label?.name || '',
    length: item.length || '',
    date: item.publish_date || item.new_release_date || '',
    slug: item.slug || '',
    url: item.url || resultUrl(store, 'track', item.id, item.slug)
  }
}

function mapRelease(store, item) {
  return {
    id: String(item.id),
    name: item.name || 'Untitled release',
    artists: displayArtists(item.artists),
    label: item.label?.name || '',
    trackCount: item.track_count || 0,
    date: item.new_release_date || item.publish_date || '',
    slug: item.slug || '',
    url: item.url || resultUrl(store, 'release', item.id, item.slug)
  }
}

function getStoreBaseUrl(store) {
  return store === 'beatsource' ? STORE_BASE_URL.beatsource : STORE_BASE_URL.beatport
}

function loginFingerprint(store, username, password) {
  return `${store}:${username}:${password}`
}

function ensureTokenCache() {
  if (!config.tokenCache || typeof config.tokenCache !== 'object') config.tokenCache = {}
}

function getTokenRecord(store) {
  ensureTokenCache()
  return config.tokenCache[store] || null
}

function setTokenRecord(store, record) {
  ensureTokenCache()
  config.tokenCache[store] = record
  persistConfig()
  persistCredentialsMirror()
}

function clearTokenRecord(store) {
  ensureTokenCache()
  delete config.tokenCache[store]
  persistConfig()
  persistCredentialsMirror()
}

function tokenIsFresh(record) {
  if (!record?.accessToken || !record?.issuedAt || !record?.expiresIn) return false
  const now = Math.floor(Date.now() / 1000)
  return now + 300 < record.issuedAt + record.expiresIn
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    redirect: options.redirect || 'manual',
    headers: {
      ...DEFAULT_HEADERS,
      ...(options.headers || {})
    }
  })

  const text = await response.text()
  return { response, text }
}

function parseJsonSafe(text) {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function extractSessionId(response) {
  const raw = response.headers.get('set-cookie') || ''
  const match = raw.match(/sessionid=([^;]+)/i)
  return match?.[1] || ''
}

async function login(store, username, password) {
  const { response, text } = await fetchText(`${getStoreBaseUrl(store)}${LOGIN_ENDPOINT}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/plain, */*'
    },
    body: JSON.stringify({ username, password })
  })

  if (!response.ok) {
    const payload = parseJsonSafe(text)
    const detail = payload?.detail || payload?.error || text || response.statusText
    throw new Error(`login failed (${response.status}): ${detail}`)
  }

  const sessionId = extractSessionId(response)
  if (!sessionId) throw new Error('login failed: missing session cookie')
  return sessionId
}

async function authorize(store, sessionId) {
  const { response } = await fetchText(`${getStoreBaseUrl(store)}${AUTH_ENDPOINT}`, {
    method: 'GET',
    headers: {
      cookie: `sessionid=${sessionId}`
    }
  })

  const location = response.headers.get('location') || ''
  if (!location) throw new Error('authorize failed: missing redirect location')
  const parsed = new URL(location, getStoreBaseUrl(store))
  const code = parsed.searchParams.get('code')
  if (!code) throw new Error('authorize failed: missing authorization code')
  return code
}

async function issueAuthorizationCodeToken(store, code, username, password) {
  const body = new URLSearchParams({
    client_id: API_CLIENT_ID,
    grant_type: 'authorization_code',
    code
  })

  const { response, text } = await fetchText(`${getStoreBaseUrl(store)}${TOKEN_ENDPOINT}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json, text/plain, */*'
    },
    body
  })

  const payload = parseJsonSafe(text)
  if (!response.ok) {
    const detail = payload?.detail || payload?.error || text || response.statusText
    throw new Error(`token issue failed (${response.status}): ${detail}`)
  }

  const record = {
    accessToken: payload?.access_token,
    refreshToken: payload?.refresh_token,
    expiresIn: payload?.expires_in,
    tokenType: payload?.token_type,
    scope: payload?.scope,
    issuedAt: Math.floor(Date.now() / 1000),
    loginId: loginFingerprint(store, username, password)
  }
  setTokenRecord(store, record)
  return record
}

async function initToken(store, username, password) {
  sendLog(`Authenticating with ${store}`)
  const sessionId = await login(store, username, password)
  const code = await authorize(store, sessionId)
  return issueAuthorizationCodeToken(store, code, username, password)
}

async function refreshToken(store, record, username, password) {
  if (!record?.refreshToken) return initToken(store, username, password)

  const body = new URLSearchParams({
    client_id: API_CLIENT_ID,
    grant_type: 'refresh_token',
    refresh_token: record.refreshToken
  })

  const { response, text } = await fetchText(`${getStoreBaseUrl(store)}${TOKEN_ENDPOINT}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json, text/plain, */*'
    },
    body
  })

  const payload = parseJsonSafe(text)
  if (!response.ok) {
    const detail = payload?.detail || payload?.error || text || response.statusText
    clearTokenRecord(store)
    throw new Error(`token refresh failed (${response.status}): ${detail}`)
  }

  const refreshed = {
    accessToken: payload?.access_token,
    refreshToken: payload?.refresh_token || record.refreshToken,
    expiresIn: payload?.expires_in,
    tokenType: payload?.token_type,
    scope: payload?.scope,
    issuedAt: Math.floor(Date.now() / 1000),
    loginId: loginFingerprint(store, username, password)
  }
  setTokenRecord(store, refreshed)
  return refreshed
}

async function getAccessToken(store) {
  const username = (config.username || '').trim()
  const password = config.password || ''
  if (!username || !password) throw new Error('Missing username or password in Settings')

  const fingerprint = loginFingerprint(store, username, password)
  let record = getTokenRecord(store)
  if (record?.loginId !== fingerprint) {
    clearTokenRecord(store)
    record = null
  }

  if (tokenIsFresh(record)) return record.accessToken

  if (record) {
    try {
      const refreshed = await refreshToken(store, record, username, password)
      return refreshed.accessToken
    } catch (error) {
      sendLog(`Refresh failed for ${store}, retrying full auth: ${error.message}`)
    }
  }

  const fresh = await initToken(store, username, password)
  return fresh.accessToken
}

async function authFetch(store, endpoint, options = {}, allowRetry = true) {
  const token = await getAccessToken(store)
  const response = await fetch(`${getStoreBaseUrl(store)}${endpoint}`, {
    ...options,
    headers: {
      ...DEFAULT_HEADERS,
      accept: 'application/json, text/plain, */*',
      authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  })

  if (response.status === 401 && allowRetry) {
    clearTokenRecord(store)
    return authFetch(store, endpoint, options, false)
  }

  return response
}

async function fetchJsonAuthenticated(store, endpoint) {
  const response = await authFetch(store, endpoint)
  const text = await response.text()
  const payload = parseJsonSafe(text)
  if (!response.ok) {
    const detail = payload?.detail || payload?.error || text || response.statusText
    throw new Error(`request failed (${response.status}): ${detail}`)
  }
  return payload
}

async function runLiveSearch(query, store) {
  const payload = await fetchJsonAuthenticated(store, SEARCH_ENDPOINT(query))
  return {
    tracks: Array.isArray(payload?.tracks) ? payload.tracks.map((item) => mapTrack(store, item)) : [],
    releases: Array.isArray(payload?.releases) ? payload.releases.map((item) => mapRelease(store, item)) : []
  }
}

function parseBeatportUrl(inputURL) {
  const u = new URL(inputURL)
  let segments = u.pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)
  let store
  if (u.host === 'www.beatport.com' || u.host === 'api.beatport.com') store = 'beatport'
  else if (u.host === 'www.beatsource.com' || u.host === 'api.beatsource.com') store = 'beatsource'
  else throw new Error('invalid url')

  if (segments.length > 1 && segments[0].length === 2) {
    segments = segments.slice(1)
    if (segments[0] === 'catalog') segments = segments.slice(1)
  }
  if (!segments.length) throw new Error('invalid url')

  let type
  let idSegment
  switch (segments[0]) {
    case 'track': type = 'tracks'; idSegment = 2; break
    case 'release': type = 'releases'; idSegment = 2; break
    case 'tracks': type = 'tracks'; idSegment = 1; break
    case 'releases': type = 'releases'; idSegment = 1; break
    default: throw new Error(`unsupported link type: ${segments[0]}`)
  }
  if (idSegment >= segments.length) throw new Error('invalid url id')
  const id = Number(segments[idSegment])
  if (!Number.isFinite(id)) throw new Error('invalid url id')
  return { original: inputURL, type, id, params: u.searchParams.toString(), store }
}

function numberWithPadding(value, total, padding) {
  const actual = padding === 0 ? String(total || value || 0).length : padding
  return String(value || 0).padStart(actual, '0')
}

function sanitizeForPath(str = '') {
  return String(str).replace(/[\\/]/g, '').replace(/\s+/g, ' ').trim()
}

function sanitizePath(name = '', whitespace = '') {
  let value = String(name)
  if (value.length > 250) value = value.slice(0, 250)
  value = value.replace(/[<>:"|?*]/g, '')
  if (whitespace) value = value.replace(/ /g, whitespace)
  return value.replace(/\s+/g, ' ').trim()
}

function parseTemplate(template, values) {
  return String(template || '').replace(/\{(\w+)\}/g, (_, key) => (values[key] ?? `{${key}}`))
}

function displayKey(track) {
  if (config.keySystem === 'standard') return track?.key?.name || ''
  if (config.keySystem === 'openkey') return track?.key?.short_name_openkey || track?.key?.name || ''
  if (config.keySystem === 'camelot') return track?.key?.short_name_camelot || track?.key?.name || ''
  return track?.key?.short_name || track?.key?.name || ''
}

function subgenreOrGenre(track) {
  return track?.sub_genre?.name || track?.genre?.name || ''
}

function genreWithSubgenre(track) {
  return track?.sub_genre?.name ? `${track.genre?.name || ''} - ${track.sub_genre.name}` : (track?.genre?.name || '')
}

function trackFilename(track) {
  const values = {
    id: String(track.id),
    name: sanitizeForPath(track.name || ''),
    slug: track.slug || '',
    mix_name: sanitizeForPath(track.mix_name || ''),
    artists: sanitizeForPath(displayArtists(track.artists)),
    remixers: sanitizeForPath(displayArtists(track.remixers)),
    number: numberWithPadding(track.number || 0, track.release?.track_count || track.release?.trackCount || 0, Number(config.trackNumberPadding || 2)),
    length: track.length || '',
    key: displayKey(track),
    bpm: String(track.bpm || ''),
    genre: sanitizeForPath(track.genre?.name || ''),
    subgenre: sanitizeForPath(track.sub_genre?.name || ''),
    genre_with_subgenre: sanitizeForPath(genreWithSubgenre(track)),
    subgenre_or_genre: sanitizeForPath(subgenreOrGenre(track)),
    isrc: track.isrc || '',
    label: sanitizeForPath(track.release?.label?.name || '')
  }
  return sanitizePath(parseTemplate(config.trackFileTemplate || '{artists} - {name}', values), config.whitespaceCharacter || '')
}

function releaseDirectoryName(release) {
  const date = release.new_release_date || release.date || ''
  const year = /^\d{4}/.test(date) ? date.slice(0, 4) : ''
  const bpmRange = release.bpm_range ? `${release.bpm_range.min}-${release.bpm_range.max}` : ''
  const values = {
    id: String(release.id),
    name: sanitizeForPath(release.name || ''),
    slug: release.slug || '',
    artists: sanitizeForPath(displayArtists(release.artists)),
    remixers: sanitizeForPath(displayArtists(release.remixers)),
    date,
    year,
    track_count: numberWithPadding(release.track_count || 0, release.track_count || 0, Number(config.trackNumberPadding || 2)),
    bpm_range: bpmRange,
    catalog_number: sanitizeForPath(release.catalog_number || ''),
    upc: release.upc || '',
    label: sanitizeForPath(release.label?.name || '')
  }
  return sanitizePath(parseTemplate(config.releaseDirectoryTemplate || '[{catalog_number}] {artists} - {name}', values), config.whitespaceCharacter || '')
}

function ensureDirectoryForTrack(track, release = null) {
  let baseDir = config.downloadsDirectory || DEFAULT_CONFIG.downloadsDirectory
  const effectiveRelease = release || track.release || null
  if (config.sortByContext && effectiveRelease) {
    if (config.sortByLabel && effectiveRelease.label?.name) baseDir = path.join(baseDir, sanitizePath(effectiveRelease.label.name, config.whitespaceCharacter || ''))
    baseDir = path.join(baseDir, releaseDirectoryName(effectiveRelease))
  }
  fs.mkdirSync(baseDir, { recursive: true })
  return baseDir
}

function extensionFromQuality(download) {
  switch (download?.stream_quality) {
    case '.128k.aac.mp4': return '.m4a'
    case '.256k.aac.mp4': return '.m4a'
    case '.flac': return '.flac'
    default: throw new Error(`invalid stream quality: ${download?.stream_quality || 'unknown'}`)
  }
}

function nextAvailablePath(basePath, trackExists) {
  if (!fs.existsSync(basePath)) return { path: basePath, action: 'write' }
  switch (trackExists) {
    case 'skip':
      return { path: basePath, action: 'skip' }
    case 'error':
      throw new Error('file already exists')
    case 'overwrite':
      return { path: basePath, action: 'overwrite' }
    case 'update':
      return { path: basePath, action: 'overwrite' }
    default:
      return { path: basePath, action: 'overwrite' }
  }
}

async function saveResponseBodyToFile(response, outputPath) {
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`download failed (${response.status}): ${text || response.statusText}`)
  }
  if (!response.body) throw new Error('download failed: empty response body')
  const writable = fs.createWriteStream(outputPath)
  await pipeline(Readable.fromWeb(response.body), writable)
}

async function downloadTrackAudio(store, track, job, sharedCoverPath = '') {
  logJob(job, `Resolving download for track ${track.id}`)
  const directory = ensureDirectoryForTrack(track)
  const filename = trackFilename(track)

  let extension = '.m4a'
  let download = null
  let stream = null
  if (config.quality === 'medium-hls') {
    if (!ffmpegInstalled()) throw new Error('ffmpeg not found; medium-hls requires ffmpeg')
    stream = await fetchJsonAuthenticated(store, `/catalog/tracks/${track.id}/stream/`)
    extension = '.m4a'
  } else {
    download = await fetchJsonAuthenticated(store, `/catalog/tracks/${track.id}/download/?quality=${encodeURIComponent(config.quality)}`)
    extension = extensionFromQuality(download)
  }

  const basePath = path.join(directory, `${filename}${extension}`)
  const decision = nextAvailablePath(basePath, config.trackExists)
  if (decision.action === 'skip') {
    logJob(job, `Skipped existing file: ${decision.path}`)
    return { savedTo: decision.path, skipped: true }
  }

  job.status = 'downloading'
  job.progress = 55
  sendJobs()
  logJob(job, `Downloading audio to ${decision.path}`)

  if (download) {
    const response = await fetch(download.location, { headers: { ...DEFAULT_HEADERS } })
    await saveResponseBodyToFile(response, decision.path)
  } else if (stream?.stream_url) {
    logJob(job, 'Downloading HLS stream')
    const { segments, key } = await getStreamSegments(stream.stream_url)
    const segmentsFile = await downloadSegments(directory, segments, key, job)
    try {
      await remuxToM4A(segmentsFile, decision.path)
    } finally {
      try { fs.unlinkSync(segmentsFile) } catch {}
    }
  } else {
    throw new Error('download failed: missing stream or direct download location')
  }

  let coverPath = sharedCoverPath
  if (!coverPath && requireCover()) {
    try {
      coverPath = await downloadCoverForTrack(track, directory)
      logJob(job, 'Downloaded cover art raw')
    } catch (error) {
      logJob(job, `Cover download skipped: ${error.message}`)
    }
  }

  if (config.fixTags) {
    job.progress = 92
    sendJobs()
    logJob(job, 'Writing tags')
    await applyTagsWithFfmpeg(decision.path, track, coverPath, job)
  }

  if (coverPath && !sharedCoverPath) finalizeCoverFile(coverPath)
  return { savedTo: decision.path }
}

async function fetchTrack(store, id) {
  return fetchJsonAuthenticated(store, `/catalog/tracks/${id}/`)
}

async function fetchRelease(store, id) {
  return fetchJsonAuthenticated(store, `/catalog/releases/${id}/`)
}

async function fetchReleaseTracks(store, id, params = '') {
  const collected = []
  let page = 1
  while (true) {
    const suffix = params ? `&${params}` : ''
    const payload = await fetchJsonAuthenticated(store, `/catalog/releases/${id}/tracks/?page=${page}${suffix}`)
    const batch = Array.isArray(payload?.results) ? payload.results : []
    collected.push(...batch)
    if (!payload?.next) break
    page += 1
  }
  return collected
}

async function processTrackJob(job, parsed) {
  job.status = 'authenticating'
  job.progress = 10
  sendJobs()
  await getAccessToken(parsed.store)
  logJob(job, 'Authentication OK')

  job.status = 'resolving'
  job.progress = 25
  sendJobs()
  const track = await fetchTrack(parsed.store, parsed.id)
  logJob(job, `Resolved track: ${track.name} (${track.mix_name || 'Original Mix'})`)

  const result = await downloadTrackAudio(parsed.store, track, job)
  job.status = 'completed'
  job.progress = 100
  job.savedTo = result.savedTo
  logJob(job, result.skipped ? 'Completed (existing file kept)' : `Completed: ${result.savedTo}`)
}

async function processReleaseJob(job, parsed) {
  job.status = 'authenticating'
  job.progress = 10
  sendJobs()
  await getAccessToken(parsed.store)
  logJob(job, 'Authentication OK')

  job.status = 'resolving'
  job.progress = 20
  sendJobs()
  const release = await fetchRelease(parsed.store, parsed.id)
  const tracks = await fetchReleaseTracks(parsed.store, parsed.id, parsed.params || '')
  logJob(job, `Resolved release: ${release.name} (${tracks.length} tracks)`)

  let sharedCoverPath = ''
  if (requireCover() && tracks.length) {
    try {
      const releaseDir = ensureDirectoryForTrack({ release })
      sharedCoverPath = await downloadCoverForTrack({ release }, releaseDir)
      logJob(job, 'Downloaded release cover art')
    } catch (error) {
      logJob(job, `Release cover skipped: ${error.message}`)
    }
  }

  let completed = 0
  try {
    for (const track of tracks) {
      track.release = track.release || release
      const progressBase = 20 + Math.round((completed / Math.max(tracks.length, 1)) * 65)
      job.progress = progressBase
      job.status = 'downloading'
      sendJobs()
      logJob(job, `Downloading track ${completed + 1}/${tracks.length}: ${track.name}`)
      await downloadTrackAudio(parsed.store, track, job, sharedCoverPath)
      completed += 1
    }
  } finally {
    if (sharedCoverPath) finalizeCoverFile(sharedCoverPath)
  }

  job.status = 'completed'
  job.progress = 100
  logJob(job, `Completed release: ${release.name}`)
}

function writeErrorLog(job, error) {
  if (!config.writeErrorLog) return
  const targetDir = config.downloadsDirectory || DEFAULT_CONFIG.downloadsDirectory
  fs.mkdirSync(targetDir, { recursive: true })
  const file = path.join(targetDir, 'error.log')
  fs.appendFileSync(file, `[${new Date().toISOString()}] #${job.id} ${job.url}\n${error?.stack || error?.message || String(error)}\n\n`)
}

async function processJob(job) {
  try {
    const parsed = parseBeatportUrl(job.url)
    if (job.store !== parsed.store) job.store = parsed.store
    if (parsed.type === 'tracks') await processTrackJob(job, parsed)
    else if (parsed.type === 'releases') await processReleaseJob(job, parsed)
    else throw new Error(`Unsupported item type: ${parsed.type}`)
  } catch (error) {
    job.status = 'failed'
    job.progress = 100
    job.error = error?.message || String(error)
    logJob(job, `Failed: ${job.error}`)
    writeErrorLog(job, error)
  } finally {
    sendJobs()
  }
}

async function processQueue() {
  if (activeWorkers >= Math.max(1, Number(config.maxDownloadWorkers || 1))) return
  const next = jobs.find((job) => job.status === 'queued')
  if (!next) return
  activeWorkers += 1
  processJob(next)
    .finally(() => {
      activeWorkers -= 1
      processQueue()
    })
  processQueue()
}

ipcMain.handle('dialog:pick-directory', async () => {
  const result = await dialog.showOpenDialog(getMainWindow?.() || undefined, { properties: ['openDirectory', 'createDirectory'] })
  return result.canceled ? null : result.filePaths[0]
})
ipcMain.handle('shell:open-external', async (_, url) => shell.openExternal(url))
ipcMain.handle('app:meta', async () => ({
  version: app.getVersion(),
  platform: process.platform,
  configPath,
  backend: 'integrated-js-go-style',
  serviceOnline: true
}))

ipcMain.handle('config:get', async () => ({ config: normalizeConfig(config) }))
ipcMain.handle('config:set', async (_, nextConfig) => {
  config = normalizeConfig({ ...config, ...toPlainJson(nextConfig || {}) })
  persistConfig()
  persistCredentialsMirror()
  sendLog('Settings saved')
  return { ok: true }
})
ipcMain.handle('search:run', async (_, { query, store }) => {
  const selectedStore = store === 'beatsource' ? 'beatsource' : 'beatport'
  try {
    const data = await runLiveSearch(query, selectedStore)
    sendLog(`Search for “${query}” on ${selectedStore} returned ${data.tracks.length + data.releases.length} results`)
    return { ...data, error: null }
  } catch (error) {
    sendLog(`Search failed for “${query}” on ${selectedStore}: ${error.message}`)
    return { tracks: [], releases: [], error: error.message }
  }
})

ipcMain.handle('tops:scrape', async (_event, payload = {}) => {
  const inputUrl = String(payload?.url || '').trim()
  if (!inputUrl) return { ok: false, error: 'Missing URL', links: [] }
  let target
  try {
    target = new URL(inputUrl)
  } catch {
    return { ok: false, error: 'Invalid URL', links: [] }
  }
  if (!/beatport\.com$/i.test(target.hostname)) {
    return { ok: false, error: 'Only beatport.com links are supported', links: [] }
  }
  try {
    sendLog(`Scraping Top page ${target.toString()}`)
    const response = await fetch(target.toString(), {
      headers: {
        ...DEFAULT_HEADERS,
        'user-agent': DEFAULT_HEADERS['User-Agent'] || DEFAULT_HEADERS['user-agent'] || 'Mozilla/5.0',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`HTTP ${response.status}: ${text || response.statusText}`)
    }
    const html = await response.text()

    const matches = new Set()

    for (const match of html.matchAll(/https:\/\/www\.beatport\.com\/track\/[^"'\s<)]+\/\d+/g)) {
      matches.add(match[0])
    }

    for (const match of html.matchAll(/(?:href|url|pathname|canonical)=["']?(\/track\/[^"'\s<)]+\/\d+)/g)) {
      const rel = match[1]
      if (rel) matches.add(`https://www.beatport.com${rel}`)
    }

    for (const match of html.matchAll(/"\/track\/([^"\\]+)\/(\d+)"/g)) {
      matches.add(`https://www.beatport.com/track/${match[1]}/${match[2]}`)
    }

    const found = Array.from(matches)
      .filter((url) => /https:\/\/www\.beatport\.com\/track\/[^/]+\/\d+$/i.test(url))
      .sort()

    sendLog(`Top scrape found ${found.length} track links`)
    return {
      ok: true,
      links: found.map((url) => ({
        url,
        title: decodeURIComponent((url.split('/').slice(-2, -1)[0] || 'Beatport Track').replace(/-/g, ' '))
      }))
    }
  } catch (error) {
    sendLog(`Top scrape failed: ${error.message}`)
    return { ok: false, error: error.message, links: [] }
  }
})

ipcMain.handle('downloads:list', async () => toPlainJson(jobs))
ipcMain.handle('downloads:add', async (_, payload) => {
  const title = payload?.title || payload?.url || 'Queued item'
  const job = {
    id: nextJobId++,
    title,
    url: payload?.url || '',
    store: payload?.store || config.provider,
    status: 'queued',
    progress: 0,
    createdAt: new Date().toISOString(),
    output: ['Added to queue']
  }
  jobs = [job, ...jobs].slice(0, 100)
  sendLog(`Queued ${title}`)
  sendJobs()
  processQueue()
  return toPlainJson(job)
})
ipcMain.handle('logs:list', async () => toPlainJson(logs))
ipcMain.handle('jobs:clear-completed', async () => {
  jobs = jobs.filter((job) => job.status !== 'completed')
  sendJobs()
  sendLog('Cleared completed jobs')
  return toPlainJson(jobs)
})
