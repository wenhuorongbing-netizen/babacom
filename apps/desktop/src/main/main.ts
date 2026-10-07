import { app, BrowserWindow, ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';
import Ajv from 'ajv';
import { admissionSchema, tokenClaimsSchema, mediaSessionSchema } from '@babacom/contracts';
import { MediaSession } from './media-session';
import type {
  AdmissionError, AdmissionRequest, AdmissionSuccess, MediaClaims,
  RendererResult, StartupConfiguration, MediaStartup, MediaCommand, MediaRuntimeEvent, MediaRuntimeCommand,
} from '@babacom/contracts';

const ajv = new Ajv({ strict: true });
ajv.addKeyword('x-nickname');
ajv.addKeyword('x-ttlSeconds');
const validator = <T>(definition: string) => ajv.compile<T>({ ...admissionSchema, $ref: '#/$defs/' + definition });
const validStartup = validator<StartupConfiguration>('startup');
const validRequest = validator<AdmissionRequest>('request');
const validSuccess = validator<AdmissionSuccess>('success');
const validError = validator<AdmissionError>('error');
const validClaims = ajv.compile<MediaClaims>(tokenClaimsSchema);

const mediaValidator = <T>(definition: string) => ajv.compile<T>({ ...mediaSessionSchema, $ref: '#/$defs/' + definition });
const validMediaStartup = mediaValidator<MediaStartup>('mediaStartup');
const validMediaCommand = mediaValidator<MediaCommand>('command');
const validRuntimeEvent = mediaValidator<MediaRuntimeEvent>('runtimeEvent');
let mediaConfiguration: MediaStartup | null = null;
let media: MediaSession | null = null;
let configuration: StartupConfiguration | null = null;
let window: BrowserWindow | null = null;
let approvedPage = '';
let pending: AbortController | null = null;
let generation = 0;
// Only the main process retains this response; the renderer gets four public fields.
let credentials: AdmissionSuccess | null = null;
let expiry: NodeJS.Timeout | null = null;

type MediaContext = {
  window: BrowserWindow; id: string; authorization: string | null; valid: boolean; ready: boolean;
  destroyTimer: NodeJS.Timeout | null;
};
let mediaContext: MediaContext | null = null;
const mediaPage = () => pathToFileURL(join(__dirname, '../media/media.html')).href;

function destroyMediaContext(context: MediaContext) {
  context.authorization = null;
  context.valid = false;
  if (!context.window.isDestroyed()) context.window.destroy();
}

function runMedia(command: MediaRuntimeCommand, startup?: AdmissionSuccess) {
  if (command.type === 'stop') {
    const context = mediaContext;
    if (!context || context.id !== command.sessionId) return;
    context.authorization = null;
    context.valid = false;
    context.destroyTimer = setTimeout(() => destroyMediaContext(context), 4_500);
    if (context.ready && !context.window.webContents.isDestroyed()) {
      context.window.webContents.send('media:run', command);
    } else destroyMediaContext(context);
    return;
  }
  if (!startup || mediaContext) {
    media?.receive({ type: 'failed', sessionId: command.sessionId });
    return;
  }
  const page = mediaPage();
  const target = new URL(startup.livekitUrl);
  const mediaWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: join(__dirname, 'media-preload.cjs'), partition: 'media-' + randomUUID(),
      contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, webviewTag: false,
    },
  });
  const context: MediaContext = { window: mediaWindow, id: command.sessionId,
    authorization: startup.accessToken, valid: true, ready: false, destroyTimer: null };
  mediaContext = context;
  const contents = mediaWindow.webContents;
  const redirects = new Set<number>();
  const current = () => mediaContext === context && context.valid && !contents.isDestroyed()
    && media?.snapshot.sessionId === context.id;
  const signalRequest = (details: Electron.OnBeforeRequestListenerDetails | Electron.OnBeforeSendHeadersListenerDetails) => {
    const url = new URL(details.url);
    return current() && contents.mainFrame.frames.length === 0 && details.webContentsId === contents.id
      && details.frame === contents.mainFrame && details.frame.url === page && contents.getURL() === page
      && details.method === 'GET' && !redirects.has(details.id)
      && url.hostname === target.hostname && url.port === target.port && !url.username && !url.password && !url.hash
      && ['ws:', 'http:'].includes(url.protocol)
      && ['/rtc', '/rtc/v1', '/rtc/validate', '/rtc/v1/validate'].includes(url.pathname);
  };
  contents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  contents.session.setPermissionCheckHandler(() => false);
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event) => event.preventDefault());
  contents.on('will-frame-navigate', (event) => event.preventDefault());
  contents.on('will-attach-webview', (event) => event.preventDefault());
  // Chromium can attribute about:blank child requests to their parent. The
  // static media domain therefore loses authorization as soon as a child exists.
  contents.on('frame-created', (_event, { frame }) => {
    if (frame && !frame.parent) return;
    context.authorization = null;
    media?.stop(context.id, 'CONNECT_FAILED');
  });
  contents.session.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !(current() && details.url === page && details.method === 'GET'
      && details.resourceType === 'mainFrame' && !redirects.has(details.id) || signalRequest(details)) });
  });
  contents.session.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders };
    for (const key of Object.keys(headers)) if (key.toLowerCase() === 'authorization') delete headers[key];
    if (signalRequest(details) && context.authorization) headers.Authorization = 'Bearer ' + context.authorization;
    callback({ requestHeaders: headers });
  });
  contents.session.webRequest.onBeforeRedirect((details) => {
    redirects.add(details.id);
    context.authorization = null;
    if (current()) media?.stop(context.id, 'CONNECT_FAILED');
  });
  contents.once('destroyed', () => {
    if (context.destroyTimer) clearTimeout(context.destroyTimer);
    context.destroyTimer = null;
    context.authorization = null;
    context.valid = false;
    if (mediaContext !== context) return;
    mediaContext = null;
    if (media?.snapshot.status !== 'leaving') media?.stop(context.id, 'CONNECT_FAILED');
    media?.destroyed(context.id);
  });
  contents.on('render-process-gone', () => {
    context.authorization = null;
    media?.stop(context.id, 'CONNECT_FAILED');
    destroyMediaContext(context);
  });
  void mediaWindow.loadURL(page).then(() => {
    if (!current()) { destroyMediaContext(context); return; }
    context.ready = true;
    contents.send('media:run', command);
  }).catch(() => {
    media?.stop(context.id, 'CONNECT_FAILED');
    destroyMediaContext(context);
  });
}

