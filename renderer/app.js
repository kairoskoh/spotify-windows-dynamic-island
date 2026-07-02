'use strict';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const island        = document.getElementById('island');
const waveform      = document.getElementById('waveform');
const collapsedTitle = document.getElementById('collapsed-title');

const playerPanel   = document.getElementById('player-panel');
const setupPanel    = document.getElementById('setup-panel');

const albumArt      = document.getElementById('album-art');
const trackNameEl   = document.getElementById('track-name');
const artistNameEl  = document.getElementById('artist-name');
const progressTrack = document.getElementById('progress-track');
const progressFill  = document.getElementById('progress-fill');
const timeCurrent   = document.getElementById('time-current');
const timeTotal     = document.getElementById('time-total');
const playPauseBtn  = document.getElementById('btn-play-pause');
const prevBtn       = document.getElementById('btn-prev');
const nextBtn       = document.getElementById('btn-next');

const clientIdInput  = document.getElementById('client-id-input');
const btnConnect     = document.getElementById('btn-connect');
const btnDashboard   = document.getElementById('btn-dashboard');

const btnMenu        = document.getElementById('btn-menu');
const btnQuit        = document.getElementById('btn-quit');
const menuDropdown   = document.getElementById('menu-dropdown');
const menuChangeId   = document.getElementById('menu-change-id');
const menuGuide      = document.getElementById('menu-guide');
const quitOverlay    = document.getElementById('quit-overlay');
const btnQuitCancel  = document.getElementById('btn-quit-cancel');
const btnQuitConfirm = document.getElementById('btn-quit-confirm');
const btnBack        = document.getElementById('btn-back');
const positionToggle = document.getElementById('position-toggle');

// ── State ─────────────────────────────────────────────────────────────────────
let currentData   = null;
let isExpanded    = false;
let inUserSetup   = false; // true when user manually opened setup; blocks poll from switching back

// Progress interpolation between 1-second API polls
let interpMs        = 0;
let interpDuration  = 0;
let interpPlaying   = false;
let interpRaf       = null;
let interpLast      = 0;

// Scrubbing state
let isScrubbing     = false;

