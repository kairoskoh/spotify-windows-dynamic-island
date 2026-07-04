# WinIsland: A Windows Dynamic Island for Spotify

A Windows 10/11 overlay that mimics the iPhone Dynamic Island — a sleek dark pill that sits at the top-center (or bottom-center) of your screen and shows Spotify playback controls whenever music is playing. Disclaimer: This is not an official application by Spotify. This application makes use of Spotify API.

---

## Preview

**Collapsed** — small pill with animated waveform and track title:

```
        ╭──────────────────────────────╮
        │  ▁▃▅▃▁  Blinding Lights     │
        ╰──────────────────────────────╯
```

**Expanded** (hover over the island):

```
  ╭──────────────────────────────────────────╮
  │                                  ⋯   ×  │  ← toolbar
  │  ┌──────┐   Blinding Lights              │
  │  │      │   The Weeknd                   │
  │  │  🎵  │   ━━━━━━━━━━━━╸━━━━━━  2:14    │
  │  │      │         ⏮  ⏸  ⏭              │
  │  └──────┘                                │
  ╰──────────────────────────────────────────╯
```

---

## Features

### Playback
- **Dynamic Island style** — spring-animated pill that expands on hover
- **Animated waveform** — 5-bar Spotify-green wave bounces while playing, freezes when paused
- **Album art** — rounded cover art pulled live from Spotify
- **Track & artist** — updates instantly on track change
- **Progress bar** — smooth interpolation between 1-second API polls; click or drag to seek
- **Transport controls** — previous, play/pause, next (centered under the progress bar)

### Interface
- **Toolbar** — ⋯ settings button and × quit button appear in the top-right of the expanded island
- **Settings dropdown** — hover over ⋯ to open; closes automatically when the mouse leaves
  - **Change Client ID** — replace your Spotify Client ID at any time
  - **Position toggle** — pill-shaped toggle switch to move the island between top and bottom of screen; preference is saved across sessions
- **Quit confirmation** — clicking × shows a compact "Quit Dynamic Island?" prompt with Quit / Cancel buttons
- **Back button** — arrow to return to the player from the Change Client ID page
- **"How to get a Client ID ↗"** — link inside the setup panel that opens the built-in guide

### Sound Effects
- **Welcome sound** — short sci-fi/space synth chime plays when the app launches
- **Quit sound** — descending synth sweep plays when the app closes

### Setup Guide
- **Built-in guide page** (`guide/index.html`) — dark-themed step-by-step walkthrough for creating a Spotify Developer App, complete with screenshots and a one-click copy button for the redirect URI

### Technical
- **Always on top** — floats above all windows at screen-saver level
- **Click-through** — transparent areas pass clicks straight through to whatever is beneath
- **System tray** — right-click the green dot to reconnect or quit
- **Token refresh** — access tokens renew automatically in the background; stays connected indefinitely
- **Client ID validation** — validates the 32-character hex format before connecting; shows an inline countdown error inside the input field on invalid input
- **Auth timeout** — Connect button resets after 30 seconds if the browser auth flow is not completed

---

## Requirements

- **Windows 10 or 11**
- **Node.js** (v18 or later) — [nodejs.org](https://nodejs.org)
- **A Spotify account** (free or Premium — playback control requires Premium)

---

## Project Structure

```
spotify-windows-dynamic-island/
├── main.js              ← Electron main process: window, tray, OAuth, API polling
├── preload.js           ← Secure IPC bridge between main and renderer
├── package.json
├── renderer/
│   ├── index.html       ← Island HTML (collapsed + expanded layers, toolbar, overlays)
│   ├── style.css        ← Spring animation, waveform keyframes, layout, toggle styles
│   └── app.js           ← Playback state, progress interpolation, controls, sounds
└── guide/
    ├── index.html       ← Built-in setup guide with screenshots and copy button
    └── images/          ← Guide screenshots (1.png, 2.png, 3.png)
```

---

## One-Time Spotify Setup

You need a free Spotify Developer App to get a Client ID. This takes about 2 minutes.
You can also open the built-in guide from the app by clicking **"How to get a Client ID ↗"** in the setup panel.

1. Go to **[developer.spotify.com/dashboard](https://developer.spotify.com/dashboard)** and log in. Make sure the URL ends with `/dashboard`.
2. Click **Create App**.
3. Give it any name, description and website (e.g. "Dynamic Island").
4. Under **Redirect URIs**, add exactly:
   ```
   http://127.0.0.1:8888/callback
   ```
   Then click **Add**.
5. Under **Which API/SDKs are you planning to use?**, select **Web API**.
6. Click **Save**.
7. On the app's page, copy your **Client ID**.

> The Client ID is not a secret — it is safe to share. No Client Secret is required.

---

## Installation

```powershell
npm install
```

---

## Running

```powershell
npm start
```

On first launch:

1. A small dark pill appears at the **top center** of your screen and plays a welcome chime
2. Hover over the pill to expand it, then click **Connect** — or right-click the green tray icon and choose **Setup → enter Client ID**
3. Enter your **Client ID** and click **Connect**
4. Your browser opens Spotify's login page — approve it
5. The tab closes automatically and the island starts showing your playback

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
| Hover over **⋯** | Opens settings dropdown |
| Click **Change Client ID** | Replace your Spotify Client ID |
| Toggle position switch | Move island between top and bottom of screen |
| Click **×** | Shows quit confirmation prompt |
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
- **Window positioning** — uses `screen.getPrimaryDisplay().workArea` to respect the taskbar when placing the island at top or bottom
- **Sound effects** — synthesised via the Web Audio API; no audio files required

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
- Double-check that `http://127.0.0.1:8888/callback` is listed exactly in your Spotify App's Redirect URIs
- Make sure nothing else is using port 8888 when you authenticate

**Connect button stuck at "Connecting…"**
- The button resets automatically after 30 seconds; try connecting again
- If the browser tab never opened, check that your Client ID is exactly 32 hex characters

**Island is behind other windows**
- Some fullscreen exclusive apps (games) override the screen-saver always-on-top level; this is a Windows limitation

---

## License

MIT
