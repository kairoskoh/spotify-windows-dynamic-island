'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('spotify', {
  // Playback & auth events (main → renderer)
  onPlayback:    (cb) => ipcRenderer.on('playback',     (_, d)   => cb(d)),
  onAuthSuccess: (cb) => ipcRenderer.on('auth-success', ()       => cb()),
  onAuthRequired:(cb) => ipcRenderer.on('auth-required',()       => cb()),
  onAuthError:   (cb) => ipcRenderer.on('auth-error',   (_, msg) => cb(msg)),
  onShowSetup:   (cb) => ipcRenderer.on('show-setup',   ()       => cb()),

  // Queries (renderer → main, returns Promise)
  getClientId:      () => ipcRenderer.invoke('get-client-id'),
  isAuthenticated:  () => ipcRenderer.invoke('is-authenticated'),

  // Commands (renderer → main, fire-and-forget)
  saveClientId: (id)         => ipcRenderer.send('save-client-id', id),
  startAuth:    ()           => ipcRenderer.send('start-auth'),
  command:      (action, d)  => ipcRenderer.send('spotify-command', action, d),

  // Window mouse-event passthrough control
  setIgnoreMouse: (ignore, opts) => ipcRenderer.send('set-ignore-mouse', ignore, opts),

  // App-level actions
  quitApp:     ()    => ipcRenderer.send('quit-app'),
  openGuide:   ()    => ipcRenderer.send('open-guide'),
  setPosition: (pos) => ipcRenderer.send('set-position', pos),
  getPosition: ()    => ipcRenderer.invoke('get-position')
});