// ── Utilities ─────────────────────────────────────────────────────────────────
function msToTime(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m   = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ── Panel switching ───────────────────────────────────────────────────────────
function showPlayer() {
  inUserSetup = false;
  btnBack.style.display = 'none';
  playerPanel.classList.remove('hidden');
  setupPanel.classList.add('hidden');
  island.classList.remove('setup-mode');
}

function showSetup(fromUser = false) {
  btnBack.style.display = fromUser ? 'flex' : 'none';
  if (fromUser) {
    inUserSetup = true;
    // Pre-fill with the currently saved Client ID
    window.spotify.getClientId().then(id => { if (id) clientIdInput.value = id; });
  }
  playerPanel.classList.add('hidden');
  setupPanel.classList.remove('hidden');
  island.classList.add('expanded', 'setup-mode');
  window.spotify.setIgnoreMouse(false);
  isExpanded = true;
}

// ── Expand / collapse ─────────────────────────────────────────────────────────
function expand() {
  if (isExpanded) return;
  isExpanded = true;
  island.classList.add('expanded');
  window.spotify.setIgnoreMouse(false);
}

function collapse() {
  if (!isExpanded) return;
  if (!quitOverlay.classList.contains('hidden'))  return;
  if (!menuDropdown.classList.contains('hidden')) return;
  isExpanded = false;
  island.classList.remove('expanded');
  window.spotify.setIgnoreMouse(true, { forward: true });
}

function maybeCollapse() {
  if (!island.matches(':hover')) collapse();
}

island.addEventListener('mouseenter', expand);
island.addEventListener('mouseleave', collapse);

// ── Progress interpolation ────────────────────────────────────────────────────
function stopInterp() {
  cancelAnimationFrame(interpRaf);
  interpRaf = null;
}

function startInterp() {
  stopInterp();
  if (!interpPlaying || !interpDuration) return;
  interpLast = performance.now();

  function tick(now) {
    const delta = now - interpLast;
    interpLast  = now;
    interpMs    = clamp(interpMs + delta, 0, interpDuration);

    if (!isScrubbing) {
      const pct = interpMs / interpDuration * 100;
      progressFill.style.width = pct.toFixed(2) + '%';
      progressTrack.style.setProperty('--pos', pct.toFixed(2) + '%');
      timeCurrent.textContent  = msToTime(interpMs);
    }

    if (interpMs < interpDuration) {
      interpRaf = requestAnimationFrame(tick);
    }
  }

  interpRaf = requestAnimationFrame(tick);
}

// ── Progress bar seek ─────────────────────────────────────────────────────────
function seekAt(clientX) {
  const rect   = progressTrack.getBoundingClientRect();
  const pct    = clamp((clientX - rect.left) / rect.width, 0, 1);
  const posMs  = Math.round(pct * interpDuration);
  interpMs     = posMs;

  progressFill.style.width = (pct * 100).toFixed(2) + '%';
  progressTrack.style.setProperty('--pos', (pct * 100).toFixed(2) + '%');
  timeCurrent.textContent  = msToTime(posMs);

  window.spotify.command('seek', { positionMs: posMs });
}

progressTrack.addEventListener('mousedown', (e) => {
  isScrubbing = true;
  progressFill.classList.add('scrubbing');
  seekAt(e.clientX);

  function onMove(ev) { seekAt(ev.clientX); }
  function onUp()     {
    isScrubbing = false;
    progressFill.classList.remove('scrubbing');
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup',   onUp);
  }

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup',   onUp);
});

// ── Playback controls ─────────────────────────────────────────────────────────
playPauseBtn.addEventListener('click', () => {
  if (!currentData) return;
  window.spotify.command(currentData.isPlaying ? 'pause' : 'play');
  // Optimistic UI update
  currentData.isPlaying = !currentData.isPlaying;
  syncPlayPauseBtn(currentData.isPlaying);
  syncWaveform(currentData.isPlaying);
  if (currentData.isPlaying) {
    interpPlaying = true; startInterp();
  } else {
    interpPlaying = false; stopInterp();
  }
});

prevBtn.addEventListener('click', () => window.spotify.command('prev'));
nextBtn.addEventListener('click', () => window.spotify.command('next'));

// ── UI sync helpers ───────────────────────────────────────────────────────────
function syncPlayPauseBtn(playing) {
  playPauseBtn.classList.toggle('playing', playing);
}

function syncWaveform(playing, noData) {
  waveform.classList.remove('paused', 'idle');
  if      (noData)  waveform.classList.add('idle');
  else if (!playing) waveform.classList.add('paused');
}

let lastAlbumUrl = '';

function applyPlaybackData(data) {
  if (inUserSetup) return;
  currentData = data;

  if (!data) {
    // No active playback device
    stopInterp();
    interpPlaying  = false;
    interpMs       = 0;
    interpDuration = 0;

    syncWaveform(false, true);
    collapsedTitle.textContent = 'No active device';
    trackNameEl.textContent    = '—';
    artistNameEl.textContent   = '—';
    timeCurrent.textContent    = '0:00';
    timeTotal.textContent      = '0:00';
    progressFill.style.width   = '0%';
    progressTrack.style.setProperty('--pos', '0%');
    syncPlayPauseBtn(false);
    showPlayer();
    return;
  }

  const { isPlaying, trackName, artistName, albumArtUrl, progressMs, durationMs } = data;

  // Sync waveform
  syncWaveform(isPlaying, false);

  // Collapsed pill title
  collapsedTitle.textContent = trackName;

  // Expanded track info
  trackNameEl.textContent  = trackName;
  artistNameEl.textContent = artistName;

  // Album art – only update DOM when URL changes to avoid flicker
  if (albumArtUrl && albumArtUrl !== lastAlbumUrl) {
    albumArt.classList.add('loading');
    albumArt.onload = () => albumArt.classList.remove('loading');
    albumArt.src    = albumArtUrl;
    lastAlbumUrl    = albumArtUrl;
  }

  // Total time label
  timeTotal.textContent = msToTime(durationMs);

  // Play/pause button
  syncPlayPauseBtn(isPlaying);

  // Progress interpolation
  interpDuration = durationMs;
  interpPlaying  = isPlaying;
  // Resync: accept API value if drift > 1.5 s
  if (Math.abs(progressMs - interpMs) > 1500 || !interpPlaying) {
    interpMs = progressMs;
  }

  stopInterp();
  if (!isScrubbing) {
    const pct = interpDuration > 0 ? interpMs / interpDuration * 100 : 0;
    progressFill.style.width = pct.toFixed(2) + '%';
    progressTrack.style.setProperty('--pos', pct.toFixed(2) + '%');
    timeCurrent.textContent  = msToTime(interpMs);
  }
  if (isPlaying) startInterp();

  showPlayer();
}

// ── IPC listeners ─────────────────────────────────────────────────────────────
window.spotify.onPlayback(applyPlaybackData);

window.spotify.onAuthSuccess(() => {
  clearAuthTimeout();
  btnConnect.textContent = 'Connect';
  btnConnect.disabled    = false;
  collapsedTitle.textContent = 'Connecting…';
  syncWaveform(false, true);
  showPlayer(); // player panel while first poll arrives
});

window.spotify.onAuthRequired(() => {
  stopInterp();
  showSetup();
  expand();
  collapsedTitle.textContent = 'Connect Spotify';
});

window.spotify.onShowSetup(() => {
  showSetup();
  expand();
});

window.spotify.onAuthError((msg) => {
  clearAuthTimeout();
  resetConnectBtn();
  showSetupError('Auth failed');
});

// ── Back button ──────────────────────────────────────────────────────────────
btnBack.addEventListener('click', () => {
  showPlayer();
});

// ── Toolbar: three-dot menu ───────────────────────────────────────────────────
btnMenu.addEventListener('click', (e) => {
  e.stopPropagation();
  menuDropdown.classList.toggle('hidden');
});

document.addEventListener('click', () => {
  if (!menuDropdown.classList.contains('hidden')) {
    menuDropdown.classList.add('hidden');
    maybeCollapse();
  }
});

menuDropdown.addEventListener('click', (e) => e.stopPropagation());

// ── Hover-to-open / leave-to-close ───────────────────────────────────────────
let menuHoverTimer = null;

function openMenuDropdown() {
  clearTimeout(menuHoverTimer);
  menuDropdown.classList.remove('hidden');
}

function scheduleMenuClose() {
  menuHoverTimer = setTimeout(() => {
    menuDropdown.classList.add('hidden');
    maybeCollapse();
  }, 80);
}

btnMenu.addEventListener('mouseenter', openMenuDropdown);
btnMenu.addEventListener('mouseleave', scheduleMenuClose);
menuDropdown.addEventListener('mouseenter', () => clearTimeout(menuHoverTimer));
menuDropdown.addEventListener('mouseleave', () => {
  menuDropdown.classList.add('hidden');
  maybeCollapse();
});

menuChangeId.addEventListener('click', () => {
  menuDropdown.classList.add('hidden');
  showSetup(true);
});

// ── Position toggle (inside dropdown) ────────────────────────────────────────
positionToggle.addEventListener('click', () => {
  const isBottom = positionToggle.classList.toggle('bottom-active');
  island.classList.toggle('bottom-mode', isBottom);
  window.spotify.setPosition(isBottom ? 'bottom' : 'top');
  menuDropdown.classList.add('hidden');
  maybeCollapse();
});

// ── Toolbar: quit button ──────────────────────────────────────────────────────
btnQuit.addEventListener('click', () => {
  menuDropdown.classList.add('hidden');
  quitOverlay.classList.remove('hidden');
  island.classList.add('quit-mode');
});

btnQuitCancel.addEventListener('click', () => {
  quitOverlay.classList.add('hidden');
  island.classList.remove('quit-mode');
  maybeCollapse();
});

btnQuitConfirm.addEventListener('click', () => {
  playQuitSound();
  setTimeout(() => window.spotify.quitApp(), 620);
});

// ── Setup panel helpers ───────────────────────────────────────────────────────
let errorCountdown = null;
let authTimeout    = null;

function resetConnectBtn() {
  btnConnect.textContent = 'Connect';
  btnConnect.disabled    = false;
}

function clearAuthTimeout() {
  clearTimeout(authTimeout);
  authTimeout = null;
}

function showSetupError(msg) {
  clearInterval(errorCountdown);
  const saved = clientIdInput.value;
  let secs = 3;

  clientIdInput.value    = `${msg} (${secs})`;
  clientIdInput.disabled = true;
  clientIdInput.classList.add('error');

  errorCountdown = setInterval(() => {
    secs--;
    if (secs <= 0) {
      clearInterval(errorCountdown);
      clientIdInput.value    = saved;
      clientIdInput.disabled = false;
      clientIdInput.classList.remove('error');
    } else {
      clientIdInput.value = `${msg} (${secs})`;
    }
  }, 1000);
}

// ── Setup panel interactions ──────────────────────────────────────────────────
btnConnect.addEventListener('click', () => {
  const id = clientIdInput.value.trim();
  if (!id) { clientIdInput.focus(); return; }

  if (!/^[0-9a-f]{32}$/i.test(id)) {
    showSetupError('Invalid ID');
    return;
  }

  window.spotify.saveClientId(id);
  btnConnect.textContent = 'Connecting…';
  btnConnect.disabled    = true;

  // Re-enable if Spotify never calls back (e.g. network issue)
  authTimeout = setTimeout(() => {
    resetConnectBtn();
    showSetupError('Timed out');
  }, 30000);
});

clientIdInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') btnConnect.click();
});