function clearCredentials() {
  credentials = null;
  if (expiry) clearTimeout(expiry);
  expiry = null;
}

function cancel() {
  generation++;
  pending?.abort();
  pending = null;
  clearCredentials();
}

function trustedSender(event: IpcMainInvokeEvent): boolean {
  return Boolean(window && event.sender === window.webContents
    && event.senderFrame === window.webContents.mainFrame
    && event.senderFrame?.url === approvedPage
    && window.webContents.getURL() === approvedPage);
}

function readPipe<T>(name: string, validate: (value: unknown) => value is T): Promise<T> {
  return new Promise((resolve, reject) => {
    const prefix = '\\\\.\\pipe\\babacom-';
    const flag = '--babacom-' + name + '-pipe=';
    const argument = process.argv.find((arg) => arg.startsWith(flag));
    const path = argument?.slice(flag.length);
    if (!path?.startsWith(prefix) || !/^[a-f0-9-]{36}$/.test(path.slice(prefix.length))) {
      reject(new Error('Missing controlled startup configuration'));
      return;
    }
    const socket = createConnection(path);
    let finished = false;
    let text = '';
    const timeout = setTimeout(() => finish(), 15_000);
    const finish = (value?: T) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      socket.destroy();
      text = '';
      if (value) resolve(value);
      else reject(new Error('Missing controlled startup configuration'));
    };
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      text += chunk;
      if (Buffer.byteLength(text) > 4096) { finish(); return; }
      const end = text.indexOf('\n');
      if (end < 0) return;
      try {
        const value: unknown = JSON.parse(text.slice(0, end));
        if (!validate(value)) { finish(); return; }
        finish(value);
      } catch { finish(); }
    });
    socket.on('end', () => finish());
    socket.on('error', () => finish());
  });
}

