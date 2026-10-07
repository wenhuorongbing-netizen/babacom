async function main() {
const { app, BrowserWindow, ipcMain } = await import('electron');
const { join } = await import('node:path');
const { pathToFileURL } = await import('node:url');
const { createConnection } = await import('node:net');

function configuration() {
  const flag = '--peer-pipe=';
  const path = process.argv.find((argument) => argument.startsWith(flag))?.slice(flag.length);
  if (!path) return Promise.resolve(null);
  if (!/^\\\\\.\\pipe\\babacom-[a-f0-9-]{36}$/.test(path)) return Promise.reject(new Error('Invalid peer pipe'));
  return new Promise((resolve, reject) => {
    const socket = createConnection(path);
    let text = '';
    let finished = false;
    const timeout = setTimeout(() => finish(), 15_000);
    function finish(value) {
      if (finished) return;
      finished = true; clearTimeout(timeout); socket.destroy(); text = '';
      if (value) resolve(value);
      else reject(new Error('Invalid peer configuration'));
    }
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      text += chunk;
      if (Buffer.byteLength(text) > 4096) { finish(); return; }
      const end = text.indexOf('\n');
      if (end < 0) return;
      try {
        const value = JSON.parse(text.slice(0, end));
        const url = new URL(value.livekitUrl);
        if (url.protocol !== 'ws:' || url.hostname !== '127.0.0.1' || !url.port
          || url.pathname !== '/' || url.username || url.password || url.search || url.hash
          || typeof value.accessToken !== 'string') { finish(); return; }
        finish(value);
      } catch { finish(); }
    });
    socket.on('error', () => finish());
    socket.on('end', () => finish());
  });
}

const headerAuth = process.argv.includes('--peer-header-auth');
const startup = configuration();
await app.whenReady().then(async () => {
  let credentials = await startup;
  const page = pathToFileURL(join(__dirname, 'peer.html')).href;
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: join(__dirname, '../../apps/desktop/build/sfu-peer.cjs'),
      contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true,
    },
  });
  const contents = window.webContents;
  contents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  contents.session.setPermissionCheckHandler(() => false);
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event) => event.preventDefault());
  contents.session.webRequest.onBeforeRequest((details, callback) => {
    const url = new URL(details.url);
    const target = credentials ? new URL(credentials.livekitUrl) : null;
    const signal = target && url.hostname === target.hostname && url.port === target.port
      && ['ws:', 'http:'].includes(url.protocol)
      && ['/rtc', '/rtc/v1', '/rtc/validate', '/rtc/v1/validate'].includes(url.pathname);
    callback({ cancel: !(details.url === page || signal) });
  });
  // A test-only candidate: native header authentication, with no JWT in the SDK URL.
  if (headerAuth) contents.session.webRequest.onBeforeSendHeaders((details, callback) => {
    const url = new URL(details.url);
    const target = credentials ? new URL(credentials.livekitUrl) : null;
    const signal = target && details.webContentsId === contents.id && details.method === 'GET'
      && url.hostname === target.hostname && url.port === target.port && ['ws:', 'http:'].includes(url.protocol)
      && ['/rtc', '/rtc/v1', '/rtc/validate', '/rtc/v1/validate'].includes(url.pathname);
    if (!signal) { callback({ requestHeaders: details.requestHeaders }); return; }
    callback({ requestHeaders: { ...details.requestHeaders, Authorization: 'Bearer ' + credentials.accessToken } });
  });
  ipcMain.handle('peer:configuration', (event) => {
    if (event.sender !== contents || event.senderFrame !== contents.mainFrame || event.senderFrame.url !== page) return null;
    return headerAuth && credentials ? { ...credentials, accessToken: 'babacom-no-url-credential' } : credentials;
  });
  window.on('closed', () => { credentials = null; app.quit(); });
  await window.loadURL(page);
}).catch(() => { console.error('Synthetic peer failed'); app.exit(1); });
}
main().catch(() => { console.error('Synthetic peer failed'); process.exit(1); });