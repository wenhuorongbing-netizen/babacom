import { contextBridge, ipcRenderer } from 'electron';
import type { AdmissionRequest, RendererResult, MediaSnapshot, MediaCommand } from '@babacom/contracts';

export interface MediaBridge {
  join(): Promise<MediaSnapshot>;
  cancelJoin(sessionId: string): Promise<MediaSnapshot>;
  leave(sessionId: string): Promise<MediaSnapshot>;
  getSnapshot(): Promise<MediaSnapshot>;
  subscribe(listener: (snapshot: MediaSnapshot) => void): () => void;
}

const invoke = (command: MediaCommand): Promise<MediaSnapshot> => ipcRenderer.invoke('media:command', command);
const mediaBridge: MediaBridge = Object.freeze({
  join: (...args: unknown[]) => args.length ? Promise.reject(new Error('INVALID_COMMAND')) : invoke({ type: 'join' }),
  cancelJoin: (sessionId: string) => invoke({ type: 'cancelJoin', sessionId }),
  leave: (sessionId: string) => invoke({ type: 'leave', sessionId }),
  getSnapshot: () => invoke({ type: 'snapshot' }),
  subscribe: (listener: (snapshot: MediaSnapshot) => void) => {
    if (typeof listener !== 'function') throw new Error('INVALID_COMMAND');
    const handler = (_event: unknown, value: MediaSnapshot) => listener(value);
    ipcRenderer.on('media:snapshot', handler);
    return () => ipcRenderer.removeListener('media:snapshot', handler);
  },
});
contextBridge.exposeInMainWorld('media', mediaBridge);

export interface AdmissionBridge {
  readonly roomName: string;
  readonly environment: string;
  prepare(request: AdmissionRequest): Promise<RendererResult>;
  cancel(): Promise<void>;
}

const argument = (name: string): string => {
  const value = process.argv.find((arg) => arg.startsWith('--babacom-' + name + '='));
  if (!value) throw new Error('Missing controlled window configuration');
  return value.slice(value.indexOf('=') + 1);
};

const bridge: AdmissionBridge = Object.freeze({
  roomName: argument('room'),
  environment: argument('environment'),
  prepare: (request: AdmissionRequest) => ipcRenderer.invoke('admission:prepare', request),
  cancel: () => ipcRenderer.invoke('admission:cancel'),
});
contextBridge.exposeInMainWorld('admission', bridge);

declare global {
  interface Window { admission: AdmissionBridge; media: MediaBridge }
}
