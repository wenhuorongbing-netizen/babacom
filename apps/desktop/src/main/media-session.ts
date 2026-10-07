import { randomUUID } from 'node:crypto';
import type { AdmissionSuccess, MediaRuntimeCommand, MediaRuntimeEvent, MediaSnapshot } from '@babacom/contracts';

const empty = (): MediaSnapshot => ({
  status: 'idle', sessionId: null, microphone: 'off', playback: 'off', members: [], audioReceiving: false,
});
type Failure = NonNullable<MediaSnapshot['code']>;

export class MediaSession {
  private state = empty();
  private timer: NodeJS.Timeout | null = null;
  private terminal: Failure | undefined;
  constructor(
    private readonly send: (command: MediaRuntimeCommand, credentials?: AdmissionSuccess) => void,
    private readonly publish: (snapshot: MediaSnapshot) => void,
  ) {}
  get snapshot(): MediaSnapshot { return structuredClone(this.state); }
  get active(): boolean { return ['connecting', 'connected', 'leaving', 'cleanup-failed'].includes(this.state.status); }
  private update(value: MediaSnapshot) { this.state = value; this.publish(this.snapshot); }
  private clearTimer() { if (this.timer) clearTimeout(this.timer); this.timer = null; }
  reject(code: Failure): MediaSnapshot {
    if (this.active) return this.snapshot;
    this.update({ ...empty(), status: 'failed', code });
    return this.snapshot;
  }
  join(credentials: AdmissionSuccess): MediaSnapshot {
    if (this.active) return this.snapshot;
    const sessionId = randomUUID();
    this.terminal = undefined;
    this.update({ ...empty(), status: 'connecting', sessionId });
    this.timer = setTimeout(() => this.stop(sessionId, 'CONNECT_TIMEOUT'), 30_000);
    this.send({ type: 'start', sessionId, livekitUrl: credentials.livekitUrl,
      roomName: credentials.roomName,
      participantIdentity: credentials.participantIdentity }, credentials);
    return this.snapshot;
  }
  stop(sessionId: string, failure?: Failure): MediaSnapshot {
    if (sessionId !== this.state.sessionId || !this.active
      || this.state.status === 'leaving' || this.state.status === 'cleanup-failed') return this.snapshot;
    this.clearTimer();
    this.terminal = failure;
    this.update({ ...this.state, status: 'leaving' });
    this.timer = setTimeout(() => {
      this.update({ ...this.state, status: 'cleanup-failed', code: 'CLEANUP_FAILED' });
    }, 5_000);
    this.send({ type: 'stop', sessionId });
    return this.snapshot;
  }
  receive(event: MediaRuntimeEvent) {
    if (event.sessionId !== this.state.sessionId || this.state.status === 'cleanup-failed') return;
    if (event.type === 'connected' && this.state.status === 'connecting') {
      this.clearTimer();
      this.update({ ...this.state, status: 'connected', members: event.members });
    } else if (event.type === 'members' && this.state.status === 'connected') {
      this.update({ ...this.state, members: event.members });
    } else if (event.type === 'receiving' && this.state.status === 'connected') {
      this.update({ ...this.state, audioReceiving: event.value });
    } else if (event.type === 'failed' && ['connecting', 'connected'].includes(this.state.status)) {
      this.stop(event.sessionId, 'CONNECT_FAILED');
    }
  }
  destroyed(sessionId: string) {
    if (sessionId !== this.state.sessionId || this.state.status !== 'leaving') return;
    this.clearTimer();
    this.update(this.terminal ? { ...empty(), status: 'failed', code: this.terminal } : empty());
  }
  close() {
    this.clearTimer();
    if (this.state.sessionId) this.send({ type: 'stop', sessionId: this.state.sessionId });
  }
}