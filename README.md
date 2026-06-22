# Spotify Windows Dynamic Island

A Windows 10/11 overlay that mimics the iPhone Dynamic Island — a sleek dark pill that sits at the top-center of your screen and shows Spotify playback controls whenever music is playing.

---

## Preview

**Collapsed** — small pill with animated waveform and track title:

```
        ╭──────────────────────────────╮
        │  ▁▃▅▃▁  Blinding Lights      │
        ╰──────────────────────────────╯
```

**Expanded** (hover over the island):

```
  ╭──────────────────────────────────────────╮
  │  ┌──────┐   Blinding Lights              │
  │  │      │   The Weeknd                   │
  │  │  🎵  │   ━━━━━━━━━━━━╸━━━━━━  2:14   │
  │  │      │      ⏮   ⏸   ⏭               │
  │  └──────┘                                │
  ╰──────────────────────────────────────────╯
```

---

## Features

- **Dynamic Island style** — spring-animated pill that expands on hover
- **Animated waveform** — 5-bar Spotify-green wave bounces while playing, freezes when paused
- **Album art** — rounded cover art pulled live from Spotify
- **Track & artist** — updates instantly on track change
- **Progress bar** — smooth interpolation between 1-second API polls; click or drag to seek
- **Transport controls** — previous, play/pause, next
- **Always on top** — floats above all windows at screen-saver level
- **Click-through** — transparent areas pass clicks straight through to whatever is beneath
- **System tray** — right-click the green dot to reconnect or quit
- **Token refresh** — access tokens renew automatically in the background; stays connected indefinitely

---

## Requirements

- **Windows 10 or 11**
- **Node.js** (v18 or later) — [nodejs.org](https://nodejs.org)
- **A Spotify account** (free or Premium — playback control requires Premium)

---

## Project Structure

```
spotify-windows-dynamic-island/
├── main.js            ← Electron main process: window, tray, OAuth, API polling
├── preload.js         ← Secure IPC bridge between main and renderer
├── package.json
└── renderer/
    ├── index.html     ← Island HTML (collapsed + expanded layers)
    ├── style.css      ← Spring animation, waveform keyframes, layout
    └── app.js         ← Playback state, progress interpolation, controls
```

---

## One-Time Spotify Setup

You need a free Spotify Developer App to get a Client ID. This takes about 2 minutes.

1. Go to **[developer.spotify.com/dashboard](https://developer.spotify.com/dashboard)** and log in
2. Click **Create App**
3. Give it any name and description (e.g. "Dynamic Island")
4. Under **Redirect URIs**, add exactly:
   ```
   http://localhost:8888/callback
   ```
5. Click **Save**
6. On the app's page, copy your **Client ID**

> The Client ID is not a secret — it is safe to share. No Client Secret is required.

---

## Installation

```powershell
cd "c:\Users\kairo\Downloads\Coding2026\spotify-windows-dynamic-island"
npm install
```

---

## Running

```powershell
npm start
```

On first launch:

1. A small dark pill appears at the **top center** of your screen
2. **Right-click the green dot** in the system tray (bottom-right of taskbar)
3. Click **Setup → enter Client ID → Connect**
4. Your browser opens Spotify's login page — approve it
5. The tab closes automatically and the island is ready

From now on, just run `npm start` — the Client ID and refresh token are remembered.

---

## Usage

| Action | Result |
|---|---|
| Hover over the island | Expands with album art and controls |
| Move mouse away | Collapses back to pill |
| Click **⏸ / ▶** | Play or pause |
| Click **⏮** | Previous track |
| Click **⏭** | Next track |
| Click on the progress bar | Seek to that position |
| Drag along the progress bar | Scrub through the track |
| Right-click tray icon | Reconnect Spotify or Quit |

---

## Building a Standalone Executable

```powershell
npm run build
```

The installer is output to the `dist/` folder. Run the `.exe` to install the app — it will appear in your Start Menu and can be set to launch at startup from there.

> **Note:** The `assets/icon.ico` file is required for the build. If you skip this, remove the `"icon"` line from `package.json` under `build.win` before running the build command.

---

## How It Works

- **Transparent window** — Electron `BrowserWindow` with `transparent: true`, `frame: false`, and `alwaysOnTop: 'screen-saver'`
- **Click-through** — `setIgnoreMouseEvents(true, { forward: true })` by default; disabled only while the mouse is over the island element
- **Spotify OAuth** — PKCE Authorization Code flow; a temporary local HTTP server on port 8888 receives the callback from Spotify
- **Polling** — `GET /v1/me/player` every second; progress between polls is interpolated with `requestAnimationFrame`
- **Token refresh** — scheduled 60 seconds before expiry using the stored refresh token; no re-login needed

---

## Troubleshooting

**The island doesn't appear**
- Make sure `npm start` ran without errors
- Check that Electron downloaded correctly (`node_modules/.bin/electron` should exist)

**"No active device" shown**
- Open Spotify Desktop and play something — the Web API requires an active Spotify client

**Playback controls do nothing**
- Controlling playback requires a **Spotify Premium** account

**Authentication fails**
- Double-check that `http://localhost:8888/callback` is listed exactly in your Spotify App's Redirect URIs
- Make sure nothing else is using port 8888 when you authenticate

**Island is behind other windows**
- Some fullscreen exclusive apps (games) override the screen-saver always-on-top level; this is a Windows limitation

---

## License

MIT