function readStartup(): Promise<StartupConfiguration> {
  return readPipe('startup', (value): value is StartupConfiguration => {
    if (!validStartup(value)) return false;
    const address = new URL(value.apiBase);
    return address.hostname === '127.0.0.1' && Boolean(address.port) && address.port !== '0';
  });
}

function approvedSfu(value: unknown): value is MediaStartup {
  if (!validMediaStartup(value)) return false;
  try {
    const url = new URL(value.sfuBase);
    return url.protocol === 'ws:' && url.hostname === '127.0.0.1' && Boolean(url.port) && url.port !== '0'
      && url.pathname === '/' && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}

async function mediaCommand(event: IpcMainInvokeEvent, value: unknown) {
  if (!media) throw new Error('Media unavailable');
  if (!trustedSender(event)) return {
    status: 'failed', sessionId: null, microphone: 'off', playback: 'off',
    members: [], audioReceiving: false, code: 'FORBIDDEN',
  };
  if (!validMediaCommand(value)) return media.reject('INVALID_COMMAND');
  if (value.type === 'snapshot') return media.snapshot;
  if (value.type === 'leave' || value.type === 'cancelJoin') return media.stop(value.sessionId);
  if (media.active) return media.snapshot;
  if (!mediaConfiguration) return media.reject('NOT_CONFIGURED');
  if (!credentials || pending) return media.reject('NOT_PREPARED');
  const handed = credentials;
  clearCredentials();
  if (Date.parse(handed.expiresAt) <= Date.now()) return media.reject('EXPIRED');
  if (handed.livekitUrl !== mediaConfiguration.sfuBase) return media.reject('UNAPPROVED_SFU');
  return media.join(handed);
}

async function responseJson(response: Response): Promise<unknown> {
  if (!response.body || response.headers.get('content-type')?.split(';')[0] !== 'application/json') throw new Error('Invalid response');
  const reader = response.body.getReader();
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 16_384) throw new Error('Response is too large');
      chunks.push(value);
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } finally { reader.releaseLock(); }
}

function validTokenResponse(value: AdmissionSuccess): boolean {
  try {
    const parts = value.accessToken.split('.');
    if (parts.length !== 3) return false;
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const claims: unknown = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (header.alg !== 'HS256' || header.typ !== 'JWT' || !validClaims(claims)) return false;
    return claims.sub === value.participantIdentity && claims.name === value.displayName
      && claims.video.room === value.roomName
      && claims.exp - claims.nbf === tokenClaimsSchema['x-ttlSeconds']
      && Date.parse(value.expiresAt) === claims.exp * 1000
      && claims.nbf <= Math.floor(Date.now() / 1000) + 1;
  } catch { return false; }
}

async function prepare(event: IpcMainInvokeEvent, value: unknown): Promise<RendererResult> {
  if (!trustedSender(event)) return { status: 'failure', code: 'FORBIDDEN' };
  if (!validRequest(value) || !configuration || value.roomName !== configuration.roomName) {
    return { status: 'failure', code: 'INVALID_REQUEST' };
  }
  if (pending || media?.active) return { status: 'failure', code: 'REQUEST_FAILED' };
  clearCredentials();
  const current = ++generation;
  const controller = new AbortController();
  pending = controller;
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 10_000);
  try {
    const response = await fetch(configuration.apiBase + '/api/v1/tokens/media', {
      method: 'POST', redirect: 'error', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + configuration.applicationSession },
      body: JSON.stringify(value),
    });
    const body = await responseJson(response);
    if (current !== generation) return { status: 'cancelled' };
    if (!response.ok) {
      if (!validError(body)) return { status: 'failure', code: 'REQUEST_FAILED' };
      return { status: 'failure', code: body.code,
        ...(response.status === 429 && body.retryAfterSeconds ? { retryAfterSeconds: body.retryAfterSeconds } : {}) };
    }
    if (response.status !== 200 || !validSuccess(body) || body.roomName !== configuration.roomName || !validTokenResponse(body)) {
      return { status: 'failure', code: 'REQUEST_FAILED' };
    }
    if (Date.parse(body.expiresAt) <= Date.now()) return { status: 'failure', code: 'EXPIRED' };
    credentials = body;
    expiry = setTimeout(clearCredentials, Date.parse(body.expiresAt) - Date.now());
    const { roomName, participantIdentity, displayName, expiresAt } = credentials;
    return { status: 'ready', summary: { roomName, participantIdentity, displayName, expiresAt } };
  } catch {
    if (current !== generation) return { status: 'cancelled' };
    return { status: 'failure', code: timedOut ? 'TIMEOUT' : 'REQUEST_FAILED' };
  } finally {
    clearTimeout(timeout);
    if (current === generation) pending = null;
  }
}

