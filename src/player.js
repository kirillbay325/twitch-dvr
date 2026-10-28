(() => {
  'use strict';

  if (window.__tdvrLoaded) return;
  window.__tdvrLoaded = true;

  function ensureStyles() {
    try {
      if (!window.__tdvrCss) return;
      if (document.getElementById('tdvr-inline-style')) return;
      const style = document.createElement('style');
      style.id = 'tdvr-inline-style';
      style.textContent = window.__tdvrCss;
      (document.head || document.documentElement).appendChild(style);
    } catch { /* ignored */ }
  }
  ensureStyles();

  const VERSION = '1.2.1';
  const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
  const GQL_URL = 'https://gql.twitch.tv/gql';
  const STORAGE = {
    enabled: 'tdvr:enabled',
    quality: 'tdvr:quality',
    volume: 'tdvr:volume',
  };
  const CHANNEL_SKIP = new Set([
    'directory', 'search', 'videos', 'settings', 'subscriptions', 'inventory', 'wallet',
    'drops', 'friends', 'messages', 'notifications', 'p', 'downloads', 'jobs', 'turbo',
    'prime', 'teams', 'login', 'signup', 'oauth', 'api', 'integrations', 'creatorcamp',
    'legal', 'privacy', 'safety', 'accessibility', 'store', 'following', 'browse',
  ]);
  const AHEAD_SECONDS = 30;
  const KEEP_BEHIND_SECONDS = 20;
  const PLAYLIST_REFRESH_MS = 25000;
  const READY_RETRY_MS = 1100;
  const NETWORK_RETRY_MS = 2200;
  const UI_TICK_MS = 250;
  const LIVE_WINDOW_SECONDS = 30;
  const LIVE_INTENT_SECONDS = 12;

  const PLAY_ICON = '<svg width="16" height="18" viewBox="0 0 16 18" fill="none"><path d="M1 1.6v14.8c0 .8.9 1.3 1.6.9l12-7.4a1 1 0 0 0 0-1.8l-12-7.4A1.06 1.06 0 0 0 1 1.6Z" fill="currentColor"/></svg>';
  const PAUSE_ICON = '<svg width="16" height="18" viewBox="0 0 16 18" fill="none"><rect x="1" y="1" width="4.5" height="16" rx="1" fill="currentColor"/><rect x="10.5" y="1" width="4.5" height="16" rx="1" fill="currentColor"/></svg>';
  const SPEAKER_BODY = '<path d="M4 9.4v5.2c0 .9.7 1.6 1.6 1.6H8l3.8 3.1c.7.6 1.7.1 1.7-.8V5.5c0-.9-1-1.4-1.7-.8L8 7.8H5.6c-.9 0-1.6.7-1.6 1.6Z" fill="currentColor"/>';

  function volumeIcon(level) {
    const waves = [];
    if (level === 'low' || level === 'medium' || level === 'high') {
      waves.push('<path d="M15.3 9.3a4.4 4.4 0 0 1 0 5.4"/>');
    }
    if (level === 'medium' || level === 'high') {
      waves.push('<path d="M18 7a8 8 0 0 1 0 10"/>');
    }
    if (level === 'high') {
      waves.push('<path d="M20.6 4.8a11.5 11.5 0 0 1 0 14.4"/>');
    }
    const waveMarkup = waves.length
      ? '<g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">' + waves.join('') + '</g>'
      : '';
    const muteMarkup = level === 'muted'
      ? '<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M15.4 9.4l5.2 5.2M20.6 9.4l-5.2 5.2"/></g>'
      : '';
    return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">' + SPEAKER_BODY + waveMarkup + muteMarkup + '</svg>';
  }

  const SETTINGS_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 7h6M15 7h6M3 12h4M13 12h8M3 17h10M19 17h2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="12" cy="7" r="2.1" fill="currentColor"/><circle cx="10" cy="12" r="2.1" fill="currentColor"/><circle cx="16" cy="17" r="2.1" fill="currentColor"/></svg>';
  const FULLSCREEN_ICON = '<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M2 6V2h4M16 6V2h-4M2 12v4h4M16 12v4h-4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  const BIG_PLAY_ICON = '<svg width="26" height="30" viewBox="0 0 16 18" fill="none"><path d="M1 1.6v14.8c0 .8.9 1.3 1.6.9l12-7.4a1 1 0 0 0 0-1.8l-12-7.4A1.06 1.06 0 0 0 1 1.6Z" fill="currentColor"/></svg>';

  class AppError extends Error {
    constructor(code, cause) {
      super(code);
      this.code = code;
      this.cause = cause;
    }
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  function storeGet(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  }

  function storeSet(key, value) {
    try { localStorage.setItem(key, value); } catch { /* ignored */ }
  }

  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
    seconds = Math.floor(seconds);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function median(values) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  function parseAttributes(source) {
    const attrs = {};
    const re = /([A-Za-z0-9-]+)=(?:"([^"]*)"|([^,]*))/g;
    let match;
    while ((match = re.exec(source))) {
      attrs[match[1]] = match[2] !== undefined ? match[2] : match[3];
    }
    return attrs;
  }

  function channelLoginFromPath(pathname) {
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length !== 1) return null;
    const login = parts[0];
    if (CHANNEL_SKIP.has(login.toLowerCase())) return null;
    if (!/^[A-Za-z0-9_]{1,25}$/.test(login)) return null;
    return login;
  }

  function findPlayerContainer() {
    const persistent = document.querySelector('.persistent-player');
    if (persistent) {
      return persistent.querySelector('.video-player');
    }
    const candidates = [...document.querySelectorAll('.channel-page__video-player .video-player')];
    if (candidates.length) {
      return candidates.sort((a, b) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        return (br.width * br.height) - (ar.width * ar.height);
      })[0];
    }
    return document.querySelector('.video-player__container');
  }

  function errorMessage(code) {
    switch (code) {
      case 'NO_VOD':
        return 'DVR недоступен: у канала нет доступной записи эфира (VOD отключены). Включён стандартный плеер.';
      case 'VOD_SUB_ONLY':
        return 'Запись канала доступна только подписчикам — DVR недоступен без входа. Включён стандартный плеер.';
      case 'NETWORK':
        return 'Не удалось загрузить DVR из-за сети. Включён стандартный плеер.';
      case 'STREAM_OFFLINE':
        return null;
      default:
        return 'DVR не удалось запустить. Включён стандартный плеер.';
    }
  }

  async function fetchWithRetry(url, options = {}, attempts = 2, timeoutMs = 15000) {
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(timer);
        return response;
      } catch (error) {
        clearTimeout(timer);
        lastError = error;
        if (attempt < attempts - 1) await sleep(400 * (attempt + 1));
      }
    }
    throw lastError || new Error('Network error');
  }

  const TOKEN_QUERY = `query PlaybackAccessToken_Template($login: String!, $isLive: Boolean!, $vodID: ID!, $isVod: Boolean!, $playerType: String!) {
    streamPlaybackAccessToken(channelName: $login, params: {platform: "web", playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isLive) { value signature }
    videoPlaybackAccessToken(id: $vodID, params: {platform: "web", playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isVod) { value signature }
  }`;

  const VIDEOS_QUERY = `query ChannelVideos($login: String!, $first: Int!) {
    user(login: $login) {
      videos(first: $first, type: ARCHIVE, sort: TIME) {
        edges { node { id publishedAt lengthSeconds } }
      }
    }
  }`;

  const STREAM_QUERY = `query StreamInfo($login: String!) {
    user(login: $login) {
      stream { id createdAt }
    }
  }`;

  async function gql(payload) {
    let response;
    try {
      response = await fetchWithRetry(GQL_URL, {
        method: 'POST',
        headers: { 'Client-ID': CLIENT_ID, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'omit',
        cache: 'no-store',
      }, 2, 15000);
    } catch (error) {
      throw new AppError('NETWORK', error);
    }
    if (!response.ok) throw new AppError('NETWORK');
    const json = await response.json();
    if (json.errors && json.errors.length) throw new Error(json.errors[0].message || 'GQL error');
    return json;
  }

  async function fetchPlaybackToken(login, vodId) {
    const isLive = !vodId;
    let json;
    try {
      json = await gql([{
        operationName: 'PlaybackAccessToken_Template',
        query: TOKEN_QUERY,
        variables: {
          isLive,
          isVod: !isLive,
          login: login || '',
          playerType: 'site',
          vodID: vodId || '',
        },
      }]);
    } catch (error) {
      if (error instanceof AppError && error.code === 'NETWORK') throw error;
      throw new AppError(isLive ? 'STREAM_OFFLINE' : 'VOD_UNAVAILABLE', error);
    }
    const payload = json[0] && json[0].data;
    const token = isLive ? payload && payload.streamPlaybackAccessToken : payload && payload.videoPlaybackAccessToken;
    if (!token || !token.value || !token.signature) {
      throw new AppError(isLive ? 'STREAM_OFFLINE' : 'VOD_UNAVAILABLE');
    }
    return token;
  }

  async function fetchLatestArchive(login) {
    let json;
    try {
      json = await gql([{
        operationName: 'ChannelVideos',
        query: VIDEOS_QUERY,
        variables: { login, first: 1 },
      }]);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('NETWORK', error);
    }
    const edges = json[0] && json[0].data && json[0].data.user && json[0].data.user.videos && json[0].data.user.videos.edges;
    return edges && edges[0] ? edges[0].node : null;
  }

  async function fetchLiveStream(login) {
    let json;
    try {
      json = await gql([{
        operationName: 'StreamInfo',
        query: STREAM_QUERY,
        variables: { login },
      }]);
    } catch (error) {
      if (error instanceof AppError && error.code === 'NETWORK') throw error;
      throw new AppError('STREAM_OFFLINE', error);
    }
    const user = json[0] && json[0].data && json[0].data.user;
    return user && user.stream ? user.stream : null;
  }

  function isCurrentBroadcast(video) {
    if (!video || !video.publishedAt || !video.lengthSeconds) return false;
    const published = Date.parse(video.publishedAt) / 1000;
    if (!Number.isFinite(published)) return false;
    const end = published + Number(video.lengthSeconds);
    return Math.abs(Date.now() / 1000 - end) <= 900;
  }

  function parseMaster(text, baseUrl) {
    const lines = text.split('\n').map((line) => line.trim());
    const groups = {};
    for (const line of lines) {
      if (!line.startsWith('#EXT-X-MEDIA:')) continue;
      const attrs = parseAttributes(line.slice('#EXT-X-MEDIA:'.length));
      if (attrs.TYPE === 'VIDEO' && attrs['GROUP-ID']) {
        groups[attrs['GROUP-ID']] = attrs.NAME || attrs['GROUP-ID'];
      }
    }

    const variants = [];
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (!line.startsWith('#EXT-X-STREAM-INF:')) continue;
      const attrs = parseAttributes(line.slice('#EXT-X-STREAM-INF:'.length));
      let uri = lines[index + 1];
      if (!uri || uri.startsWith('#')) continue;
      let url;
      try {
        url = new URL(uri, baseUrl).href;
      } catch {
        continue;
      }
      const resolution = (attrs.RESOLUTION || '').split('x');
      const width = Number(resolution[0]) || 0;
      const height = Number(resolution[1]) || 0;
      const fps = Number(attrs['FRAME-RATE']) || 0;
      const group = attrs.VIDEO || '';
      const name = groups[group] || '';
      const codecs = attrs.CODECS || 'avc1.42E01E,mp4a.40.2';
      const audioOnly = !height || /audio/i.test(group) || !/avc1|avc3|hvc1|hev1|av01/i.test(codecs);
      let label = name && /^\d+p\d*$/.test(name) ? name : '';
      if (!label && !audioOnly) label = `${height}p${fps >= 48 ? Math.round(fps) : ''}`;
      if (audioOnly) label = 'Только звук';
      const isSource = /chunked|source/i.test(group) || /chunked|source/i.test(name);
      variants.push({
        url,
        width,
        height,
        fps,
        bandwidth: Number(attrs.BANDWIDTH) || 0,
        codecs,
        group,
        name,
        label,
        audioOnly,
        isSource,
      });
    }

    variants.sort((a, b) => {
      if (a.audioOnly !== b.audioOnly) return a.audioOnly ? 1 : -1;
      if (b.height !== a.height) return b.height - a.height;
      if (b.fps !== a.fps) return b.fps - a.fps;
      if (a.isSource !== b.isSource) return a.isSource ? -1 : 1;
      return b.bandwidth - a.bandwidth;
    });
    return variants;
  }

  function parseMedia(text, playlistUrl) {
    const lines = text.split('\n');
    const segments = [];
    let start = 0;
    let endlist = false;
    let pattern = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      if (line === '#EXT-X-ENDLIST') {
        endlist = true;
        continue;
      }
      if (!line.startsWith('#EXTINF:')) continue;
      const duration = parseFloat(line.slice('#EXTINF:'.length).split(',')[0]);
      let uri = (lines[i + 1] || '').trim();
      if (!uri || uri.startsWith('#')) continue;
      i += 1;
      let url;
      try {
        url = new URL(uri, playlistUrl).href;
      } catch {
        continue;
      }
      if (!pattern) {
        const queryIndex = uri.indexOf('?');
        const clean = queryIndex >= 0 ? uri.slice(0, queryIndex) : uri;
        const query = queryIndex >= 0 ? uri.slice(queryIndex) : '';
        const match = /(\d+)\.(ts|m4s)$/.exec(clean);
        if (match) {
          const resolved = new URL(clean, playlistUrl).href;
          pattern = {
            base: resolved.slice(0, resolved.length - match[0].length),
            ext: match[2],
            pad: match[1].length,
            query,
          };
        }
      }
      const dur = Number.isFinite(duration) && duration > 0 ? duration : 10;
      segments.push({ start, dur, url });
      start += dur;
    }

    return { segments, end: start, endlist, pattern };
  }

  class VodSession {
    constructor(login) {
      this.login = login;
      this.video = null;
      this.masterUrl = '';
      this.variants = [];
      this.variant = null;
      this.segments = [];
      this.end = 0;
      this.endlist = false;
      this.pattern = null;
      this.segmentDur = 10;
      this.playlistUrl = '';
      this.lastPlaylistAt = 0;
      this.loadingPlaylist = null;
    }

    async init(savedQuality) {
      const stream = await fetchLiveStream(this.login);
      if (!stream) throw new AppError('STREAM_OFFLINE');
      const video = await fetchLatestArchive(this.login);
      if (!video || !isCurrentBroadcast(video)) throw new AppError('NO_VOD');
      const streamStart = Date.parse(stream.createdAt);
      if (Number.isFinite(streamStart) && Date.parse(video.publishedAt) < streamStart - 300000) {
        throw new AppError('NO_VOD');
      }
      this.video = video;

      let token;
      try {
        token = await fetchPlaybackToken('', video.id);
      } catch (error) {
        throw new AppError(error.code === 'VOD_UNAVAILABLE' ? 'VOD_UNAVAILABLE' : 'NETWORK', error);
      }

      this.masterUrl = `https://usher.ttvnw.net/vod/${video.id}.m3u8?allow_source=true&allow_audio_only=true&fast_bread=true&playlist_include_framerate=true&reassignments_supported=true&sig=${encodeURIComponent(token.signature)}&token=${encodeURIComponent(token.value)}`;

      let response;
      try {
        response = await fetchWithRetry(this.masterUrl, { cache: 'no-store' }, 2, 15000);
      } catch (error) {
        throw new AppError('NETWORK', error);
      }
      if (!response.ok) {
        throw new AppError(response.status === 403 || response.status === 401 ? 'VOD_SUB_ONLY' : 'VOD_UNAVAILABLE');
      }
      const master = await response.text();
      this.variants = parseMaster(master, this.masterUrl).filter((variant) => !variant.audioOnly);
      if (!this.variants.length) throw new AppError('VOD_UNAVAILABLE');

      this.selectQuality(savedQuality);
      await this.loadPlaylist(true);
    }

    selectQuality(savedQuality) {
      let index = -1;
      if (savedQuality) index = this.variants.findIndex((variant) => variant.label === savedQuality);
      this.variant = index >= 0 ? this.variants[index] : this.variants[0];
    }

    async setVariant(variant) {
      this.variant = variant;
      this.pattern = null;
      this.lastPlaylistAt = 0;
      await this.loadPlaylist(true);
    }

    async loadPlaylist(force = false) {
      if (this.loadingPlaylist) return this.loadingPlaylist;
      if (!force && Date.now() - this.lastPlaylistAt < 5000) return;
      this.loadingPlaylist = (async () => {
        let response;
        try {
          response = await fetchWithRetry(this.variant.url, { cache: 'no-store' }, 2, 15000);
        } catch (error) {
          throw new AppError('NETWORK', error);
        }
        if (!response.ok) throw new AppError('PLAYLIST');
        const text = await response.text();
        const parsed = parseMedia(text, this.variant.url);
        if (!parsed.segments.length) throw new AppError('PLAYLIST');

        const merged = parsed.segments;
        for (let i = merged.length; i < this.segments.length; i++) {
          merged.push(this.segments[i]);
        }
        this.segments = merged;
        this.pattern = parsed.pattern || this.pattern;
        this.endlist = parsed.endlist;
        const last = this.segments[this.segments.length - 1];
        this.end = last.start + last.dur;
        this.segmentDur = median(parsed.segments.map((segment) => segment.dur)) || 10;
        this.lastPlaylistAt = Date.now();
      })().finally(() => {
        this.loadingPlaylist = null;
      });
      return this.loadingPlaylist;
    }

    playlistAge() {
      return Date.now() - this.lastPlaylistAt;
    }

    segmentIndexAt(time) {
      const segments = this.segments;
      if (!segments.length) return -1;
      let low = 0;
      let high = segments.length - 1;
      let answer = 0;
      while (low <= high) {
        const mid = (low + high) >> 1;
        if (segments[mid].start <= time) {
          answer = mid;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }
      return answer;
    }

    urlForIndex(index) {
      if (this.segments[index]) return this.segments[index].url;
      if (index < this.segments.length) return null;
      if (this.pattern) {
        const padded = String(index).padStart(this.pattern.pad, '0');
        return `${this.pattern.base}${padded}.${this.pattern.ext}${this.pattern.query}`;
      }
      return null;
    }

    addProbedSegment(index, url) {
      if (index !== this.segments.length) return this.segments[index] || null;
      const previous = this.segments[this.segments.length - 1];
      const start = previous ? previous.start + previous.dur : 0;
      const dur = this.segmentDur || 10;
      const segment = { start, dur, url };
      this.segments.push(segment);
      this.end = start + dur;
      return segment;
    }
  }

  class MseEngine {
    constructor(video) {
      this.video = video;
      this.mediaSource = null;
      this.sourceBuffer = null;
      this.objectUrl = null;
      this.transmuxer = null;
      this.queue = [];
      this.offset = null;
      this.firstOutput = true;
      this.firstSegmentStart = null;
      this.generation = 0;
      this.onUpdate = null;
      this.lastError = null;
    }

    async reset(codecs) {
      const generation = ++this.generation;
      this.offset = null;
      this.queue = [];
      this.firstOutput = true;
      this.firstSegmentStart = null;
      this.lastError = null;

      if (this.sourceBuffer) {
        try { this.sourceBuffer.abort(); } catch { /* ignored */ }
      }
      if (this.mediaSource) {
        try { if (this.mediaSource.readyState === 'open') this.mediaSource.endOfStream(); } catch { /* ignored */ }
      }
      if (this.objectUrl) {
        URL.revokeObjectURL(this.objectUrl);
        this.objectUrl = null;
      }
      this.sourceBuffer = null;

      const mime = `video/mp4; codecs="${String(codecs).replace(/"/g, '')}"`;
      if (typeof MediaSource === 'undefined' || !MediaSource.isTypeSupported(mime)) {
        throw new AppError('CODEC');
      }

      const mediaSource = new MediaSource();
      this.mediaSource = mediaSource;
      this.objectUrl = URL.createObjectURL(mediaSource);
      this.video.src = this.objectUrl;
      this.video.load();

      await new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          console.warn('[TwitchDVR] MediaSource open timeout', {
            videoConnected: this.video.isConnected,
            readyState: this.video.readyState,
            mediaState: mediaSource.readyState,
            src: String(this.video.src).slice(0, 60),
          });
          reject(new AppError(this.generation !== generation ? 'STALE' : 'MEDIA'));
        }, 8000);
        mediaSource.addEventListener('sourceopen', () => {
          if (settled) return;
          if (this.generation !== generation) {
            settled = true;
            clearTimeout(timer);
            reject(new AppError('STALE'));
            return;
          }
          try {
            const sourceBuffer = mediaSource.addSourceBuffer(mime);
            sourceBuffer.mode = 'segments';
            this.sourceBuffer = sourceBuffer;
            sourceBuffer.addEventListener('updateend', () => {
              if (this.generation === generation && this.sourceBuffer === sourceBuffer) this.handleUpdate();
            });
            sourceBuffer.addEventListener('error', () => {
              if (this.generation === generation && this.sourceBuffer === sourceBuffer) {
                this.lastError = new AppError('MEDIA');
              }
            });
            settled = true;
            clearTimeout(timer);
            this.initTransmuxer();
            resolve();
          } catch (error) {
            settled = true;
            clearTimeout(timer);
            reject(new AppError('MEDIA', error));
          }
        }, { once: true });
      });
    }

    initTransmuxer() {
      if (this.transmuxer) {
        try { this.transmuxer.off('data'); } catch { /* ignored */ }
      }
      this.firstOutput = true;
      this.transmuxer = new window.__tdvrMux.mp4.Transmuxer();
      this.transmuxer.on('data', (segment) => {
        let data = segment.data;
        if (this.firstOutput) {
          if (segment.initSegment && segment.initSegment.byteLength) {
            const merged = new Uint8Array(segment.initSegment.byteLength + data.byteLength);
            merged.set(segment.initSegment, 0);
            merged.set(data, segment.initSegment.byteLength);
            data = merged;
          }
          this.firstOutput = false;
        }
        this.queue.push(data);
        this.pumpQueue();
      });
    }

    pushTs(bytes, segmentStart) {
      if (!this.transmuxer) return;
      if (this.offset === null && this.firstSegmentStart === null) this.firstSegmentStart = segmentStart;
      try {
        this.transmuxer.push(new Uint8Array(bytes));
        this.transmuxer.flush();
      } catch (error) {
        this.lastError = new AppError('TRANSMUX', error);
      }
    }

    pumpQueue() {
      if (!this.sourceBuffer || this.sourceBuffer.updating || !this.queue.length) return;
      const chunk = this.queue.shift();
      try {
        this.sourceBuffer.appendBuffer(chunk);
      } catch (error) {
        this.lastError = new AppError('APPEND', error);
      }
    }

    handleUpdate() {
      if (this.offset === null && this.firstSegmentStart !== null) {
        const buffered = this.video.buffered;
        if (buffered.length) {
          this.offset = this.firstSegmentStart - buffered.start(0);
        }
      }
      this.pumpQueue();
      this.trim();
      if (typeof this.onUpdate === 'function') this.onUpdate();
    }

    waitIdle(timeoutMs = 20000) {
      return new Promise((resolve) => {
        const started = Date.now();
        const check = () => {
          if (this.lastError) { resolve(); return; }
          if (!this.sourceBuffer || (!this.sourceBuffer.updating && this.queue.length === 0)) { resolve(); return; }
          if (Date.now() - started > timeoutMs) { resolve(); return; }
          setTimeout(check, 40);
        };
        check();
      });
    }

    mediaToStream(time) {
      return this.offset === null ? time : time + this.offset;
    }

    streamToMedia(time) {
      return this.offset === null ? time : time - this.offset;
    }

    bufferedStreamRange() {
      const buffered = this.video.buffered;
      if (!buffered.length || this.offset === null) return null;
      return {
        start: buffered.start(buffered.length - 1) + this.offset,
        end: buffered.end(buffered.length - 1) + this.offset,
      };
    }

    setCurrentStreamTime(time) {
      const buffered = this.video.buffered;
      if (!buffered.length || this.offset === null) return false;
      const media = this.streamToMedia(time);
      for (let i = buffered.length - 1; i >= 0; i--) {
        if (media >= buffered.start(i) - 0.1 && media <= buffered.end(i) + 0.1) {
          this.video.currentTime = clamp(media, buffered.start(i) + 0.01, buffered.end(i) - 0.05);
          return true;
        }
      }
      return false;
    }

    trim() {
      if (!this.sourceBuffer || this.sourceBuffer.updating) return;
      const buffered = this.video.buffered;
      if (!buffered.length) return;
      const current = this.video.currentTime;
      const start = buffered.start(0);
      if (current - start > KEEP_BEHIND_SECONDS) {
        try {
          this.sourceBuffer.remove(start, current - KEEP_BEHIND_SECONDS);
        } catch { /* ignored */ }
      }
    }

    destroy() {
      this.generation++;
      if (this.sourceBuffer) {
        try { this.sourceBuffer.abort(); } catch { /* ignored */ }
      }
      if (this.mediaSource) {
        try { if (this.mediaSource.readyState === 'open') this.mediaSource.endOfStream(); } catch { /* ignored */ }
      }
      if (this.objectUrl) {
        URL.revokeObjectURL(this.objectUrl);
        this.objectUrl = null;
      }
      this.sourceBuffer = null;
      this.mediaSource = null;
      this.queue = [];
      if (this.transmuxer) {
        try { this.transmuxer.off('data'); } catch { /* ignored */ }
        this.transmuxer = null;
      }
    }
  }

  class DvrPlayer {
    constructor(app, login, container) {
      this.app = app;
      this.login = login;
      this.container = container;
      this.root = null;
      this.video = null;
      this.engine = null;
      this.session = null;
      this.overlayContainer = null;
      this.originalContainerPosition = null;
      this.quality = null;
      this.destroyed = false;
      this.generation = 0;
      this.wantPlay = true;
      this.liveIntent = true;
      this.busySeeding = false;
      this.currentStream = 0;
      this.duration = 0;
      this.loopRunning = false;
      this.fetchController = null;
      this.dragging = false;
      this.dragTime = 0;
      this.nativeState = [];
      this.endedToastShown = false;
      this.idleTimer = null;
      this.controlsTimer = null;
      this.spinnerDelay = null;
      this.stalled = false;
      this.toastTimer = null;
      this.networkErrors = 0;
      this.playlistRefreshing = false;
      this.spinnerVisible = true;
      this.playToken = 0;
      this.lastResumeAt = 0;
      this.geometryKey = null;
      this.lastVolume = 0.5;
      this.lastVolumeLevel = null;
    }

    async start() {
      if (!window.__tdvrMux || !window.__tdvrMux.mp4) throw new AppError('MUX');
      this.session = new VodSession(this.login);
      await this.session.init(storeGet(STORAGE.quality));
      if (this.destroyed) return;

      this.mount();
      this.engine = new MseEngine(this.video);
      this.engine.onUpdate = () => this.handleEngineUpdate();
      this.quality = this.session.variant;
      this.applyVolume();
      this.buildQualityMenu();
      this.bindMediaEvents();
      this.bindControls();

      const latestIndex = this.session.segments.length - 1;
      if (latestIndex < 0) throw new AppError('VOD_UNAVAILABLE');
      const latest = this.session.segments[latestIndex];
      this.liveIntent = true;
      await this.seed(latestIndex, latest.start);
      this.startTimers();
      this.startLoop();
    }

    mount() {
      ensureStyles();
      const root = document.createElement('div');
      root.id = 'tdvr-root';
      Object.assign(root.style, {
        position: 'absolute',
        top: '0',
        right: '0',
        bottom: '0',
        left: '0',
        zIndex: '40',
        background: '#000',
        display: 'flex',
        overflow: 'hidden',
      });
      root.innerHTML = `
        <video class="tdvr-video" playsinline preload="auto"></video>
        <button type="button" class="tdvr-unmute" hidden>${volumeIcon('muted')}<span>Включить звук</span></button>
        <div class="tdvr-center">
          <div class="tdvr-spinner"></div>
          <button type="button" class="tdvr-bigplay" hidden aria-label="Смотреть">${BIG_PLAY_ICON}</button>
        </div>
        <div class="tdvr-controls">
          <button type="button" class="tdvr-btn tdvr-playpause" title="Пауза">${PAUSE_ICON}</button>
          <div class="tdvr-volume">
            <button type="button" class="tdvr-btn tdvr-mute" title="Выключить звук" aria-label="Выключить звук" aria-pressed="false">${volumeIcon('high')}</button>
            <div class="tdvr-volume-slider">
              <div class="tdvr-volume-track"></div>
              <div class="tdvr-volume-fill"></div>
              <div class="tdvr-volume-thumb"></div>
              <input class="tdvr-volume-range" type="range" min="0" max="1" step="0.01" value="1" aria-label="Громкость">
            </div>
          </div>
          <div class="tdvr-time"><span class="tdvr-time-current">0:00</span><span class="tdvr-time-total"> / 0:00</span></div>
          <div class="tdvr-seek">
            <div class="tdvr-seek-track">
              <div class="tdvr-seek-buffer"></div>
              <div class="tdvr-seek-played"></div>
              <div class="tdvr-seek-handle"></div>
            </div>
            <div class="tdvr-seek-tooltip"></div>
          </div>
          <button type="button" class="tdvr-live-btn" title="Прямой эфир"><span class="tdvr-live-dot"></span><span class="tdvr-live-label">LIVE</span></button>
          <span class="tdvr-divider" aria-hidden="true"></span>
          <button type="button" class="tdvr-btn tdvr-quality-btn" title="Качество">—</button>
          <button type="button" class="tdvr-btn tdvr-settings-btn" title="Настройки">${SETTINGS_ICON}</button>
          <button type="button" class="tdvr-btn tdvr-fullscreen-btn" title="На весь экран">${FULLSCREEN_ICON}</button>
        </div>
        <div class="tdvr-menu tdvr-quality-menu" hidden></div>
        <div class="tdvr-menu tdvr-settings-menu" hidden>
          <div class="tdvr-menu-title">Настройки</div>
          <button type="button" class="tdvr-menu-item tdvr-native-item">Стандартный плеер Twitch</button>
          <button type="button" class="tdvr-menu-item tdvr-restart-item">Перезапустить DVR</button>
          <div class="tdvr-menu-sep"></div>
          <div class="tdvr-menu-note">DVR играет запись текущего эфира: задержка ~15–30 с. Зато доступно source-качество и перемотка на любой момент трансляции.</div>
          <div class="tdvr-menu-note">Если видео подтормаживает, выберите качество ниже.</div>
          <div class="tdvr-menu-note">Версия ${VERSION}</div>
        </div>
        <div class="tdvr-toast" hidden></div>
      `;
      this.container.appendChild(root);
      if (getComputedStyle(this.container).position === 'static') {
        this.originalContainerPosition = this.container.style.position;
        this.container.style.position = 'relative';
      }
      this.container.classList.add('tdvr-active');
      this.overlayContainer = document.querySelector('.video-player__container');
      if (this.overlayContainer && this.overlayContainer !== this.container) {
        this.overlayContainer.classList.add('tdvr-active');
      }
      this.root = root;

      this.video = root.querySelector('.tdvr-video');
      this.center = root.querySelector('.tdvr-center');
      this.spinner = root.querySelector('.tdvr-spinner');
      this.bigPlay = root.querySelector('.tdvr-bigplay');
      this.controls = root.querySelector('.tdvr-controls');
      this.playPauseBtn = root.querySelector('.tdvr-playpause');
      this.muteBtn = root.querySelector('.tdvr-mute');
      this.volumeSlider = root.querySelector('.tdvr-volume-slider');
      this.volumeFill = root.querySelector('.tdvr-volume-fill');
      this.volumeThumb = root.querySelector('.tdvr-volume-thumb');
      this.volumeRange = root.querySelector('.tdvr-volume-range');
      this.timeCurrent = root.querySelector('.tdvr-time-current');
      this.timeTotal = root.querySelector('.tdvr-time-total');
      this.seek = root.querySelector('.tdvr-seek');
      this.seekBuffer = root.querySelector('.tdvr-seek-buffer');
      this.seekPlayed = root.querySelector('.tdvr-seek-played');
      this.seekHandle = root.querySelector('.tdvr-seek-handle');
      this.seekTooltip = root.querySelector('.tdvr-seek-tooltip');
      this.liveBtn = root.querySelector('.tdvr-live-btn');
      this.liveLabel = root.querySelector('.tdvr-live-label');
      this.qualityBtn = root.querySelector('.tdvr-quality-btn');
      this.settingsBtn = root.querySelector('.tdvr-settings-btn');
      this.fullscreenBtn = root.querySelector('.tdvr-fullscreen-btn');
      this.qualityMenu = root.querySelector('.tdvr-quality-menu');
      this.settingsMenu = root.querySelector('.tdvr-settings-menu');
      this.unmuteBtn = root.querySelector('.tdvr-unmute');
      this.toastEl = root.querySelector('.tdvr-toast');

      Object.assign(this.video.style, {
        position: 'absolute',
        width: '100%',
        height: '100%',
        display: 'block',
        objectFit: 'contain',
        background: '#000',
      });
      Object.assign(this.center.style, {
        position: 'absolute',
        top: '0',
        right: '0',
        bottom: '0',
        left: '0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
      });
      this.syncGeometry();

      this.captureNativeState();
      this.guardNative();
      this.guardTimer = setInterval(() => this.guardNative(), 800);
    }

    captureNativeState() {
      const videos = this.playerVideos();
      for (const video of videos) {
        if (video === this.video) continue;
        this.nativeState.push({
          el: video,
          muted: video.muted,
          volume: video.volume,
          paused: video.paused,
        });
      }
    }

    playerVideos() {
      const videos = new Set([
        ...this.container.querySelectorAll('video'),
        ...document.querySelectorAll('.video-player__container video'),
      ]);
      return [...videos];
    }

    guardNative() {
      if (this.destroyed || !this.container) return;
      for (const video of this.playerVideos()) {
        if (video === this.video) continue;
        if (!this.nativeState.some((record) => record.el === video)) {
          this.nativeState.push({ el: video, muted: video.muted, volume: video.volume, paused: video.paused });
        }
        if (!video.paused) {
          try { video.pause(); } catch { /* ignored */ }
        }
        if (!video.muted) video.muted = true;
      }
    }

    restoreNativeState() {
      for (const record of this.nativeState) {
        const video = record.el;
        if (!video || !video.isConnected) continue;
        video.muted = record.muted;
        video.volume = record.volume;
        if (!record.paused) {
          const result = video.play();
          if (result && result.catch) result.catch(() => { /* ignored */ });
        }
      }
      const natives = [...this.container.querySelectorAll('video')]
        .filter((video) => video !== this.video && video.isConnected)
        .sort((a, b) => (b.videoWidth * b.videoHeight) - (a.videoWidth * a.videoHeight));
      if (natives.length) {
        const main = natives[0];
        main.muted = false;
        const result = main.play();
        if (result && result.catch) result.catch(() => { /* ignored */ });
      }
    }

    volumeLevel(muted, volume) {
      if (muted || volume <= 0) return 'muted';
      if (volume < 0.34) return 'low';
      if (volume < 0.67) return 'medium';
      return 'high';
    }

    updateVolumeUi() {
      if (!this.muteBtn || !this.volumeRange) return;
      const muted = this.video.muted || this.video.volume === 0;
      const volume = muted ? 0 : clamp(this.video.volume, 0, 1);
      const level = this.volumeLevel(muted, volume);
      const levelChanged = this.lastVolumeLevel !== null && this.lastVolumeLevel !== level;

      this.volumeRange.value = String(volume);
      if (this.volumeFill) this.volumeFill.style.width = `${volume * 100}%`;
      if (this.volumeThumb) this.volumeThumb.style.left = `${volume * 100}%`;

      this.muteBtn.innerHTML = volumeIcon(level);
      this.muteBtn.dataset.level = level;
      this.muteBtn.classList.toggle('tdvr-muted', muted);
      this.muteBtn.setAttribute('aria-pressed', String(muted));
      const label = muted ? 'Включить звук' : 'Выключить звук';
      this.muteBtn.title = label;
      this.muteBtn.setAttribute('aria-label', label);
      if (levelChanged) {
        this.muteBtn.classList.remove('tdvr-level-pop');
        void this.muteBtn.offsetWidth;
        this.muteBtn.classList.add('tdvr-level-pop');
      }
      this.lastVolumeLevel = level;
    }

    applyVolume() {
      const saved = parseFloat(storeGet(STORAGE.volume));
      const volume = Number.isFinite(saved) ? clamp(saved, 0, 1) : 1;
      this.video.volume = volume;
      this.video.muted = volume === 0;
      this.lastVolume = volume > 0 ? volume : 0.5;
      this.updateVolumeUi();
    }

    setVolume(volume, persist = true) {
      const next = clamp(Number.isFinite(volume) ? volume : 0, 0, 1);
      this.video.volume = next;
      this.video.muted = next === 0;
      if (next > 0) this.lastVolume = next;
      if (persist) storeSet(STORAGE.volume, String(next));
      if (next > 0) this.hideUnmute();
      this.updateVolumeUi();
      this.updateUi();
    }

    toggleMute() {
      if (this.video.muted || this.video.volume === 0) {
        const restore = clamp(this.lastVolume > 0 ? this.lastVolume : 0.5, 0.01, 1);
        this.video.volume = restore;
        this.video.muted = false;
        storeSet(STORAGE.volume, String(restore));
        this.hideUnmute();
      } else {
        this.lastVolume = this.video.volume;
        this.video.muted = true;
      }
      this.updateVolumeUi();
      this.updateUi();
    }

    bindMediaEvents() {
      this.onPlaying = () => {
        this.stalled = false;
        clearTimeout(this.spinnerDelay);
        this.setSpinner(false);
        if (!this.video.muted) this.hideUnmute();
        this.updateUi();
      };
      this.onPause = () => {
        if (this.video.ended && this.wantPlay && !this.busySeeding && this.session && !this.session.endlist) {
          this.setSpinner(true);
          this.updateUi();
          return;
        }
        if (!this.busySeeding) {
          this.stalled = false;
          this.setSpinner(false);
        }
        this.updateUi();
      };
      this.onEnded = () => {
        if (!this.destroyed && this.wantPlay && !this.busySeeding && this.session && !this.session.endlist) {
          this.setSpinner(true);
        }
        this.updateUi();
      };
      this.onWaiting = () => {
        this.stalled = true;
        clearTimeout(this.spinnerDelay);
        this.spinnerDelay = setTimeout(() => {
          if (this.stalled && !this.destroyed && !this.busySeeding) this.setSpinner(true);
        }, 350);
      };
      this.onVideoError = () => {
        if (!this.destroyed) this.fail(new AppError('VIDEO'));
      };
      this.onVideoClick = () => this.togglePlay();
      this.onVideoDoubleClick = () => this.toggleFullscreen();
      this.onFullscreenChange = () => {
        this.geometryKey = null;
        this.updateUi();
      };
      this.onVolumeChange = () => this.updateVolumeUi();
      this.onWindowResize = () => {
        this.geometryKey = null;
        this.syncGeometry();
      };
      window.addEventListener('resize', this.onWindowResize);
      this.video.addEventListener('volumechange', this.onVolumeChange);
      this.video.addEventListener('playing', this.onPlaying);
      this.video.addEventListener('pause', this.onPause);
      this.video.addEventListener('ended', this.onEnded);
      this.video.addEventListener('waiting', this.onWaiting);
      this.video.addEventListener('error', this.onVideoError);
      this.video.addEventListener('click', this.onVideoClick);
      this.video.addEventListener('dblclick', this.onVideoDoubleClick);
      document.addEventListener('fullscreenchange', this.onFullscreenChange);
    }

    bindControls() {
      this.playPauseBtn.addEventListener('click', () => this.setPlaying(this.video.paused));
      this.bigPlay.addEventListener('click', () => this.setPlaying(true));

      this.muteBtn.addEventListener('click', () => this.toggleMute());
      this.volumeRange.addEventListener('input', () => {
        const volume = clamp(parseFloat(this.volumeRange.value) || 0, 0, 1);
        this.setVolume(volume);
      });
      this.unmuteBtn.addEventListener('click', () => {
        this.video.muted = false;
        if (this.video.volume === 0) {
          this.video.volume = clamp(this.lastVolume > 0 ? this.lastVolume : 0.5, 0.01, 1);
        }
        storeSet(STORAGE.volume, String(this.video.volume));
        this.updateVolumeUi();
        this.hideUnmute();
        this.updateUi();
      });

      this.liveBtn.addEventListener('click', () => this.goLive(false));

      this.qualityBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        this.settingsMenu.hidden = true;
        this.qualityMenu.hidden = !this.qualityMenu.hidden;
        this.showControls();
      });
      this.settingsBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        this.qualityMenu.hidden = true;
        this.settingsMenu.hidden = !this.settingsMenu.hidden;
        this.showControls();
      });
      this.fullscreenBtn.addEventListener('click', () => this.toggleFullscreen());

      this.root.querySelector('.tdvr-native-item').addEventListener('click', () => {
        this.app.useNative();
      });
      this.root.querySelector('.tdvr-restart-item').addEventListener('click', () => {
        this.app.restart();
      });

      this.onDocumentClick = (event) => {
        if (this.qualityMenu.hidden && this.settingsMenu.hidden) return;
        if (event.target.closest && event.target.closest('.tdvr-menu')) return;
        this.closeMenus();
      };
      document.addEventListener('click', this.onDocumentClick);

      this.onKeyDown = (event) => this.handleKeyDown(event);
      document.addEventListener('keydown', this.onKeyDown, true);

      this.onRootMouseMove = () => this.showControls();
      this.onRootMouseLeave = () => {
        if (!this.video.paused && !this.dragging) this.scheduleIdle();
      };
      this.root.addEventListener('mousemove', this.onRootMouseMove);
      this.root.addEventListener('mouseleave', this.onRootMouseLeave);
      this.controls.addEventListener('pointerenter', () => this.clearIdleTimer());
      this.controls.addEventListener('pointerleave', () => this.scheduleIdle());

      this.bindSeek();
      this.updateUi();
    }

    bindSeek() {
      const timeFromEvent = (event) => {
        const rect = this.seek.getBoundingClientRect();
        const ratio = clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
        return ratio * Math.max(1, this.duration);
      };
      const setPreview = (time) => {
        const ratio = this.duration ? clamp(time / this.duration, 0, 1) : 0;
        this.seekPlayed.style.width = `${ratio * 100}%`;
        this.seekHandle.style.left = `${ratio * 100}%`;
        this.seekTooltip.textContent = time >= this.duration - 1 ? 'LIVE' : formatTime(time);
        const rect = this.seek.getBoundingClientRect();
        const tooltipX = clamp(ratio * rect.width, 36, rect.width - 36);
        this.seekTooltip.style.left = `${tooltipX}px`;
      };
      const onMove = (event) => {
        if (!this.dragging) return;
        this.dragTime = timeFromEvent(event);
        setPreview(this.dragTime);
      };
      const onUp = (event) => {
        if (!this.dragging) return;
        this.dragging = false;
        this.seek.classList.remove('tdvr-dragging');
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        const target = timeFromEvent(event);
        this.dragTime = target;
        if (target >= this.duration - 1) {
          this.goLive(true);
        } else {
          this.seekTo(target, { autoplay: this.wantPlay });
        }
        this.scheduleIdle();
      };

      this.seek.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.dragging = true;
        this.seek.classList.add('tdvr-dragging');
        this.dragTime = timeFromEvent(event);
        setPreview(this.dragTime);
        try { this.seek.setPointerCapture?.(event.pointerId); } catch { /* ignored */ }
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
        this.clearIdleTimer();
      });
      this.seek.addEventListener('pointermove', (event) => {
        if (!this.dragging) setPreview(timeFromEvent(event));
      });

      this.onVisibility = () => {
        if (document.visibilityState !== 'visible' || this.destroyed) return;
        if (this.liveIntent && this.wantPlay && this.session
          && this.session.end - this.currentStreamTime() > 90) {
          this.goLive(true);
        }
      };
      document.addEventListener('visibilitychange', this.onVisibility);
    }

    async seed(index, targetTime) {
      this.generation += 1;
      const generation = this.generation;
      this.abortFetch();
      this.busySeeding = true;
      this.setSpinner(true);
      try {
        const segment = this.session.segments[index];
        if (!segment) throw new AppError('SEEK');
        await this.engine.reset(this.quality.codecs);
        if (this.destroyed || generation !== this.generation) return;

        const bytes = await this.fetchSegmentWithRetry(segment.url, generation);
        if (this.destroyed || generation !== this.generation) return;

        this.engine.pushTs(bytes, segment.start);
        await this.engine.waitIdle();
        if (this.destroyed || generation !== this.generation) return;
        if (this.engine.lastError) throw this.engine.lastError;

        const clamped = clamp(targetTime, segment.start, segment.start + segment.dur);
        let applied = this.engine.setCurrentStreamTime(clamped);
        this.currentStream = clamped;
        if (!applied) {
          applied = this.engine.setCurrentStreamTime(segment.start);
          this.currentStream = segment.start;
        }
        if (!applied) throw new AppError('SEEK');
        if (this.wantPlay) {
          this.safePlay();
        } else {
          this.playToken += 1;
          this.video.pause();
        }
      } catch (error) {
        if (generation !== this.generation || (error && error.code === 'STALE')) return;
        throw error;
      } finally {
        if (generation === this.generation) {
          this.busySeeding = false;
          this.setSpinner(false);
          this.updateUi();
        }
      }
    }

    async fetchSegmentWithRetry(url, generation) {
      let lastError;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          return await this.fetchSegment(url, generation);
        } catch (error) {
          lastError = error;
          if (generation !== this.generation || this.destroyed) throw error;
          if (!(error instanceof AppError) || (error.code !== 'NOT_READY' && error.code !== 'NETWORK')) throw error;
          await sleep(500 * (attempt + 1));
        }
      }
      throw lastError || new AppError('NETWORK');
    }

    async fetchSegment(url, generation) {
      const controller = new AbortController();
      this.fetchController = controller;
      const timer = setTimeout(() => controller.abort(), 25000);
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (response.status === 404 || response.status === 403) throw new AppError('NOT_READY');
        if (!response.ok) throw new AppError('NETWORK');
        return await response.arrayBuffer();
      } catch (error) {
        if (error instanceof AppError) throw error;
        if (error && error.name === 'AbortError') {
          if (generation !== this.generation) throw new AppError('STALE');
          throw new AppError('NETWORK');
        }
        throw new AppError('NETWORK', error);
      } finally {
        clearTimeout(timer);
        if (this.fetchController === controller) this.fetchController = null;
      }
    }

    abortFetch() {
      if (this.fetchController) {
        try { this.fetchController.abort(); } catch { /* ignored */ }
        this.fetchController = null;
      }
    }

    startLoop() {
      if (this.loopRunning || this.destroyed) return;
      this.loopRunning = true;
      this.loop().catch((error) => {
        if (!this.destroyed) this.fail(error);
      }).finally(() => {
        this.loopRunning = false;
      });
    }

    async loop() {
      while (!this.destroyed) {
        try {
          if (this.busySeeding) {
            await sleep(150);
            continue;
          }
          if (this.engine.lastError) throw this.engine.lastError;

          const buffered = this.engine.bufferedStreamRange();
          if (!buffered) {
            await sleep(300);
            continue;
          }
          const current = this.currentStreamTime();
          if (buffered.end - current >= AHEAD_SECONDS) {
            await sleep(600);
            continue;
          }

          let index;
          if (buffered) {
            index = this.session.segmentIndexAt(Math.max(0, buffered.end - 0.05)) + 1;
          } else {
            index = this.session.segments.length - 1;
          }
          if (index < 0) index = 0;

          const known = this.session.segments[index];
          if (!known && index > this.session.segments.length) {
            await this.refreshPlaylist();
            await sleep(600);
            continue;
          }
          if (this.session.endlist && !known) {
            if (!this.endedToastShown) {
              this.endedToastShown = true;
              this.showToast('Трансляция завершилась. Доступна вся запись.');
              this.updateUi();
            }
            await sleep(1500);
            continue;
          }

          const url = this.session.urlForIndex(index);
          if (!url) {
            await this.refreshPlaylist();
            await sleep(600);
            continue;
          }

          const generation = this.generation;
          let bytes;
          try {
            bytes = await this.fetchSegment(url, generation);
          } catch (error) {
            if (this.destroyed || generation !== this.generation) continue;
            if (error.code === 'NOT_READY') {
              await sleep(READY_RETRY_MS);
              continue;
            }
            if (error.code === 'STALE') continue;
            this.networkErrors += 1;
            if (this.networkErrors === 3) this.showToast('Проблемы с сетью. Пробую снова…');
            await sleep(NETWORK_RETRY_MS);
            continue;
          }
          this.networkErrors = 0;
          if (this.destroyed || generation !== this.generation) continue;

          let segment = this.session.segments[index];
          if (!segment) {
            segment = this.session.addProbedSegment(index, url);
            if (!segment) continue;
          }
          if (buffered.end >= segment.start + segment.dur - 0.2) {
            continue;
          }
          this.engine.pushTs(bytes, segment.start);
          await this.engine.waitIdle();
        } catch (error) {
          if (this.destroyed) return;
          if (error && (error.code === 'STALE' || error.code === 'ABORTED')) continue;
          throw error;
        }
      }
    }

    async refreshPlaylist() {
      if (this.playlistRefreshing) return;
      this.playlistRefreshing = true;
      try {
        await this.session.loadPlaylist(true);
        this.duration = this.session.end;
      } catch { /* ignored */ } finally {
        this.playlistRefreshing = false;
      }
    }

    startTimers() {
      this.uiTimer = setInterval(() => this.updateUi(), UI_TICK_MS);
      this.playlistTimer = setInterval(() => {
        if (this.destroyed || this.session.endlist) return;
        this.refreshPlaylist();
      }, PLAYLIST_REFRESH_MS);
    }

    currentStreamTime() {
      if (!this.engine || this.engine.offset === null) return this.currentStream || 0;
      return this.engine.mediaToStream(this.video.currentTime);
    }

    handleEngineUpdate() {
      if (this.destroyed) return;
      if (this.engine.lastError) {
        this.fail(this.engine.lastError);
        return;
      }
      this.maybeResumeAfterBuffer();
    }

    maybeResumeAfterBuffer() {
      if (this.destroyed || this.busySeeding || !this.wantPlay) return;
      if (!this.video.paused) return;
      const buffered = this.video.buffered;
      if (!buffered.length) return;
      const end = buffered.end(buffered.length - 1);
      if (this.video.currentTime >= end - 0.25) return;
      if (Date.now() - this.lastResumeAt < 1500) return;
      this.lastResumeAt = Date.now();
      this.safePlay();
    }

    syncGeometry() {
      if (this.destroyed || !this.root || !this.root.isConnected || !this.container) return;
      if (document.fullscreenElement === this.root) return;
      if (getComputedStyle(this.container).transform !== 'none') return;

      const containerRect = this.container.getBoundingClientRect();
      if (containerRect.width < 60 || containerRect.height < 40) return;

      let target = null;
      const videos = [...this.container.querySelectorAll('video')];
      if (!videos.length) videos.push(...document.querySelectorAll('.video-player__container video'));
      for (const video of videos) {
        if (video === this.video) continue;
        if (!video.isConnected || video.videoWidth <= 0) continue;
        const rect = video.getBoundingClientRect();
        if (rect.width < 80 || rect.height < 45) continue;
        const area = rect.width * rect.height;
        if (!target || area > target.area) target = { rect, area };
      }

      const apply = (fills, rect) => {
        if (fills) {
          this.root.style.left = '0';
          this.root.style.top = '0';
          this.root.style.width = '';
          this.root.style.height = '';
          this.root.style.right = '0';
          this.root.style.bottom = '0';
        } else {
          this.root.style.left = `${rect.left - containerRect.left}px`;
          this.root.style.top = `${rect.top - containerRect.top}px`;
          this.root.style.width = `${rect.width}px`;
          this.root.style.height = `${rect.height}px`;
          this.root.style.right = 'auto';
          this.root.style.bottom = 'auto';
        }
      };

      if (!target) {
        if (this.geometryKey === 'fill') return;
        this.geometryKey = 'fill';
        apply(true);
        return;
      }

      const rect = target.rect;
      const left = rect.left - containerRect.left;
      const top = rect.top - containerRect.top;
      const fills = Math.abs(left) < 2 && Math.abs(top) < 2
        && Math.abs(rect.width - containerRect.width) < 2
        && Math.abs(rect.height - containerRect.height) < 2;
      const key = fills ? 'fill' : `${Math.round(left)}:${Math.round(top)}:${Math.round(rect.width)}:${Math.round(rect.height)}`;
      if (key === this.geometryKey) return;
      this.geometryKey = key;
      apply(fills, rect);
    }

    updateUi() {
      if (this.destroyed || !this.session) return;
      const session = this.session;
      this.duration = Math.max(session.end, 1);
      const current = clamp(this.currentStreamTime(), 0, this.duration);
      const behind = this.duration - current;
      if (!session.endlist && behind <= LIVE_INTENT_SECONDS) this.liveIntent = true;
      const atLive = this.liveIntent && behind <= LIVE_WINDOW_SECONDS && !session.endlist;

      if (!this.dragging) {
        const ratio = current / this.duration;
        this.seekPlayed.style.width = `${ratio * 100}%`;
        this.seekHandle.style.left = `${ratio * 100}%`;
        const buffered = this.engine.bufferedStreamRange();
        if (buffered) {
          const start = clamp(buffered.start / this.duration, 0, 1);
          const end = clamp(buffered.end / this.duration, 0, 1);
          this.seekBuffer.style.left = `${start * 100}%`;
          this.seekBuffer.style.width = `${Math.max(0, end - start) * 100}%`;
        } else {
          this.seekBuffer.style.width = '0%';
        }
      }

      this.timeCurrent.textContent = formatTime(current);
      this.timeTotal.textContent = ` / ${formatTime(this.duration)}`;

      this.liveBtn.classList.toggle('tdvr-behind', !atLive);
      if (session.endlist) {
        this.liveLabel.textContent = 'ЗАВЕРШЕНО';
        this.liveBtn.classList.add('tdvr-behind');
        this.liveBtn.title = 'Трансляция завершилась';
      } else if (atLive) {
        this.liveLabel.textContent = 'LIVE';
        this.liveBtn.title = 'Прямой эфир (DVR-задержка ~15–30 с)';
      } else {
        this.liveLabel.textContent = 'К ЭФИРУ';
        this.liveBtn.title = 'Перейти к последнему моменту эфира';
      }

      if (this.quality) this.qualityBtn.textContent = this.quality.label;

      this.syncGeometry();

      const playing = !this.video.paused && !this.busySeeding;
      this.playPauseBtn.innerHTML = playing ? PAUSE_ICON : PLAY_ICON;
      this.playPauseBtn.title = playing ? 'Пауза' : 'Смотреть';
      this.updateCenter();
    }

    updateCenter() {
      const showBigPlay = this.video.paused && !this.busySeeding && !this.spinnerVisible;
      this.bigPlay.hidden = !showBigPlay;
      this.spinner.hidden = !this.spinnerVisible;
      this.center.hidden = !showBigPlay && !this.spinnerVisible;
    }

    setSpinner(visible) {
      this.spinnerVisible = !!visible;
      this.updateCenter();
    }

    togglePlay() {
      this.setPlaying(this.video.paused);
    }

    setPlaying(play) {
      if (this.destroyed) return;
      this.playToken += 1;
      this.wantPlay = !!play;
      this.stalled = false;
      this.setSpinner(false);
      if (play) {
        this.safePlay();
      } else {
        this.video.pause();
      }
      this.showControls();
      this.updateUi();
    }

    safePlay() {
      const token = ++this.playToken;
      const promise = this.video.play();
      if (promise && promise.catch) {
        promise.catch(() => {
          if (this.destroyed || !this.wantPlay || token !== this.playToken) return;
          this.video.muted = true;
          this.unmuteBtn.hidden = false;
          this.updateVolumeUi();
          const retry = this.video.play();
          if (retry && retry.catch) retry.catch(() => { /* ignored */ });
          this.updateUi();
        });
      }
    }

    hideUnmute() {
      this.unmuteBtn.hidden = true;
    }

    async seekTo(time, options = {}) {
      if (this.destroyed || !this.session) return;
      if (this.session.endlist && this.session.end <= 0) return;
      if (this.session.playlistAge() > 5000) {
        await this.refreshPlaylist();
      }
      const duration = this.session.end;
      if (!duration) return;
      let target = clamp(time, 0, duration - 0.05);
      if (target >= duration - 1.5) {
        await this.goLive(true);
        return;
      }
      const autoplay = options.autoplay !== undefined ? options.autoplay : this.wantPlay;
      this.wantPlay = autoplay;

      const buffered = this.engine.bufferedStreamRange();
      if (buffered && target >= buffered.start + 0.2 && target <= buffered.end - 0.2) {
        if (this.engine.setCurrentStreamTime(target)) {
          this.liveIntent = duration - target <= LIVE_INTENT_SECONDS;
          if (this.wantPlay) this.safePlay();
          this.updateUi();
          return;
        }
      }

      const index = this.session.segmentIndexAt(target);
      const segment = this.session.segments[index];
      if (!segment) return;
      this.liveIntent = duration - target <= LIVE_INTENT_SECONDS;
      try {
        await this.seed(index, target);
      } catch (error) {
        if (!this.destroyed) this.fail(error);
      }
    }

    async goLive(force) {
      if (this.destroyed || !this.session) return;
      if (this.session.endlist) {
        this.showToast('Трансляция завершилась. Перемотка доступна.');
        return;
      }
      const behind = this.session.end - this.currentStreamTime();
      if (!force && behind <= LIVE_INTENT_SECONDS) {
        this.liveIntent = true;
        this.updateUi();
        return;
      }
      await this.refreshPlaylist();
      const segments = this.session.segments;
      if (!segments.length) return;
      const latest = segments[segments.length - 1];
      this.liveIntent = true;
      this.wantPlay = true;
      try {
        await this.seed(segments.length - 1, latest.start);
      } catch (error) {
        if (!this.destroyed) this.fail(error);
      }
    }

    seekBy(delta) {
      const target = this.currentStreamTime() + delta;
      this.seekTo(target, { autoplay: this.wantPlay });
    }

    buildQualityMenu() {
      this.qualityMenu.innerHTML = '';
      const title = document.createElement('div');
      title.className = 'tdvr-menu-title';
      title.textContent = 'Качество';
      this.qualityMenu.appendChild(title);

      for (const variant of this.session.variants) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'tdvr-menu-item';
        item.classList.toggle('tdvr-selected', variant === this.quality);

        const label = document.createElement('span');
        label.textContent = variant.label;
        item.appendChild(label);
        if (variant.isSource) {
          const tag = document.createElement('span');
          tag.className = 'tdvr-tag';
          tag.textContent = 'источник';
          item.appendChild(tag);
        }
        const check = document.createElement('span');
        check.className = 'tdvr-menu-check';
        check.textContent = '✓';
        item.appendChild(check);

        item.addEventListener('click', () => {
          this.qualityMenu.hidden = true;
          this.changeQuality(variant);
        });
        this.qualityMenu.appendChild(item);
      }

      const note = document.createElement('div');
      note.className = 'tdvr-menu-note';
      note.textContent = 'Лучшее доступное качество выбрано автоматически. В РФ live-плеер Twitch урезан до 720p, а запись отдаёт source.';
      this.qualityMenu.appendChild(note);
    }

    async changeQuality(variant) {
      if (!variant || variant === this.quality || this.destroyed) return;
      const wasPlaying = this.wantPlay;
      const time = this.currentStreamTime();
      const previous = this.quality;
      this.quality = variant;
      this.qualityBtn.textContent = variant.label;
      try {
        await this.session.setVariant(variant);
        storeSet(STORAGE.quality, variant.label);
        this.duration = this.session.end;
        const index = this.session.segmentIndexAt(time);
        const segment = this.session.segments[index];
        if (!segment) throw new AppError('SEEK');
        this.wantPlay = wasPlaying;
        await this.seed(index, time);
        this.buildQualityMenu();
      } catch (error) {
        this.quality = previous;
        try {
          await this.session.setVariant(previous);
        } catch { /* ignored */ }
        this.buildQualityMenu();
        this.showToast('Не удалось переключить качество.');
        if (!this.destroyed && !(error instanceof AppError && error.code === 'STALE')) this.fail(error);
      }
    }

    handleKeyDown(event) {
      if (this.destroyed) return;
      const target = event.target;
      if (target && target.closest && target.closest('input, textarea, [contenteditable="true"], [role="textbox"], [data-a-target="chat-input"]')) return;

      const key = event.key;
      const code = event.keyCode;
      if (key === 'Escape') {
        if (!this.qualityMenu.hidden || !this.settingsMenu.hidden) {
          this.closeMenus();
          event.stopPropagation();
        }
        return;
      }
      if (key === ' ' || key === 'k' || key === 'K' || code === 32 || code === 75) {
        event.preventDefault();
        event.stopPropagation();
        this.setPlaying(this.video.paused);
        return;
      }
      if (key === 'ArrowLeft' || key === 'j' || key === 'J' || code === 37) {
        event.preventDefault();
        event.stopPropagation();
        this.seekBy(event.shiftKey ? -60 : -10);
        return;
      }
      if (key === 'ArrowRight' || key === 'l' || key === 'L' || code === 39) {
        event.preventDefault();
        event.stopPropagation();
        this.seekBy(event.shiftKey ? 60 : 10);
        return;
      }
      if (key === 'm' || key === 'M') {
        event.preventDefault();
        event.stopPropagation();
        this.toggleMute();
        return;
      }
      if (key === 'f' || key === 'F') {
        event.preventDefault();
        event.stopPropagation();
        this.toggleFullscreen();
      }
    }

    toggleFullscreen() {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => { /* ignored */ });
      } else if (this.root.requestFullscreen) {
        this.root.requestFullscreen({ navigationUI: 'hide' }).catch(() => { /* ignored */ });
      }
    }

    showControls() {
      if (!this.root) return;
      this.root.classList.remove('tdvr-idle');
      this.clearIdleTimer();
      if (!this.video.paused) this.scheduleIdle();
    }

    scheduleIdle() {
      this.clearIdleTimer();
      this.idleTimer = setTimeout(() => {
        if (!this.video.paused && !this.dragging && this.qualityMenu.hidden && this.settingsMenu.hidden) {
          this.root.classList.add('tdvr-idle');
        }
      }, 2500);
    }

    clearIdleTimer() {
      if (this.idleTimer) {
        clearTimeout(this.idleTimer);
        this.idleTimer = null;
      }
    }

    closeMenus() {
      this.qualityMenu.hidden = true;
      this.settingsMenu.hidden = true;
    }

    showToast(text, duration = 5000) {
      if (!this.toastEl) return;
      this.toastEl.textContent = text;
      this.toastEl.hidden = false;
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => {
        if (this.toastEl) this.toastEl.hidden = true;
      }, duration);
    }

    fail(error) {
      if (this.destroyed) return;
      console.warn('[TwitchDVR] failure', error);
      this.app.useNative({ message: 'DVR остановлен из-за ошибки. Включён стандартный плеер.' });
    }

    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      this.generation += 1;
      this.abortFetch();
      clearInterval(this.uiTimer);
      clearInterval(this.playlistTimer);
      clearInterval(this.guardTimer);
      clearTimeout(this.idleTimer);
      clearTimeout(this.spinnerDelay);
      clearTimeout(this.toastTimer);
      if (this.onKeyDown) document.removeEventListener('keydown', this.onKeyDown, true);
      if (this.onDocumentClick) document.removeEventListener('click', this.onDocumentClick);
      if (this.onVisibility) document.removeEventListener('visibilitychange', this.onVisibility);
      if (this.onFullscreenChange) document.removeEventListener('fullscreenchange', this.onFullscreenChange);
      if (this.onWindowResize) window.removeEventListener('resize', this.onWindowResize);
      try { this.engine && this.engine.destroy(); } catch { /* ignored */ }
      if (this.video) {
        try { this.video.pause(); } catch { /* ignored */ }
        this.video.removeAttribute('src');
        try { this.video.load(); } catch { /* ignored */ }
      }
      if (this.root) this.root.remove();
      if (this.container) {
        this.container.classList.remove('tdvr-active');
        if (this.originalContainerPosition !== null) {
          this.container.style.position = this.originalContainerPosition;
          this.originalContainerPosition = null;
        }
      }
      if (this.overlayContainer) this.overlayContainer.classList.remove('tdvr-active');
      this.restoreNativeState();
    }
  }

  class TwitchDvrApp {
    constructor() {
      this.login = null;
      this.player = null;
      this.loading = false;
      this.failedLogin = null;
      this.retryAt = 0;
      this.fab = null;
      this.container = null;
      this.toastEl = null;
      this.toastTimer = null;
      this.startAttempts = 0;
      this.readyCandidate = null;
      this.readySince = 0;
      setInterval(() => this.tick(), 800);
      try {
        const notice = sessionStorage.getItem('tdvr:notice');
        if (notice) {
          sessionStorage.removeItem('tdvr:notice');
          setTimeout(() => this.toast(notice), 1200);
        }
      } catch { /* ignored */ }
      this.tick();
    }

    isPlayerReady(container) {
      if (this.readyCandidate !== container) {
        this.readyCandidate = container;
        this.readySince = Date.now();
        return false;
      }
      if (Date.now() - this.readySince < 1000) return false;
      const rect = container.getBoundingClientRect();
      if (rect.width < 160 || rect.height < 90) return false;
      const nativeVideo = container.querySelector('video');
      if (!nativeVideo) return false;
      if (nativeVideo.readyState < 1 && !nativeVideo.videoWidth) return false;
      return true;
    }

    tick() {
      const login = channelLoginFromPath(location.pathname);
      const container = findPlayerContainer();
      if (!login || !container) {
        this.teardown();
        return;
      }
      if (this.login !== login) {
        this.teardown();
        this.login = login;
        this.startAttempts = 0;
        this.readyCandidate = null;
      }
      this.container = container;

      if (this.player && (!this.player.root.isConnected || this.player.container !== container)) {
        this.destroyPlayer();
        this.failedLogin = null;
      }

      if (!this.enabled()) {
        if (this.player) this.destroyPlayer();
        this.ensureFab();
        return;
      }

      if (this.failedLogin === login && this.retryAt && Date.now() >= this.retryAt) {
        this.failedLogin = null;
        this.retryAt = 0;
      }

      if (this.player) {
        if (this.fab) this.fab.hidden = true;
        return;
      }
      if (this.loading) return;
      if (this.failedLogin === login) {
        if (!this.retryAt) this.ensureFab();
        return;
      }
      if (!this.isPlayerReady(container)) return;
      this.startPlayer();
    }

    enabled() {
      return storeGet(STORAGE.enabled) !== '0';
    }

    async startPlayer() {
      if (this.loading || this.player) return;
      const login = this.login;
      const container = this.container;
      if (!login || !container || !container.isConnected) return;
      this.loading = true;
      let player = null;
      try {
        player = new DvrPlayer(this, login, container);
        await player.start();
        if (this.login !== login || !player.root.isConnected) {
          player.destroy();
          return;
        }
        this.player = player;
        this.failedLogin = null;
        this.retryAt = 0;
        this.startAttempts = 0;
        if (this.fab) this.fab.hidden = true;
      } catch (error) {
        if (player) player.destroy();
        const code = error && error.code ? error.code : 'UNKNOWN';
        console.warn('[TwitchDVR] start failed:', code, error);
        if (code === 'MEDIA' || code === 'VIDEO') {
          this.startAttempts += 1;
          if (this.startAttempts < 3) {
            this.failedLogin = login;
            this.retryAt = Date.now() + 3000;
            return;
          }
        }
        const message = errorMessage(code);
        if (code === 'STREAM_OFFLINE') {
          this.failedLogin = login;
          this.retryAt = Date.now() + 60000;
          if (this.fab) this.fab.hidden = true;
        } else {
          this.failedLogin = login;
          this.retryAt = 0;
          if (message) this.toast(message);
          this.ensureFab();
        }
      } finally {
        this.loading = false;
      }
    }

    restart() {
      if (this.player) this.destroyPlayer();
      this.failedLogin = null;
      this.retryAt = 0;
      this.startPlayer();
    }

    useNative(options = {}) {
      this.destroyPlayer();
      storeSet(STORAGE.enabled, '0');
      try {
        sessionStorage.setItem('tdvr:notice', options.message || 'Включён стандартный плеер Twitch. Кнопка DVR вернёт режим перемотки.');
      } catch { /* ignored */ }
      location.reload();
    }

    enableDvr() {
      storeSet(STORAGE.enabled, '1');
      location.reload();
    }

    destroyPlayer() {
      if (this.player) {
        try { this.player.destroy(); } catch { /* ignored */ }
        this.player = null;
      }
    }

    ensureFab() {
      if (!this.container || !this.container.isConnected) return;
      if (this.ensureNativeDvrButton()) {
        if (this.fab) this.fab.hidden = true;
        return;
      }
      if (!this.fab) {
        this.fab = document.createElement('button');
        this.fab.type = 'button';
        this.fab.className = 'tdvr-fab';
        this.fab.textContent = 'DVR';
        this.fab.title = 'Включить DVR-плеер';
        this.fab.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.enableDvr();
        });
      }
      if (this.fab.parentElement !== this.container) this.container.appendChild(this.fab);
      this.fab.hidden = false;
    }

    nativeControlScopes() {
      const scopes = [];
      if (this.container && this.container.isConnected) scopes.push(this.container);
      const player = document.querySelector('.persistent-player .video-player');
      if (player) scopes.push(player);
      const overlay = document.querySelector('.video-player__container');
      if (overlay) scopes.push(overlay);
      return [...new Set(scopes)];
    }

    findNativeControlAnchor() {
      for (const scope of this.nativeControlScopes()) {
        let settings = scope.querySelector('[data-a-target="player-settings-button"]');
        if (!settings) {
          settings = scope.querySelector('button[aria-label*="Настройки"], button[aria-label*="Settings"]');
        }
        if (settings && settings.parentElement) {
          const first = settings.parentElement.querySelector('button');
          return { parent: settings.parentElement, before: first || settings, template: settings };
        }
        let fullscreen = scope.querySelector('[data-a-target="player-fullscreen-button"]');
        if (!fullscreen) {
          fullscreen = scope.querySelector('button[aria-label*="полноэкран"], button[aria-label*="Fullscreen"]');
        }
        if (fullscreen && fullscreen.parentElement) {
          const first = fullscreen.parentElement.querySelector('button');
          return { parent: fullscreen.parentElement, before: first || fullscreen, template: fullscreen };
        }
      }
      return null;
    }

    ensureNativeDvrButton() {
      const anchor = this.findNativeControlAnchor();
      if (!anchor) return false;
      const existing = anchor.parent.querySelector('.tdvr-native-button');
      if (existing && existing.nextElementSibling === anchor.before) return true;
      if (existing) existing.remove();
      document.querySelectorAll('.tdvr-native-button').forEach((button) => button.remove());

      const templateClass = typeof anchor.template.className === 'string'
        ? anchor.template.className
        : (anchor.template.getAttribute('class') || '');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `${templateClass} tdvr-native-button`.trim();
      button.setAttribute('aria-label', 'DVR — включить перемотку эфира');
      button.title = 'DVR — перемотка эфира';
      button.innerHTML = '<span class="tdvr-native-label">DVR</span>';
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.enableDvr();
      });
      anchor.parent.insertBefore(button, anchor.before);
      return true;
    }

    hideFab() {
      if (this.fab) this.fab.hidden = true;
    }

    teardown() {
      this.destroyPlayer();
      if (this.fab) {
        this.fab.remove();
        this.fab = null;
      }
      document.querySelectorAll('.tdvr-native-button').forEach((button) => button.remove());
      this.login = null;
      this.container = null;
      this.failedLogin = null;
      this.retryAt = 0;
      this.loading = false;
      this.startAttempts = 0;
      this.readyCandidate = null;
    }

    toast(message) {
      if (!this.toastEl) {
        this.toastEl = document.createElement('div');
        this.toastEl.className = 'tdvr-app-toast';
        document.body.appendChild(this.toastEl);
      }
      this.toastEl.textContent = message;
      this.toastEl.hidden = false;
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => {
        if (this.toastEl) this.toastEl.hidden = true;
      }, 7000);
    }
  }

  new TwitchDvrApp();
})();
