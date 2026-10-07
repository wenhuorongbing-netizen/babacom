import { ipcRenderer } from 'electron';
import Ajv from 'ajv';
import { mediaSessionSchema } from '@babacom/contracts';
import type { MediaRuntimeCommand } from '@babacom/contracts';
import { createVoiceSession } from '../features/voice/session';
import { createAudioReceiver } from '../features/audio/playback';

const validate = new Ajv({ strict: true }).compile<MediaRuntimeCommand>({
  ...mediaSessionSchema, $ref: '#/$defs/runtimeCommand',
});
const audio = createAudioReceiver((value) => voice.receiving(value));
const voice = createVoiceSession(audio, (event) => ipcRenderer.send('media:runtime', event));
ipcRenderer.on('media:run', (_event, command: unknown) => {
  if (validate(command)) voice.run(command);
});
