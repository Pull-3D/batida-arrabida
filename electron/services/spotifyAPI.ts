import * as https from 'https'
import { randomBytes, createHash } from 'crypto'

export interface SpotifyTrack {
  id: string
  name: string
  artists: Array<{ id: string; name: string }>
  album: {
    id: string
    name: string
    images: Array<{ url: string; width: number; height: number }>
    release_date: string
  }
  duration_ms: number
  explicit: boolean
  external_ids?: {
    isrc?: string
  }
  preview_url: string | null
  popularity: number
}

export interface SpotifyAlbum {
  id: string
  name: string
  artists: Array<{ id: string; name: string }>
  images: Array<{ url: string; width: number; height: number }>
  release_date: string
  total_tracks: number
  tracks: {
    items: SpotifyTrack[]
    total: number
  }
  label: string
  genres: string[]
}

export interface SpotifyPlaylist {
  id: string
  name: string
  description: string
  owner?: { id: string; display_name: string }
  images: Array<{ url: string; width: number; height: number }>
  tracks?: {
    items: Array<{ track: SpotifyTrack | null }>
    total: number
  }
  items?: {
    href?: string
    limit?: number
    next?: string | null
    offset?: number
    previous?: string | null
    total?: number
    items: Array<{ item: SpotifyTrack | null }>
  }
  public: boolean
}

export interface SpotifyArtist {
  id: string
  name: string
  images: Array<{ url: string; width: number; height: number }>
  genres: string[]
  followers: { total: number }
  popularity: number
}

interface TokenResponse {
  access_token: string
  token_type: string
  expires_in: number
  refresh_token?: string
  scope?: string
}

interface AuthSession {
  codeVerifier: string
  state: string
  redirectUri: string
  scopes: string[]
  createdAt: number
}

class SpotifyAPI {
  private accessToken: string | null = null
  private refreshToken: string | null = null
  private tokenExpiry = 0
  private clientId = ''
  private lastScope = ''
  private authSession: AuthSession | null = null

  setClientId(clientId: string): void {
    if (this.clientId !== clientId) {
      this.accessToken = null
      this.refreshToken = null
      this.tokenExpiry = 0
      this.lastScope = ''
      this.authSession = null
    }
    this.clientId = clientId.trim()
  }

  restoreSession(clientId: string, refreshToken: string): void {
    this.clientId = clientId.trim()
    this.refreshToken = refreshToken.trim()
    this.accessToken = null
    this.tokenExpiry = 0
  }

  hasClientId(): boolean {
    return !!this.clientId
  }

  hasCredentials(): boolean {
    return this.hasClientId()
  }

  isAuthenticated(): boolean {
    return !!(this.accessToken || this.refreshToken)
  }

  getRefreshToken(): string | null {
    return this.refreshToken
  }

  getStatus(): { configured: boolean; authenticated: boolean; tokenExpiresAt: number | null; scopes: string[] } {
    return {
      configured: this.hasClientId(),
      authenticated: this.isAuthenticated(),
      tokenExpiresAt: this.tokenExpiry || null,
      scopes: this.lastScope ? this.lastScope.split(' ').filter(Boolean) : []
    }
  }

  logout(clearClientId = false): void {
    this.accessToken = null
    this.refreshToken = null
    this.tokenExpiry = 0
    this.lastScope = ''
    this.authSession = null
    if (clearClientId) {
      this.clientId = ''
    }
  }

