'use strict';

const {
  app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell, screen
} = require('electron');
const path        = require('path');
const Store       = require('electron-store');
const http        = require('http');
const https       = require('https');
const zlib        = require('zlib');
const crypto      = require('crypto');
const querystring = require('querystring');

// ── Persistent store ──────────────────────────────────────────────────────────
const store = new Store({ encryptionKey: 'sdi-v1' });

// ── Global refs ───────────────────────────────────────────────────────────────
let mainWindow       = null;
let tray             = null;
let authServer       = null;
let pollTimer        = null;
let tokenRefreshTimer = null;
let codeVerifier     = null;

// ── Spotify OAuth constants ───────────────────────────────────────────────────
const REDIRECT_PORT = 8888;
const REDIRECT_URI  = `http://127.0.0.1:${REDIRECT_PORT}/callback`;
const SCOPES        = [
  'user-read-playback-state',
  'user-read-currently-playing',
  'user-modify-playback-state'
].join(' ');

// ── Tray icon: programmatically generate a 16×16 Spotify-green circle PNG ────
function buildTrayIconBuffer() {
  const W = 16, H = 16;
  const rows = [];

  for (let y = 0; y < H; y++) {
    const row = Buffer.alloc(1 + W * 3);
    row[0] = 0; // PNG filter type None
    for (let x = 0; x < W; x++) {
      const dx = x - 7.5, dy = y - 7.5;
      const inside = Math.sqrt(dx * dx + dy * dy) <= 7;
      row[1 + x * 3] = inside ? 29  : 0;
      row[2 + x * 3] = inside ? 185 : 0;
      row[3 + x * 3] = inside ? 84  : 0;
    }
    rows.push(row);
  }

  const raw        = Buffer.concat(rows);
  const compressed = zlib.deflateSync(raw);

  // Minimal CRC-32
  function crc32(buf) {
    const t = [];
    for (let i = 0; i < 256; i++) {
      let v = i;
      for (let j = 0; j < 8; j++) v = v & 1 ? 0xedb88320 ^ (v >>> 1) : v >>> 1;
      t[i] = v;
    }
    let c = 0xffffffff;
    for (const b of buf) c = t[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function chunk(type, data) {
    const tb  = Buffer.from(type);
    const lb  = Buffer.alloc(4);  lb.writeUInt32BE(data.length);
    const cb  = Buffer.alloc(4);  cb.writeUInt32BE(crc32(Buffer.concat([tb, data])));
    return Buffer.concat([lb, tb, data, cb]);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ── PKCE helpers ──────────────────────────────────────────────────────────────
function pkceVerifier()         { return crypto.randomBytes(32).toString('base64url'); }
function pkceChallenge(v)       { return crypto.createHash('sha256').update(v).digest('base64url'); }

// ── Raw HTTPS helpers (no axios/node-fetch needed) ────────────────────────────
function spotifyRequest(method, apiPath, body, token) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.spotify.com',
      path: apiPath,
      method,
      headers: {
        'Authorization':   `Bearer ${token}`,
        'Content-Type':    'application/json',
        'Accept-Encoding': 'identity'
      }
    };
    const req = https.request(opts, (res) => {
      let raw = '';
      res.on('data', d => { raw += d; });
      res.on('end', () => {
        if (res.statusCode >= 400) return reject({ status: res.statusCode, raw });
        let body = null;
        if (raw) { try { body = JSON.parse(raw); } catch { body = null; } }
        resolve({ status: res.statusCode, body });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function spotifyTokenRequest(params) {
  return new Promise((resolve, reject) => {
    const body = querystring.stringify(params);
    const opts = {
      hostname: 'accounts.spotify.com',
      path: '/api/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(opts, (res) => {
      let raw = '';
      res.on('data', d => { raw += d; });
      res.on('end', () => {
        const parsed = JSON.parse(raw);
        res.statusCode >= 400 ? reject(parsed) : resolve(parsed);
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Token management ──────────────────────────────────────────────────────────
async function doRefreshToken() {
  const rt  = store.get('refreshToken');
  const cid = store.get('clientId');
  if (!rt || !cid) return null;
  try {
    const data = await spotifyTokenRequest({
      grant_type: 'refresh_token', refresh_token: rt, client_id: cid
    });
    store.set('accessToken', data.access_token);
    if (data.refresh_token) store.set('refreshToken', data.refresh_token);
    scheduleTokenRefresh(data.expires_in);
    return data.access_token;
  } catch {
    store.delete('accessToken');
    return null;
  }
}

function scheduleTokenRefresh(expiresIn) {
  clearTimeout(tokenRefreshTimer);
  tokenRefreshTimer = setTimeout(doRefreshToken, (expiresIn - 60) * 1000);
}

// ── OAuth flow ────────────────────────────────────────────────────────────────
function startAuth() {
  const clientId = store.get('clientId');
  if (!clientId) {
    mainWindow?.webContents.send('show-setup');
    return;
  }

  codeVerifier    = pkceVerifier();
  const state     = crypto.randomBytes(16).toString('hex');
  store.set('oauthState', state);

  const params = new URLSearchParams({
    client_id:             clientId,
    response_type:         'code',
    redirect_uri:          REDIRECT_URI,
    code_challenge_method: 'S256',
    code_challenge:        pkceChallenge(codeVerifier),
    state,
    scope:                 SCOPES,
    show_dialog:           'false'
  });

  shell.openExternal(`https://accounts.spotify.com/authorize?${params}`);
  openAuthServer();
}

function openAuthServer() {
  if (authServer) { authServer.close(); authServer = null; }

  authServer = http.createServer(async (req, res) => {
    const url   = new URL(req.url, `http://localhost:${REDIRECT_PORT}`);
    if (url.pathname !== '/callback') { res.end(); return; }

    const code  = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html><html><body style="font-family:system-ui;text-align:center;padding:60px;background:#111;color:#fff">
      <h2 style="color:${error ? '#ff4444' : '#1DB954'}">${error ? 'Authentication failed' : 'Connected to Spotify!'}</h2>
      <p style="color:rgba(255,255,255,.55)">You can close this tab.</p>
      <script>setTimeout(()=>window.close(),2000)</script>
    </body></html>`);

    if (error || !code || state !== store.get('oauthState')) {
      mainWindow?.webContents.send('auth-error', error || 'State mismatch');
      authServer.close(); authServer = null;
      return;
    }

    try {
      const data = await spotifyTokenRequest({
        grant_type:    'authorization_code',
        code,
        redirect_uri:  REDIRECT_URI,
        client_id:     store.get('clientId'),
        code_verifier: codeVerifier
      });
      store.set('accessToken',  data.access_token);
      store.set('refreshToken', data.refresh_token);
      scheduleTokenRefresh(data.expires_in);
      mainWindow?.webContents.send('auth-success');
      startPolling();
      rebuildTrayMenu();
    } catch (err) {
      mainWindow?.webContents.send('auth-error', err?.error_description || 'Token exchange failed');
    }

    authServer.close(); authServer = null;
  });

  authServer.listen(REDIRECT_PORT);
  authServer.on('error', (err) => console.error('[auth-server]', err.message));
}

// ── Spotify polling ───────────────────────────────────────────────────────────
async function pollPlayback() {
  const token = store.get('accessToken');
  if (!token) return;

  try {
    const res = await spotifyRequest(
      'GET', '/v1/me/player?additional_types=track', null, token
    );

    if (res.status === 204 || !res.body) {
      mainWindow?.webContents.send('playback', null);
      return;
    }

    const d = res.body;
    mainWindow?.webContents.send('playback', {
      isPlaying:    d.is_playing,
      trackId:      d.item?.id       || '',
      trackName:    d.item?.name     || '—',
      artistName:   d.item?.artists?.map(a => a.name).join(', ') || '—',
      albumArtUrl:  d.item?.album?.images?.[1]?.url || d.item?.album?.images?.[0]?.url || '',
      progressMs:   d.progress_ms    || 0,
      durationMs:   d.item?.duration_ms || 0,
      deviceName:   d.device?.name   || '',
      shuffleState: d.shuffle_state,
      repeatState:  d.repeat_state
    });
  } catch (err) {
    if (err?.status === 401) {
      const newToken = await doRefreshToken();
      if (!newToken) {
        mainWindow?.webContents.send('auth-required');
        stopPolling();
        rebuildTrayMenu();
      }
    }
  }
}

function startPolling() {
  stopPolling();
  pollPlayback();
  pollTimer = setInterval(pollPlayback, 1000);
}

function stopPolling() {
  clearInterval(pollTimer);
  pollTimer = null;
}

// ── Spotify playback commands ─────────────────────────────────────────────────
async function handleCommand(action, data) {
  let token = store.get('accessToken');
  if (!token) return;

  try {
    switch (action) {
      case 'play':   await spotifyRequest('PUT',  '/v1/me/player/play',     null, token); break;
      case 'pause':  await spotifyRequest('PUT',  '/v1/me/player/pause',    null, token); break;
      case 'next':   await spotifyRequest('POST', '/v1/me/player/next',     null, token); break;
      case 'prev':   await spotifyRequest('POST', '/v1/me/player/previous', null, token); break;
      case 'seek':
        await spotifyRequest('PUT', `/v1/me/player/seek?position_ms=${data.positionMs}`, null, token);
        break;
    }
    setTimeout(pollPlayback, 300);
  } catch (err) {
    if (err?.status === 401) {
      const t = await doRefreshToken();
      if (t) handleCommand(action, data);
    }
  }
}

// ── Window positioning ────────────────────────────────────────────────────────
function repositionWindow(pos) {
  if (!mainWindow) return;
  const { x: wx, y: wy, width: ww, height: wh } = screen.getPrimaryDisplay().workArea;
  const { width: W, height: H } = mainWindow.getBounds();
  const x = wx + Math.round((ww - W) / 2);
  const y = pos === 'bottom' ? wy + wh - H : wy;
  mainWindow.setPosition(x, y);
}

// ── Main window ───────────────────────────────────────────────────────────────
function createWindow() {
  const { x: wx, y: wy, width: ww, height: wh } = screen.getPrimaryDisplay().workArea;
  const W = 460, H = 220;
  const savedPos = store.get('windowPosition') || 'top';
  const x = wx + Math.round((ww - W) / 2);
  const y = savedPos === 'bottom' ? wy + wh - H : wy;

  mainWindow = new BrowserWindow({
    width:           W,
    height:          H,
    x,
    y,
    frame:           false,
    transparent:     true,
    alwaysOnTop:     true,
    skipTaskbar:     true,
    resizable:       false,
    movable:         false,
    focusable:       true,
    hasShadow:       false,
    roundedCorners:  false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      sandbox:          true
    }
  });

  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.setVisibleOnAllWorkspaces(true);
  mainWindow.setIgnoreMouseEvents(true, { forward: true });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── Tray ──────────────────────────────────────────────────────────────────────
function createTray() {
  const icon = nativeImage.createFromBuffer(buildTrayIconBuffer());
  tray = new Tray(icon);
  tray.setToolTip('Spotify Dynamic Island');
  rebuildTrayMenu();
}

function rebuildTrayMenu() {
  const hasId    = !!store.get('clientId');
  const hasToken = !!store.get('accessToken');

  const menu = Menu.buildFromTemplate([
    { label: 'Spotify Dynamic Island', enabled: false },
    { type: 'separator' },
    ...(hasId ? [
      { label: hasToken ? 'Reconnect Spotify' : 'Connect Spotify', click: startAuth }
    ] : [
      { label: 'Setup → enter Client ID', click: () => mainWindow?.webContents.send('show-setup') }
    ]),
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]);

  tray.setContextMenu(menu);
}

// ── IPC handlers ──────────────────────────────────────────────────────────────
function registerIPC() {
  ipcMain.on('set-ignore-mouse', (_, ignore, opts) => {
    mainWindow?.setIgnoreMouseEvents(ignore, opts ?? {});
  });

  ipcMain.on('spotify-command', (_, action, data) => handleCommand(action, data));

  ipcMain.handle('get-client-id',     () => store.get('clientId')    || '');
  ipcMain.handle('is-authenticated',  () => !!store.get('accessToken'));

  ipcMain.on('save-client-id', (_, id) => {
    store.set('clientId', id.trim());
    rebuildTrayMenu();
    startAuth();
  });

  ipcMain.on('start-auth', startAuth);

  ipcMain.on('quit-app',   () => app.quit());
  ipcMain.on('open-guide', () => shell.openPath(path.join(__dirname, 'guide', 'setup-guide.html')));

  ipcMain.handle('get-position', () => store.get('windowPosition') || 'top');
  ipcMain.on('set-position', (_, pos) => {
    store.set('windowPosition', pos);
    repositionWindow(pos);
  });
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow();
  createTray();
  registerIPC();

  if (store.get('accessToken')) {
    // Proactively refresh to ensure token is valid, then poll
    if (store.get('refreshToken')) {
      doRefreshToken().then(() => startPolling());
    } else {
      startPolling();
    }
  }
});

// Keep alive in tray after all windows close
app.on('window-all-closed', () => {});

app.on('before-quit', () => {
  stopPolling();
  clearTimeout(tokenRefreshTimer);
  authServer?.close();
});
