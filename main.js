const { app, BrowserWindow, ipcMain, shell, globalShortcut, clipboard } = require('electron');
const path  = require('path');
const fs    = require('fs');
const { exec } = require('child_process');
const os    = require('os');
const Anthropic = require('@anthropic-ai/sdk');

// ── SETTINGS ──
const settingsPath = path.join(app.getPath('userData'), 'excella-settings.json');

function loadSettings() {
  try { return JSON.parse(fs.readFileSync(settingsPath, 'utf8')); }
  catch { return {}; }
}
function saveSettings(data) {
  fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2));
}

// ── WINDOW ──
let win;
function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    frame: false,
    backgroundColor: '#020810',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });

  win.loadFile('excella.html');

  // Custom titlebar window controls forwarded from renderer
  ipcMain.on('win-min',   () => win.minimize());
  ipcMain.on('win-max',   () => win.isMaximized() ? win.unmaximize() : win.maximize());
  ipcMain.on('win-close', () => win.close());
}

app.whenReady().then(() => {
  // Auto-start when PC boots
  app.setLoginItemSettings({
    openAtLogin: true,
    name: 'EXCELLA',
  });
  createWindow();
  // Global hotkey: Ctrl+Shift+E focuses EXCELLA from anywhere on the desktop
  globalShortcut.register('CommandOrControl+Shift+E', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      win.webContents.send('excella-hotkey');
    }
  });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => globalShortcut.unregisterAll());

// ── IPC: SETTINGS ──
ipcMain.handle('load-settings', () => loadSettings());
ipcMain.handle('save-settings', (_, data) => { saveSettings(data); return true; });

// ── IPC: GROQ CHAT ──
ipcMain.handle('chat', async (_, { apiKey, messages, systemPrompt, model }) => {
  const body = JSON.stringify({
    model: model || 'llama3-70b-8192',
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages.map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }))
    ],
    max_tokens: 1024,
    temperature: 0.8,
  });

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body,
  });

  return res.json();
});

// ── IPC: CLAUDE CHAT ──
ipcMain.handle('claude-chat', async (_, { apiKey, messages, systemPrompt, model }) => {
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: model || 'claude-opus-4-5',
    max_tokens: 1024,
    system: systemPrompt,
    messages: messages.map(m => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content,
    })),
  });
  return {
    choices: [{
      message: {
        content: response.content[0]?.text ?? '',
        role: 'assistant',
      }
    }]
  };
});

// ── IPC: SYSTEM INFO ──
ipcMain.handle('get-system-info', () => ({
  platform: os.platform(),
  hostname: os.hostname(),
  totalMem: Math.round(os.totalmem() / 1024 / 1024 / 1024),
  freeMem:  Math.round(os.freemem()  / 1024 / 1024 / 1024),
  cpus: os.cpus().length,
  cpuModel: os.cpus()[0]?.model || 'Unknown',
  uptime: Math.floor(os.uptime() / 60),
  username: os.userInfo().username,
}));

// ── APP WHITELIST ──
// Maps voice command names → shell commands (no arbitrary input)
const APP_COMMANDS = {
  'chrome':         'start chrome',
  'google chrome':  'start chrome',
  'edge':           'start msedge',
  'microsoft edge': 'start msedge',
  'firefox':        'start firefox',
  'notepad':        'notepad',
  'calculator':     'calc',
  'paint':          'mspaint',
  'explorer':       'explorer',
  'file explorer':  'explorer',
  'task manager':   'taskmgr',
  'spotify':        'start spotify:',
  'discord':        'start discord:',
  'vscode':         'code .',
  'vs code':        'code .',
  'word':           'start winword',
  'excel':          'start excel',
  'powerpoint':     'start powerpnt',
  'teams':          'start msteams:',
  'snipping tool':  'snippingtool',
  'cmd':            'start cmd',
  'powershell':     'start powershell',
};

// ── SYSTEM ACTIONS WHITELIST ──
const SYSTEM_ACTIONS = {
  'volume-up':    'powershell -NoProfile -Command "$wsh=New-Object -ComObject WScript.Shell;$wsh.SendKeys([char]175)"',
  'volume-down':  'powershell -NoProfile -Command "$wsh=New-Object -ComObject WScript.Shell;$wsh.SendKeys([char]174)"',
  'mute':         'powershell -NoProfile -Command "$wsh=New-Object -ComObject WScript.Shell;$wsh.SendKeys([char]173)"',
  'lock':         'rundll32.exe user32.dll,LockWorkStation',
  'screenshot':   'powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms;[System.Windows.Forms.SendKeys]::SendWait(\'%{PRTSC}\')"',
  'sleep':        'rundll32.exe powrprof.dll,SetSuspendState 0,1,0',
  'shutdown':     'shutdown /s /t 30',
  'restart':      'shutdown /r /t 30',
  'cancel-shutdown': 'shutdown /a',
};

ipcMain.handle('run-app', (_, appName) => {
  const cmd = APP_COMMANDS[appName.toLowerCase()];
  if (!cmd) return { ok: false, error: 'Unknown app' };
  exec(cmd, { shell: true });
  return { ok: true };
});

ipcMain.handle('system-control', (_, action) => {
  const cmd = SYSTEM_ACTIONS[action];
  if (!cmd) return { ok: false, error: 'Unknown action' };
  exec(cmd, { shell: true });
  return { ok: true };
});

// ── IPC: CLIPBOARD ──
ipcMain.handle('get-clipboard', () => clipboard.readText());

// ── IPC: REAL CPU USAGE ──
let _cpuLast = null;
function getCPUPercent() {
  const cpus = os.cpus();
  const cur = { idle: 0, total: 0 };
  cpus.forEach(cpu => { for (const t in cpu.times) cur.total += cpu.times[t]; cur.idle += cpu.times.idle; });
  if (!_cpuLast) { _cpuLast = cur; return 0; }
  const idleDiff  = cur.idle  - _cpuLast.idle;
  const totalDiff = cur.total - _cpuLast.total;
  _cpuLast = cur;
  return Math.max(0, Math.round(100 * (1 - idleDiff / (totalDiff || 1))));
}
ipcMain.handle('get-cpu', () => getCPUPercent());

// ── IPC: STREAMING CHAT (Groq SSE) ──
ipcMain.on('chat-stream', async (event, { apiKey, messages, systemPrompt, model }) => {
  try {
    const body = JSON.stringify({
      model: model || 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }))
      ],
      max_tokens: 1024,
      temperature: 0.9,
      stream: true,
    });
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body,
    });
    if (!res.ok) {
      const err = await res.text();
      if (!event.sender.isDestroyed()) event.sender.send('chat-chunk', { error: err });
      return;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (raw === '[DONE]') {
          if (!event.sender.isDestroyed()) event.sender.send('chat-chunk', { done: true });
          return;
        }
        try {
          const token = JSON.parse(raw).choices?.[0]?.delta?.content;
          if (token && !event.sender.isDestroyed()) event.sender.send('chat-chunk', { token });
        } catch {}
      }
    }
    if (!event.sender.isDestroyed()) event.sender.send('chat-chunk', { done: true });
  } catch (e) {
    if (!event.sender.isDestroyed()) event.sender.send('chat-chunk', { error: e.message });
  }
});
