const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('excella', {
  // Settings
  loadSettings:  ()     => ipcRenderer.invoke('load-settings'),
  saveSettings:  (data) => ipcRenderer.invoke('save-settings', data),

  // AI chat via main process (bypasses CORS)
  chat: (payload) => ipcRenderer.invoke('chat', payload),

  // PC integration
  runApp:        (appName) => ipcRenderer.invoke('run-app', appName),
  systemControl: (action)  => ipcRenderer.invoke('system-control', action),
  getSystemInfo: ()         => ipcRenderer.invoke('get-system-info'),

  // Window controls
  winMin:   () => ipcRenderer.send('win-min'),
  winMax:   () => ipcRenderer.send('win-max'),
  winClose: () => ipcRenderer.send('win-close'),

  // Streaming AI (Groq SSE via main process)
  chatStream:   (payload) => ipcRenderer.send('chat-stream', payload),
  onChatChunk:  (cb)      => ipcRenderer.on('chat-chunk', (_, data) => cb(data)),
  offChatChunk: ()        => ipcRenderer.removeAllListeners('chat-chunk'),

  // Utilities
  getClipboard: ()   => ipcRenderer.invoke('get-clipboard'),
  getCPU:       ()   => ipcRenderer.invoke('get-cpu'),
  onHotkey:     (cb) => ipcRenderer.on('excella-hotkey', () => cb()),
});
