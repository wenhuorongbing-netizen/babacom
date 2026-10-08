import { ipcRenderer } from 'electron';
import Ajv from 'ajv';
import { mediaSessionSchema } from '@babacom/contracts';
import type { MediaRuntimeCommand, MediaRuntimeEvent } from '@babacom/contracts';
import { createVoiceSession } from '../features/voice/session';
import { createAudioReceiver } from '../features/audio/playback';
import { captureMicrophone, createMicrophone } from '../features/audio/microphone';

const validate = new Ajv({ strict: true }).compile<MediaRuntimeCommand>({
  ...mediaSessionSchema, $ref: '#/$defs/runtimeCommand',
});
const audio = createAudioReceiver((value) => voice.receiving(value));
const emit = (event: MediaRuntimeEvent) => ipcRenderer.send('media:runtime', event);
const microphone = createMicrophone(emit, captureMicrophone);
const voice = createVoiceSession(audio, microphone, emit);
Reflect.set(globalThis, 'babacomEnableAudio', (command: unknown) => {
  if (validate(command) && command.type === 'enableAudio') voice.run(command);
});
ipcRenderer.on('media:run', (_event, command: unknown) => {
  if (validate(command)) voice.run(command);
});
