import { app, BrowserWindow, ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';
import Ajv from 'ajv';
import { admissionSchema, tokenClaimsSchema } from '@babacom/contracts';
import type {
  AdmissionError, AdmissionRequest, AdmissionSuccess, MediaClaims,
  RendererResult, StartupConfiguration,
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

let configuration: StartupConfiguration | null = null;
let window: BrowserWindow | null = null;
let approvedPage = '';
let pending: AbortController | null = null;
let generation = 0;
// Only the main process retains this response; the renderer gets four public fields.
let credentials: AdmissionSuccess | null = null;
let expiry: NodeJS.Timeout | null = null;

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

function readStartup(): Promise<StartupConfiguration> {
  return new Promise((resolve, reject) => {
    const prefix = '\\\\.\\pipe\\babacom-';
    const argument = process.argv.find((arg) => arg.startsWith('--babacom-startup-pipe='));
    const path = argument?.slice('--babacom-startup-pipe='.length);
    if (!path?.startsWith(prefix) || !/^[a-f0-9-]{36}$/.test(path.slice(prefix.length))) {
      reject(new Error('Missing controlled startup configuration'));
      return;
    }
    const socket = createConnection(path);
    let finished = false;
    let text = '';
    const timeout = setTimeout(() => finish(), 15_000);
    const finish = (value?: StartupConfiguration) => {
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
        if (!validStartup(value)) { finish(); return; }
        const address = new URL(value.apiBase);
        if (address.hostname !== '127.0.0.1' || !address.port || address.port === '0') { finish(); return; }
        finish(value);
      } catch { finish(); }
    });
    socket.on('end', () => finish());
    socket.on('error', () => finish());
  });
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
      && claims.nbf <= Math.floor(Date.now() / 1000) + 1
      && claims.exp * 1000 > Date.now();
  } catch { return false; }
}

async function prepare(event: IpcMainInvokeEvent, value: unknown): Promise<RendererResult> {
  if (!trustedSender(event)) return { status: 'failure', code: 'FORBIDDEN' };
  if (!validRequest(value) || !configuration || value.roomName !== configuration.roomName) {
    return { status: 'failure', code: 'INVALID_REQUEST' };
  }
  if (pending) return { status: 'failure', code: 'REQUEST_FAILED' };
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
  await app.whenReady();
  configuration = await startup;
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
  ipcMain.handle('admission:prepare', prepare);
  ipcMain.handle('admission:cancel', (event) => { if (trustedSender(event)) cancel(); });
  window.once('ready-to-show', () => window?.show());
  window.on('closed', () => {
    cancel(); configuration = null; window = null; app.quit();
  });
  app.on('before-quit', () => { cancel(); configuration = null; });
  await window.loadURL(approvedPage);
}

main().catch(() => {
  cancel(); configuration = null;
  console.error('Controlled desktop startup failed.');
  app.exit(1);
});
