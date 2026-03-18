<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, toRaw } from 'vue'
import NavItem from './components/NavItem.vue'
import brandLogo from './assets/arrabida-grooves-premium-logo.png'
import brandBanner from './assets/arrabida-grooves-banner.png'

const currentView = ref('home')
const loading = ref(false)
const appMeta = ref({ version: '0.1.0', platform: 'unknown', configPath: '', backend: 'integrated', serviceOnline: true })
const serviceOnline = ref(true)
const logOutput = ref('')
const pollTimer = ref(null)
const settingsError = ref('')
const settingsSaved = ref('')
const topsUrl = ref('https://www.beatport.com/top-100')
const topsStatus = ref('')
const topsLinks = ref([])

const defaultTagMappings = {
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

const config = reactive({
  username: '',
  password: '',
  provider: 'beatport',
  quality: 'lossless',
  showProgress: true,
  writeErrorLog: false,
  downloadsDirectory: '',
  sortByContext: false,
  sortByLabel: false,
  forceReleaseDirectories: false,
  trackExists: 'update',
  trackNumberPadding: 2,
  coverSize: '1400x1400',
  keepCover: false,
  fixTags: true,
  maxGlobalWorkers: 15,
  maxDownloadWorkers: 15,
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
  proxy: '',
  theme: 'system',
  accent: 'violet',
  compact: false,
  autoTag: true,
  notifications: true
})
const tagMappingsText = ref(JSON.stringify(defaultTagMappings, null, 2))
const results = reactive({ tracks: [], releases: [] })
const jobs = ref([])
const searchQuery = ref('')
const searchStore = ref('beatport')
const quickUrl = ref('')
const searchError = ref('')

const nav = [
  { view: 'home', label: 'Home' },
  { view: 'search', label: 'Search' },
  { view: 'tops', label: 'Tops' },
  { view: 'downloads', label: 'Downloads' },
  { view: 'settings', label: 'Settings' },
  { view: 'appearance', label: 'Appearance' },
  { view: 'logs', label: 'Logs' }
]

const titles = {
  home: ['Home', 'Arrábida Grooves with fast queueing, real downloads and richer customization.'],
  search: ['Search', 'Search Beatport or Beatsource live with the credentials saved in Settings.'],
  tops: ['Tops', 'Paste a Beatport Top page and extract all track links straight into the queue.'],
  downloads: ['Downloads', 'Track queue progress without any external CLI or service.'],
  settings: ['Settings', 'Account, downloads, filenames, metadata and worker options saved locally.'],
  appearance: ['Appearance', 'Theme, accent and density are applied instantly.'],
  logs: ['Logs', 'Integrated backend events and queue activity.']
}
const title = computed(() => titles[currentView.value][0])
const subtitle = computed(() => titles[currentView.value][1])

const qualityOptions = [
  ['medium-hls', 'medium-hls · 128 kbps AAC via /stream (ffmpeg required)'],
  ['medium', 'medium · 128 kbps AAC'],
  ['high', 'high · 256 kbps AAC'],
  ['lossless', 'lossless · 44.1 kHz FLAC']
]
const trackExistsOptions = [
  ['error', 'Error and skip'],
  ['skip', 'Skip silently'],
  ['overwrite', 'Re-download'],
  ['update', 'Update tags']
]
const keySystemOptions = [
  ['standard', 'standard · Eb Minor, F Major'],
  ['standard-short', 'standard-short · Ebm, F'],
  ['openkey', 'openkey · 7m, 12d'],
  ['camelot', 'camelot · 2A, 7B']
]
const coverSizeOptions = ['500x500', '1000x1000', '1400x1400']
const trackTemplateTokens = 'id, name, mix_name, slug, artists, remixers, number, length, key, bpm, genre, subgenre, genre_with_subgenre, subgenre_or_genre, isrc, label'
const releaseTemplateTokens = 'id, name, slug, artists, remixers, date, year, track_count, bpm_range, catalog_number, upc, label'
const contextTemplateTokens = {
  playlist: 'id, name, first_genre, track_count, bpm_range, length, created_date, updated_date',
  chart: 'id, name, slug, first_genre, track_count, creator, created_date, published_date, updated_date',
  artist: 'id, name, slug',
  label: 'id, name, slug, created_date, updated_date'
}


function toPlainPayload(value) {
  return JSON.parse(JSON.stringify(toRaw(value)))
}

function applyTheme() {
  document.body.dataset.theme = config.theme === 'system' ? 'dark' : config.theme
  document.body.dataset.accent = config.accent
  document.body.dataset.compact = config.compact ? 'true' : 'false'
}

function addLog(message) {
  logOutput.value += (message.endsWith('\n') ? message : `${message}\n`)
}

async function loadConfig() {
  const data = await window.desktop.getConfig()
  Object.assign(config, data.config)
  tagMappingsText.value = JSON.stringify(data.config.tagMappings || defaultTagMappings, null, 2)
  searchStore.value = config.provider || 'beatport'
  applyTheme()
}

function parseTagMappings() {
  try {
    return JSON.parse(tagMappingsText.value || '{}')
  } catch (error) {
    throw new Error(`Invalid tag mappings JSON: ${error.message}`)
  }
}

async function saveSettings() {
  loading.value = true
  settingsError.value = ''
  settingsSaved.value = ''
  try {
    config.provider = searchStore.value
    const payload = toPlainPayload({ ...config, tagMappings: parseTagMappings() })
    await window.desktop.saveConfig(payload)
    applyTheme()
    settingsSaved.value = 'Settings saved.'
  } catch (error) {
    settingsError.value = error?.message || 'Failed to save settings.'
  } finally {
    loading.value = false
  }
}

async function search() {
  if (!searchQuery.value.trim()) return
  loading.value = true
  try {
    searchError.value = ''
    const data = await window.desktop.search({ query: searchQuery.value, store: searchStore.value })
    results.tracks = data.tracks || []
    results.releases = data.releases || []
    searchError.value = data.error || ''
  } finally {
    loading.value = false
  }
}

async function queueDownload(payload) {
  if (!payload?.url) return
  await window.desktop.addDownload({ ...payload, store: searchStore.value })
  quickUrl.value = ''
  await loadJobs()
  currentView.value = 'downloads'
}

async function scrapeTops() {
  topsStatus.value = 'Scanning page...'
  topsLinks.value = []
  const data = await window.desktop.scrapeTops({ url: topsUrl.value })
  if (!data?.ok) {
    topsStatus.value = data?.error || 'Could not scan the page.'
    return
  }
  topsLinks.value = data.links || []
  topsStatus.value = `Found ${topsLinks.value.length} track links`
}

async function addAllTopLinks() {
  if (!topsLinks.value.length) return
  for (const item of topsLinks.value) {
    await window.desktop.addDownload({ ...item, store: searchStore.value })
  }
  await loadJobs()
  currentView.value = 'downloads'
}

async function loadJobs() {
  jobs.value = await window.desktop.listDownloads()
}

async function clearCompletedJobs() {
  jobs.value = await window.desktop.clearCompletedJobs()
}

async function loadLogs() {
  const lines = await window.desktop.getLogs()
  logOutput.value = lines.join('\n') + (lines.length ? '\n' : '')
}

async function pickDirectory() {
  settingsError.value = ''
  try {
    let value = null
    if (window.desktop?.pickDirectory) {
      value = await window.desktop.pickDirectory()
    }
    if (!value && window.electronAPI?.selectFolder) {
      value = await window.electronAPI.selectFolder(config.downloadsDirectory || undefined)
    }
    if (value) {
      config.downloadsDirectory = value
      settingsSaved.value = 'Downloads directory selected.'
    }
  } catch (error) {
    settingsError.value = error?.message || 'Could not open the folder picker.'
  }
}

function external(url) {
  window.desktop.openExternal(url)
}

function resetTagMappings() {
  tagMappingsText.value = JSON.stringify(defaultTagMappings, null, 2)
}


const activeJobs = computed(() => jobs.value.filter((job) => !['completed', 'failed'].includes((job.status || '').toLowerCase())))
const completedJobs = computed(() => jobs.value.filter((job) => (job.status || '').toLowerCase() === 'completed'))
const featuredJobs = computed(() => jobs.value.slice(0, 5))

const stats = computed(() => [
  { label: 'Filename base', value: config.trackFileTemplate || '{artists} - {name}' },
  { label: 'Quality', value: config.quality || 'lossless' },
  { label: 'Queue', value: `${jobs.value.length} jobs` },
  { label: 'Folder', value: config.downloadsDirectory || 'not set' }
])

onMounted(async () => {
  window.desktop.onAppLog((msg) => addLog(msg))
  window.desktop.onJobsUpdated((nextJobs) => { jobs.value = nextJobs })
  appMeta.value = await window.desktop.getMeta()
  serviceOnline.value = !!appMeta.value.serviceOnline
  await loadConfig()
  await loadJobs()
  await loadLogs()
  pollTimer.value = setInterval(loadJobs, 5000)
})

onUnmounted(() => {
  if (pollTimer.value) clearInterval(pollTimer.value)
})
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand">
        <img class="brand-logo" :src="brandLogo" alt="Arrábida Grooves" />
        <div>
          <h1>Arrábida Grooves</h1>
          <p>Desktop edition</p>
        </div>
      </div>
      <nav class="nav">
        <NavItem v-for="item in nav" :key="item.view" :view="item.view" :label="item.label" :active="currentView === item.view" @select="currentView = $event" />
      </nav>
      <div class="sidebar-footer premium-sidebar-footer">
        <div class="sidebar-status">
          <div class="pill" :class="serviceOnline ? 'online' : 'offline'">{{ serviceOnline ? 'Integrated backend' : 'Backend offline' }}</div>
          <small>{{ appMeta.platform }} · v{{ appMeta.version }}</small>
        </div>
        <article class="sidebar-card">
          <div class="sidebar-card-head">
            <span class="eyebrow">Account</span>
            <strong>{{ config.username || 'Not connected' }}</strong>
          </div>
          <div class="mini-progress"><span :style="{ width: jobs.length ? Math.min(100, completedJobs.length / Math.max(1, jobs.length) * 100) + '%' : '8%' }"></span></div>
          <div class="sidebar-card-stats">
            <div><span>Queue</span><strong>{{ jobs.length }}</strong></div>
            <div><span>Ready</span><strong>{{ completedJobs.length }}</strong></div>
          </div>
        </article>
      </div>
    </aside>

    <main class="content">
      <header class="topbar">
        <div>
          <h2>{{ title }}</h2>
          <p>{{ subtitle }}</p>
        </div>
        <div class="topbar-actions">
          <button class="ghost" @click="loadConfig(); loadJobs(); loadLogs()">Refresh</button>
          <button class="primary" @click="saveSettings">Save</button>
        </div>
      </header>

      <section v-if="currentView === 'home'" class="view active">
        <div class="hero hero-premium">
          <img class="hero-banner" :src="brandBanner" alt="Arrábida Grooves banner" />
          <div class="hero-overlay"></div>
          <div class="hero-copy">
            <span class="eyebrow">Arrábida Grooves</span>
            <h3>Premium desktop vibes for Beatport-powered downloads</h3>
            <p>Quick Queue takes center stage, Tops can feed the queue in one shot, and the integrated desktop backend keeps real downloads, medium-hls and tag writing in one polished app.</p>
            <div class="hero-actions">
              <button class="primary glow" @click="currentView = 'search'">Search music</button>
              <button class="ghost glass" @click="currentView = 'tops'">Open Tops</button>
            </div>
          </div>
          <div class="hero-brand-chip">
            <img class="hero-brand-logo" :src="brandLogo" alt="Arrábida Grooves logo" />
            <div>
              <strong>Arrábida Grooves</strong>
              <span>Sunset edition</span>
            </div>
          </div>
        </div>

        <div class="home-grid">
          <div class="home-main-stack">
            <article class="card quick-queue-card featured-card">
              <div class="section-head"><h3>Quick Queue</h3><span class="pill hot">Hot</span></div>
              <p class="hero-hint">Paste a Beatport or Beatsource track or release URL and push it straight into the production queue.</p>
              <div class="inline-form wrap-mobile quick-queue-row premium-queue-row">
                <input v-model="quickUrl" placeholder="Paste a Beatport or Beatsource track or release URL" />
                <button class="primary large glow" @click="queueDownload({ url: quickUrl, title: quickUrl || 'Manual URL' })">Add to queue</button>
              </div>
              <div class="token-row premium-token-row">
                <span class="token">track</span><span class="token">release</span><span class="token">medium-hls</span><span class="token">tags</span><span class="token">tops</span>
              </div>
            </article>

            <div class="stats-grid premium-stats">
              <article v-for="stat in stats" :key="stat.label" class="card stat premium-stat">
                <span>{{ stat.label }}</span>
                <strong>{{ stat.value }}</strong>
              </article>
            </div>

            <div class="feature-row">
              <article class="card promo-card aqua">
                <div class="section-head"><h3>Tops automation</h3><span class="pill">New</span></div>
                <p class="hint">Paste a page like <code>https://www.beatport.com/top-100</code>, scan for track links and add everything to the queue in one step.</p>
                <button class="ghost glass" @click="currentView = 'tops'">Go to Tops</button>
              </article>
              <article class="card promo-card amber">
                <div class="section-head"><h3>Filename style</h3><span class="pill">Default</span></div>
                <p class="hint">The filename base stays on <code>{artists} - {name}</code> and all advanced template options remain available in Settings.</p>
                <div class="token-row"><span class="token">{artists}</span><span class="token">-</span><span class="token">{name}</span></div>
              </article>
            </div>
          </div>

          <aside class="home-side-stack">
            <article class="card queue-side-card">
              <div class="section-head"><h3>Download Queue</h3><span class="pill">{{ jobs.length }}</span></div>
              <div class="queue-mini-list" :class="{ empty: !featuredJobs.length }">
                <div v-if="!featuredJobs.length" class="hint">Your queue is empty. Add a track from Search, Tops or Quick Queue.</div>
                <article v-for="job in featuredJobs" :key="job.id" class="queue-mini-item">
                  <div class="queue-mini-copy">
                    <strong>{{ job.title || job.url }}</strong>
                    <span>{{ job.status || 'queued' }}</span>
                  </div>
                  <div class="mini-progress"><span :style="{ width: (job.progress || 0) + '%' }"></span></div>
                </article>
              </div>
              <div class="queue-side-actions">
                <button class="ghost glass" @click="currentView = 'downloads'">Open Downloads</button>
                <button class="ghost" @click="loadJobs">Refresh queue</button>
              </div>
            </article>

            <article class="card library-card">
              <div class="section-head"><h3>At a glance</h3></div>
              <div class="library-grid">
                <div class="library-tile">
                  <span>Active</span>
                  <strong>{{ activeJobs.length }}</strong>
                </div>
                <div class="library-tile">
                  <span>Completed</span>
                  <strong>{{ completedJobs.length }}</strong>
                </div>
                <div class="library-tile">
                  <span>Quality</span>
                  <strong>{{ config.quality }}</strong>
                </div>
                <div class="library-tile">
                  <span>Cover</span>
                  <strong>{{ config.keepCover ? 'On' : 'Off' }}</strong>
                </div>
              </div>
            </article>
          </aside>
        </div>
      </section>

      <section v-if="currentView === 'search'" class="view active">
        <article class="card toolbar">
          <div class="inline-form search-form wrap-mobile">
            <input v-model="searchQuery" placeholder="Search tracks, releases or artists" @keydown.enter.prevent="search" />
            <select v-model="searchStore">
              <option value="beatport">Beatport</option>
              <option value="beatsource">Beatsource</option>
            </select>
            <button class="primary" @click="search">Search</button>
          </div>
        </article>
        <article v-if="searchError" class="card notice error">
          <strong>Search failed</strong>
          <p>{{ searchError }}</p>
          <p class="hint">Confirma as credenciais em Settings. Esta versão usa o mesmo fluxo login → authorize → token do projeto original em Go.</p>
        </article>
        <div class="search-grid">
          <article class="card">
            <div class="section-head"><h3>Tracks</h3><span class="pill">{{ results.tracks.length }}</span></div>
            <div class="results-list" :class="{ empty: !results.tracks.length }">
              <div v-if="!results.tracks.length">Search for tracks, artists or labels. Live results appear here.</div>
              <article v-for="track in results.tracks" :key="track.id" class="result-item">
                <h4>{{ track.name }}</h4>
                <p class="result-meta">{{ track.artists }} · {{ track.genre }} · {{ track.label }}</p>
                <p class="result-meta">{{ track.bpm }} BPM · {{ track.key }} · {{ track.length }} · {{ track.date }}</p>
                <div class="result-actions">
                  <button class="ghost" @click="external(track.url)">Open</button>
                  <button class="primary" @click="queueDownload({ url: track.url, title: track.name })">Queue</button>
                </div>
              </article>
            </div>
          </article>
          <article class="card">
            <div class="section-head"><h3>Releases</h3><span class="pill">{{ results.releases.length }}</span></div>
            <div class="results-list" :class="{ empty: !results.releases.length }">
              <div v-if="!results.releases.length">Search for releases or EPs. Live results appear here.</div>
              <article v-for="release in results.releases" :key="release.id" class="result-item">
                <h4>{{ release.name }}</h4>
                <p class="result-meta">{{ release.artists }} · {{ release.label }} · {{ release.trackCount }} tracks · {{ release.date }}</p>
                <div class="result-actions">
                  <button class="ghost" @click="external(release.url)">Open</button>
                  <button class="primary" @click="queueDownload({ url: release.url, title: release.name })">Queue</button>
                </div>
              </article>
            </div>
          </article>
        </div>
      </section>

      <section v-if="currentView === 'tops'" class="view active">
        <article class="card">
          <div class="section-head"><h3>Beatport Tops to Queue</h3><span class="pill">{{ topsLinks.length }} links</span></div>
          <div class="inline-form wrap-mobile quick-queue-row">
            <input v-model="topsUrl" placeholder="Paste a Beatport Tops URL, for example https://www.beatport.com/top-100" />
            <button class="ghost" @click="scrapeTops">Scan page</button>
            <button class="primary" :disabled="!topsLinks.length" @click="addAllTopLinks">Add all to queue</button>
          </div>
          <p class="hint">This scans the page HTML for links starting with <code>https://www.beatport.com/track/</code> and adds them to the download queue.</p>
          <p v-if="topsStatus" class="hint">{{ topsStatus }}</p>
        </article>
        <article class="card">
          <div class="section-head"><h3>Detected track links</h3></div>
          <div class="results-list" :class="{ empty: !topsLinks.length }">
            <div v-if="!topsLinks.length">No track links scanned yet.</div>
            <article v-for="item in topsLinks" :key="item.url" class="result-item">
              <h4>{{ item.title }}</h4>
              <p class="result-meta">{{ item.url }}</p>
              <div class="result-actions">
                <button class="ghost" @click="external(item.url)">Open</button>
                <button class="primary" @click="queueDownload(item)">Queue</button>
              </div>
            </article>
          </div>
        </article>
      </section>

      <section v-if="currentView === 'downloads'" class="view active">
        <article class="card">
          <div class="section-head"><h3>Download queue</h3><div class="inline-form"><button class="ghost" @click="loadJobs">Refresh queue</button><button class="ghost" @click="clearCompletedJobs">Clear completed</button></div></div>
          <div class="jobs-list" :class="{ empty: !jobs.length }">
            <div v-if="!jobs.length">No jobs queued.</div>
            <article v-for="job in jobs" :key="job.id" class="job-item">
              <div class="job-header">
                <h4>#{{ job.id }} · {{ job.status }}</h4>
                <span class="pill">{{ job.progress }}%</span>
              </div>
              <p class="job-meta">{{ job.title }}</p>
              <p class="job-meta">{{ job.url }}</p>
              <div class="progress"><span :style="{ width: `${job.progress}%` }"></span></div>
              <p v-if="job.savedTo" class="job-meta">Saved to {{ job.savedTo }}</p>
              <pre v-if="job.output?.length" class="log-output compact">{{ job.output.slice(-8).join('\n') }}</pre>
            </article>
          </div>
        </article>
      </section>

      <section v-if="currentView === 'settings'" class="view active">
        <div v-if="settingsError" class="card notice error"><strong>Could not save</strong><p>{{ settingsError }}</p></div>
        <div v-if="settingsSaved" class="card notice success"><strong>{{ settingsSaved }}</strong></div>
        <form class="settings-stack" @submit.prevent="saveSettings">
          <article class="card form-card">
            <div class="section-head"><h3>Account & provider</h3></div>
            <div class="form-grid cols-2">
              <label>Username<input v-model="config.username" /></label>
              <label>Password<input v-model="config.password" type="password" /></label>
              <label>Provider
                <select v-model="searchStore">
                  <option value="beatport">Beatport</option>
                  <option value="beatsource">Beatsource</option>
                </select>
              </label>
              <label>Proxy<input v-model="config.proxy" placeholder="http://host:port" /></label>
            </div>
          </article>

          <article class="card form-card">
            <div class="section-head"><h3>Downloads & sorting</h3></div>
            <div class="form-grid cols-2">
              <label>Downloads directory
                <div class="inline-form wrap-mobile">
                  <input v-model="config.downloadsDirectory" />
                  <button type="button" class="ghost" @click="pickDirectory">Browse</button>
                </div>
              </label>
              <label>Quality
                <select v-model="config.quality">
                  <option v-for="option in qualityOptions" :key="option[0]" :value="option[0]">{{ option[1] }}</option>
                </select>
              </label>
              <label>Track exists
                <select v-model="config.trackExists">
                  <option v-for="option in trackExistsOptions" :key="option[0]" :value="option[0]">{{ option[1] }}</option>
                </select>
              </label>
              <label>Cover size
                <select v-model="config.coverSize">
                  <option v-for="option in coverSizeOptions" :key="option" :value="option">{{ option }}</option>
                </select>
              </label>
              <label>Max global workers<input v-model.number="config.maxGlobalWorkers" type="number" min="1" max="50" /></label>
              <label>Max download workers<input v-model.number="config.maxDownloadWorkers" type="number" min="1" max="50" /></label>
            </div>
            <div class="toggle-grid cols-2">
              <label class="checkbox"><input v-model="config.showProgress" type="checkbox" /> Show progress bars</label>
              <label class="checkbox"><input v-model="config.writeErrorLog" type="checkbox" /> Write error.log</label>
              <label class="checkbox"><input v-model="config.sortByContext" type="checkbox" /> Sort by context</label>
              <label class="checkbox"><input v-model="config.sortByLabel" type="checkbox" /> Sort by label</label>
              <label class="checkbox"><input v-model="config.forceReleaseDirectories" type="checkbox" /> Force release directories</label>
              <label class="checkbox"><input v-model="config.keepCover" type="checkbox" /> Keep cover.jpg</label>
              <label class="checkbox"><input v-model="config.fixTags" type="checkbox" /> Fix tags</label>
              <label class="checkbox"><input v-model="config.autoTag" type="checkbox" /> Auto-tag placeholders</label>
              <label class="checkbox"><input v-model="config.notifications" type="checkbox" /> Notifications</label>
            </div>
          </article>

          <article class="card form-card">
            <div class="section-head"><h3>Filename & directory templates</h3></div>
            <div class="form-grid cols-2">
              <label>Track file template<input v-model="config.trackFileTemplate" placeholder="{artists} - {name}" /></label>
              <label>Release directory template<input v-model="config.releaseDirectoryTemplate" /></label>
              <label>Playlist directory template<input v-model="config.playlistDirectoryTemplate" /></label>
              <label>Chart directory template<input v-model="config.chartDirectoryTemplate" /></label>
              <label>Label directory template<input v-model="config.labelDirectoryTemplate" /></label>
              <label>Artist directory template<input v-model="config.artistDirectoryTemplate" /></label>
              <label>Whitespace character<input v-model="config.whitespaceCharacter" placeholder="leave empty to preserve spaces" /></label>
              <label>Track number padding<input v-model.number="config.trackNumberPadding" type="number" min="0" max="8" /></label>
            </div>
            <div class="help-grid">
              <p class="hint"><strong>Track tokens:</strong> {{ trackTemplateTokens }}</p>
              <p class="hint"><strong>Release tokens:</strong> {{ releaseTemplateTokens }}</p>
              <p class="hint"><strong>Playlist tokens:</strong> {{ contextTemplateTokens.playlist }}</p>
              <p class="hint"><strong>Chart tokens:</strong> {{ contextTemplateTokens.chart }}</p>
              <p class="hint"><strong>Artist tokens:</strong> {{ contextTemplateTokens.artist }}</p>
              <p class="hint"><strong>Label tokens:</strong> {{ contextTemplateTokens.label }}</p>
            </div>
          </article>

          <article class="card form-card">
            <div class="section-head"><h3>Artists, keys & metadata</h3></div>
            <div class="form-grid cols-2">
              <label>Artists limit<input v-model.number="config.artistsLimit" type="number" min="1" max="20" /></label>
              <label>Artists short form<input v-model="config.artistsShortForm" placeholder="VA" /></label>
              <label>Key system
                <select v-model="config.keySystem">
                  <option v-for="option in keySystemOptions" :key="option[0]" :value="option[0]">{{ option[1] }}</option>
                </select>
              </label>
            </div>
            <label>Tag mappings (JSON)
              <textarea v-model="tagMappingsText" rows="18" spellcheck="false"></textarea>
            </label>
            <div class="inline-form wrap-mobile">
              <button type="button" class="ghost" @click="resetTagMappings">Reset tag mappings</button>
              <p class="hint">Use lowercase plus <code>_raw</code> for M4A tags you do not want uppercased, for example <code>initialkey_raw</code>.</p>
            </div>
          </article>

          <div class="actions-row"><button class="primary" type="submit">Save settings</button></div>
        </form>
      </section>

      <section v-if="currentView === 'appearance'" class="view active">
        <div class="two-col">
          <article class="card form-card">
            <div class="section-head"><h3>Theme</h3></div>
            <label>Color mode
              <select v-model="config.theme" @change="applyTheme">
                <option value="system">System</option>
                <option value="dark">Dark</option>
                <option value="light">Light</option>
              </select>
            </label>
            <label>Accent
              <select v-model="config.accent" @change="applyTheme">
                <option value="violet">Violet</option>
                <option value="cyan">Cyan</option>
                <option value="emerald">Emerald</option>
                <option value="rose">Rose</option>
              </select>
            </label>
            <label class="checkbox"><input v-model="config.compact" type="checkbox" @change="applyTheme" /> Compact density</label>
          </article>
          <article class="card">
            <div class="section-head"><h3>Preview</h3></div>
            <div class="preview-window">
              <div class="preview-bar"></div>
              <div class="preview-content">
                <div class="preview-chip">Primary</div>
                <div class="preview-chip muted">Secondary</div>
                <div class="preview-list"><div></div><div></div><div></div></div>
              </div>
            </div>
          </article>
        </div>
      </section>

      <section v-if="currentView === 'logs'" class="view active">
        <article class="card">
          <div class="section-head"><h3>Logs</h3><button class="ghost" @click="loadLogs">Refresh logs</button></div>
          <pre class="log-output">{{ logOutput || 'No logs yet.' }}</pre>
          <p class="hint">Config file: <code>{{ appMeta.configPath }}</code></p>
        </article>
      </section>
    </main>
  </div>
</template>