  createAuthorizationUrl(redirectUri: string, scopes: string[] = []): string {
    if (!this.clientId) {
      throw new Error('Spotify Client ID is not configured')
    }

    const state = this.generateRandomString(16)
    const codeVerifier = this.generateRandomString(64)
    const codeChallenge = this.base64UrlEncode(createHash('sha256').update(codeVerifier).digest())

    this.authSession = {
      codeVerifier,
      state,
      redirectUri,
      scopes,
      createdAt: Date.now()
    }

    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      code_challenge_method: 'S256',
      code_challenge: codeChallenge,
      state
    })

    if (scopes.length > 0) {
      params.set('scope', scopes.join(' '))
    }

    return `https://accounts.spotify.com/authorize?${params.toString()}`
  }

  async handleCallback(code: string, state: string): Promise<void> {
    if (!this.clientId) {
      throw new Error('Spotify Client ID is not configured')
    }
    if (!this.authSession) {
      throw new Error('Spotify login session not found. Start the login flow again.')
    }
    if (Date.now() - this.authSession.createdAt > 10 * 60 * 1000) {
      this.authSession = null
      throw new Error('Spotify login session expired. Start the login flow again.')
    }
    if (this.authSession.state !== state) {
      this.authSession = null
      throw new Error('Invalid Spotify login state')
    }

    const session = this.authSession
    const response = await this.makeRequest<TokenResponse>({
      hostname: 'accounts.spotify.com',
      path: '/api/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: this.clientId,
        code,
        redirect_uri: session.redirectUri,
        code_verifier: session.codeVerifier
      }).toString()
    })

    this.setTokenResponse(response)
    this.authSession = null
  }

  async authenticate(): Promise<boolean> {
    if (!this.refreshToken) {
      return false
    }

    try {
      await this.refreshAccessToken()
      return true
    } catch (error: any) {
      console.error('[SpotifyAPI] Token refresh failed:', error.message)
      this.accessToken = null
      this.tokenExpiry = 0
      return false
    }
  }

  private async refreshAccessToken(): Promise<void> {
    if (!this.clientId || !this.refreshToken) {
      throw new Error('Spotify refresh token is not configured')
    }

    const response = await this.makeRequest<TokenResponse>({
      hostname: 'accounts.spotify.com',
      path: '/api/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: this.clientId,
        refresh_token: this.refreshToken
      }).toString()
    })

    this.setTokenResponse(response)
  }

  private setTokenResponse(response: TokenResponse): void {
    this.accessToken = response.access_token
    if (response.refresh_token) {
      this.refreshToken = response.refresh_token
    }
    this.lastScope = response.scope || this.lastScope
    this.tokenExpiry = Date.now() + Math.max(response.expires_in - 300, 60) * 1000
  }

  private async ensureToken(): Promise<void> {
    if (!this.clientId) {
      throw new Error('Spotify Client ID is not configured')
    }
    if (!this.accessToken || Date.now() >= this.tokenExpiry) {
      const success = await this.authenticate()
      if (!success) {
        throw new Error('Spotify login required. Connect your Spotify account in Settings.')
      }
    }
  }

  private makeRequest<T>(options: {
    hostname: string
    path: string
    method?: string
    headers?: Record<string, string>
    body?: string
  }): Promise<T> {
    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: options.hostname,
        path: options.path,
        method: options.method || 'GET',
        headers: options.headers
      }, (res) => {
        let data = ''
        res.on('data', chunk => data += chunk)
        res.on('end', () => {
          try {
            const parsed = data ? JSON.parse(data) : {}
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(parsed.error?.message || parsed.error_description || `HTTP ${res.statusCode}`))
            } else {
              resolve(parsed)
            }
          } catch (e) {
            reject(new Error('Failed to parse Spotify response'))
          }
        })
      })

      req.on('error', reject)

      if (options.body) {
        req.write(options.body)
      }
      req.end()
    })
  }

  private async apiRequest<T>(endpoint: string): Promise<T> {
    await this.ensureToken()

    try {
      return await this.makeRequest<T>({
        hostname: 'api.spotify.com',
        path: `/v1${endpoint}`,
        headers: {
          'Authorization': `Bearer ${this.accessToken}`
        }
      })
    } catch (error: any) {
      if (/401|token/i.test(error.message || '')) {
        await this.refreshAccessToken()
        return this.makeRequest<T>({
          hostname: 'api.spotify.com',
          path: `/v1${endpoint}`,
          headers: {
            'Authorization': `Bearer ${this.accessToken}`
          }
        })
      }
      throw error
    }
  }

  parseSpotifyUrl(url: string): { type: string; id: string } | null {
    const uriMatch = url.match(/^spotify:(track|album|playlist|artist):([a-zA-Z0-9]+)$/)
    if (uriMatch) {
      return { type: uriMatch[1], id: uriMatch[2] }
    }

    const urlMatch = url.match(/open\.spotify\.com\/(track|album|playlist|artist)\/([a-zA-Z0-9]+)/)
    if (urlMatch) {
      return { type: urlMatch[1], id: urlMatch[2] }
    }

    const shortMatch = url.match(/(?:link|spotify)\.spotify\.com\/(track|album|playlist|artist)\/([a-zA-Z0-9]+)/)
    if (shortMatch) {
      return { type: shortMatch[1], id: shortMatch[2] }
    }

    return null
  }

  isSpotifyUrl(url: string): boolean {
    return url.includes('open.spotify.com') ||
           url.includes('link.spotify.com') ||
           url.includes('spotify.link') ||
           url.startsWith('spotify:')
  }

  async getTrack(id: string): Promise<SpotifyTrack> {
    return this.apiRequest<SpotifyTrack>(`/tracks/${id}`)
  }

  async getAlbum(id: string): Promise<SpotifyAlbum> {
    return this.apiRequest<SpotifyAlbum>(`/albums/${id}`)
  }

  async getPlaylist(id: string, market: string = 'US'): Promise<SpotifyPlaylist> {
    const playlist = await this.apiRequest<SpotifyPlaylist>(`/playlists/${id}?market=${market}`)

    console.log('[SpotifyAPI] getPlaylist response shape:', {
      id: playlist?.id,
      name: playlist?.name,
      hasTracks: !!playlist?.tracks,
      hasItems: !!playlist?.items,
      tracksTotal: playlist?.tracks?.total ?? null,
      itemsTotal: playlist?.items?.total ?? null,
      tracksItemsLength: playlist?.tracks?.items?.length ?? null,
      itemsItemsLength: playlist?.items?.items?.length ?? null,
      owner: playlist?.owner?.id ?? null,
      isPublic: playlist?.public ?? null
    })

    if (playlist.items) {
      const total = playlist.items.total ?? 0
      const allItems = [...(playlist.items.items || [])]
      let offset = allItems.length || 100

      console.log('[SpotifyAPI] playlist returned new items shape', {
        playlistId: id,
        total,
        initialItems: allItems.length
      })

      while (offset < total) {
        const page = await this.apiRequest<{ items: Array<{ item: SpotifyTrack | null }> }>(
          `/playlists/${id}/items?offset=${offset}&limit=100&market=${market}`
        )
        console.log('[SpotifyAPI] fetched playlist items page', {
          playlistId: id,
          offset,
          returned: page?.items?.length ?? 0
        })
        allItems.push(...(page.items || []))
        offset += 100
      }

      playlist.tracks = {
        total,
        items: allItems.map((entry) => ({ track: entry.item || null }))
      }

      return playlist
    }

    if (playlist.tracks) {
      const total = playlist.tracks.total ?? 0
      const allItems = [...(playlist.tracks.items || [])]
      let offset = allItems.length || 100

      console.log('[SpotifyAPI] playlist returned legacy tracks shape', {
        playlistId: id,
        total,
        initialItems: allItems.length
      })

      while (offset < total) {
        const page = await this.apiRequest<{ items: Array<{ track: SpotifyTrack | null }> }>(
          `/playlists/${id}/tracks?offset=${offset}&limit=100&market=${market}`
        )
        console.log('[SpotifyAPI] fetched legacy playlist tracks page', {
          playlistId: id,
          offset,
          returned: page?.items?.length ?? 0
        })
        allItems.push(...(page.items || []))
        offset += 100
      }

      playlist.tracks.items = allItems
      return playlist
    }

    console.warn('[SpotifyAPI] playlist returned without tracks/items', {
      playlistId: id,
      name: playlist?.name,
      owner: playlist?.owner?.id ?? null
    })
    playlist.tracks = { total: 0, items: [] }
    return playlist
  }

  async getArtist(id: string): Promise<SpotifyArtist> {
    return this.apiRequest<SpotifyArtist>(`/artists/${id}`)
  }

  async getArtistTopTracks(id: string, market: string = 'US'): Promise<SpotifyTrack[]> {
    const response = await this.apiRequest<{ tracks: SpotifyTrack[] }>(
      `/artists/${id}/top-tracks?market=${market}`
    )
    return response.tracks
  }

  async getArtistAlbums(id: string, limit: number = 50): Promise<SpotifyAlbum[]> {
    const response = await this.apiRequest<{ items: SpotifyAlbum[] }>(
      `/artists/${id}/albums?include_groups=album,single&limit=${limit}`
    )
    return response.items
  }

  private generateRandomString(length: number): string {
    return this.base64UrlEncode(randomBytes(length)).slice(0, length)
  }

  private base64UrlEncode(buffer: Buffer): string {
    return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  }
}

export const spotifyAPI = new SpotifyAPI()