btnDashboard.addEventListener('click', () => {
  window.spotify.openGuide();
});

// ── Quit sound ────────────────────────────────────────────────────────────────
function playQuitSound() {
  try {
    const ctx = new AudioContext();
    const t   = ctx.currentTime;

    const delay     = ctx.createDelay(0.5);
    const delayGain = ctx.createGain();
    delay.delayTime.value = 0.15;
    delayGain.gain.value  = 0.20;
    delay.connect(delayGain);
    delayGain.connect(ctx.destination);

    function sweep(startHz, endHz, startT, dur, vol) {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(startHz, t + startT);
      osc.frequency.exponentialRampToValueAtTime(endHz, t + startT + dur * 0.8);
      gain.gain.setValueAtTime(vol, t + startT);
      gain.gain.exponentialRampToValueAtTime(0.001, t + startT + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      gain.connect(delay);
      osc.start(t + startT);
      osc.stop(t + startT + dur);
    }

    sweep(1040,  260, 0.00, 0.55, 0.10); // base descending
    sweep(2080,  520, 0.05, 0.45, 0.06); // upper harmonic descending
    sweep(2600,  650, 0.00, 0.30, 0.04); // shimmer descending

    setTimeout(() => ctx.close(), 1200);
  } catch (_) { /* audio unavailable */ }
}

// ── Welcome sound ─────────────────────────────────────────────────────────────
function playWelcomeSound() {
  try {
    const ctx = new AudioContext();
    const t   = ctx.currentTime;

    // Shared delay for a subtle echo/space feel
    const delay     = ctx.createDelay(0.5);
    const delayGain = ctx.createGain();
    delay.delayTime.value  = 0.18;
    delayGain.gain.value   = 0.25;
    delay.connect(delayGain);
    delayGain.connect(ctx.destination);

    function sweep(startHz, endHz, startT, dur, vol) {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(startHz, t + startT);
      osc.frequency.exponentialRampToValueAtTime(endHz, t + startT + dur * 0.7);
      gain.gain.setValueAtTime(0, t + startT);
      gain.gain.linearRampToValueAtTime(vol, t + startT + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, t + startT + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      gain.connect(delay);
      osc.start(t + startT);
      osc.stop(t + startT + dur);
    }

    sweep(260,  1040, 0.00, 0.55, 0.10); // base sweep
    sweep(520,  2080, 0.08, 0.45, 0.06); // upper harmonic
    sweep(1300, 2600, 0.20, 0.30, 0.04); // shimmer

    setTimeout(() => ctx.close(), 1500);
  } catch (_) { /* audio unavailable */ }
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  const [clientId, authed, pos] = await Promise.all([
    window.spotify.getClientId(),
    window.spotify.isAuthenticated(),
    window.spotify.getPosition()
  ]);

  playWelcomeSound();

  // Apply saved island position
  island.classList.toggle('bottom-mode', pos === 'bottom');
  positionToggle.classList.toggle('bottom-active', pos === 'bottom');

  if (!clientId) {
    collapsedTitle.textContent = 'Setup required ↗';
    syncWaveform(false, true);
    showSetup();
  } else if (!authed) {
    collapsedTitle.textContent = 'Connect Spotify ↗';
    syncWaveform(false, true);
    clientIdInput.value = clientId; // pre-fill known ID
    showSetup();
  } else {
    collapsedTitle.textContent = 'Connecting…';
    syncWaveform(false, true);
    showPlayer();
  }
}

init();
