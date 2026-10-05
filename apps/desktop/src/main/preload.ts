import { contextBridge, ipcRenderer } from 'electron';
import type { AdmissionRequest, RendererResult } from '@babacom/contracts';

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
  interface Window { admission: AdmissionBridge }
}