async function main() {
  const startup = readStartup();
  const mediaStartup = process.argv.some((arg) => arg.startsWith('--babacom-media-pipe='))
    ? readPipe('media', approvedSfu).catch(() => null) : Promise.resolve(null);
  await app.whenReady();
  configuration = await startup;
  mediaConfiguration = await mediaStartup;
  const devUrl = process.env.BABACOM_RENDERER_URL;
  delete process.env.BABACOM_RENDERER_URL;
  if (devUrl) {
    const parsed = new URL(devUrl);
    if (app.isPackaged || parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1'
      || !parsed.port || parsed.pathname !== '/' || parsed.search || parsed.hash
      || parsed.username || parsed.password) throw new Error('Invalid renderer location');
    approvedPage = parsed.href;
  } else {
    approvedPage = pathToFileURL(join(__dirname, '../renderer/index.html')).href;
  }
  window = new BrowserWindow({
    width: 760, height: 740, title: 'BabaCom', show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true, sandbox: true, nodeIntegration: false,
      webSecurity: true, webviewTag: false, partition: 't1-' + randomUUID(),
      additionalArguments: ['--babacom-room=' + configuration.roomName,
        '--babacom-environment=' + configuration.environment],
    },
  });
  const contents = window.webContents;
  media = new MediaSession(
    runMedia,
    (snapshot) => { if (!contents.isDestroyed()) contents.send('media:snapshot', snapshot); },
  );
  contents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  contents.session.setPermissionCheckHandler(() => false);
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event) => event.preventDefault());
  contents.on('will-frame-navigate', (event) => event.preventDefault());
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.session.webRequest.onBeforeRequest((details, callback) => {
    const url = new URL(details.url);
    const page = new URL(approvedPage);
    const allowed = devUrl ? url.origin === page.origin
      : url.protocol === 'file:' && url.pathname.startsWith(page.pathname.slice(0, page.pathname.lastIndexOf('/') + 1));
    callback({ cancel: !allowed });
  });
  ipcMain.handle('media:command', mediaCommand);
  ipcMain.on('media:runtime', (event, value: unknown) => {
    const context = mediaContext;
    if (!context || context.window.webContents.isDestroyed() || !validRuntimeEvent(value)
      || event.sender !== context.window.webContents || event.senderFrame !== context.window.webContents.mainFrame
      || event.senderFrame.url !== mediaPage() || context.window.webContents.getURL() !== mediaPage()
      || value.sessionId !== context.id) return;
    if (value.type === 'ended') { destroyMediaContext(context); return; }
    if (!context.valid) return;
    if (value.type === 'connected') context.authorization = null;
    media?.receive(value);
  });
  ipcMain.handle('admission:prepare', prepare);
  ipcMain.handle('admission:cancel', (event) => { if (trustedSender(event)) cancel(); });
  window.once('ready-to-show', () => window?.show());
  window.on('closed', () => {
    media?.close();
    if (mediaContext) destroyMediaContext(mediaContext);
    mediaConfiguration = null;
    cancel(); configuration = null; window = null; app.quit();
  });
  app.on('before-quit', () => {
    media?.close();
    if (mediaContext) destroyMediaContext(mediaContext);
    cancel(); configuration = null; mediaConfiguration = null;
  });
  await window.loadURL(approvedPage);
}

main().catch(() => {
  cancel(); configuration = null;
  console.error('Controlled desktop startup failed.');
  app.exit(1);
});
