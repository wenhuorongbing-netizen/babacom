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
  private microphoneOperation = 0;
  private captureOperation: number | null = null;
  private captureTimer: NodeJS.Timeout | null = null;
  private consent = false;
  constructor(
    private readonly send: (command: MediaRuntimeCommand, credentials?: AdmissionSuccess) => void,
    private readonly publish: (snapshot: MediaSnapshot) => void,
  ) {}
  get snapshot(): MediaSnapshot { return structuredClone(this.state); }
  get active(): boolean { return ['connecting', 'connected', 'leaving', 'cleanup-failed'].includes(this.state.status); }
  private update(value: MediaSnapshot) { this.state = value; this.publish(this.snapshot); }
  private clearTimer() { if (this.timer) clearTimeout(this.timer); this.timer = null; }
  private clearCaptureTimer() { if (this.captureTimer) clearTimeout(this.captureTimer); this.captureTimer = null; }
  captureAllowed(sessionId: string): boolean {
    return sessionId === this.state.sessionId && this.state.status === 'connected' && this.consent
      && this.state.microphone === 'requesting' && this.captureOperation === this.microphoneOperation;
  }
  async setMicrophoneEnabled(sessionId: string, enabled: boolean, ask: () => Promise<boolean>): Promise<MediaSnapshot> {
    if (sessionId !== this.state.sessionId || this.state.status !== 'connected') return this.snapshot;
    if (enabled && (this.state.microphone === 'on' || this.state.microphone === 'requesting' || this.captureOperation !== null)) return this.snapshot;
    const operation = ++this.microphoneOperation;
    this.clearCaptureTimer();
    if (!enabled) {
      this.update({ ...this.state, microphone: this.state.microphone === 'on' || this.state.microphone === 'muted' ? 'muted' : 'off', audioCode: undefined });
      this.send({ type: 'microphone', sessionId, operation, enabled: false });
      return this.snapshot;
    }
    this.captureOperation = operation;
    this.update({ ...this.state, microphone: 'requesting', audioCode: undefined });
    const current = () => this.state.sessionId === sessionId && this.state.status === 'connected' && this.microphoneOperation === operation;
    this.captureTimer = setTimeout(() => {
      if (!current()) return;
      this.microphoneOperation++;
      this.clearCaptureTimer();
      this.update({ ...this.state, microphone: 'off', audioCode: 'MICROPHONE_TIMEOUT' });
      this.send({ type: 'microphone', sessionId, operation: this.microphoneOperation, enabled: false });
    }, 30_000);
    try {
      const approved = this.consent || await ask();
      if (!current()) {
        if (this.captureOperation === operation) this.captureOperation = null;
        return this.snapshot;
      }
      if (!approved) {
        this.captureOperation = null;
        this.clearCaptureTimer();
        this.update({ ...this.state, microphone: 'off', audioCode: 'MICROPHONE_DENIED' });
        return this.snapshot;
      }
      this.consent = true;
      this.send({ type: 'microphone', sessionId, operation, enabled: true });
    } catch {
      if (this.captureOperation === operation) this.captureOperation = null;
      if (current()) {
        this.clearCaptureTimer();
        this.update({ ...this.state, microphone: 'off', audioCode: 'MICROPHONE_FAILED' });
      }
    }
    return this.snapshot;
  }
  enableAudio(sessionId: string): MediaSnapshot {
    if (sessionId === this.state.sessionId && this.state.status === 'connected') this.send({ type: 'enableAudio', sessionId });
    return this.snapshot;
  }
  reject(code: Failure): MediaSnapshot {
    if (this.active) return this.snapshot;
    this.update({ ...empty(), status: 'failed', code });
    return this.snapshot;
  }
  join(credentials: AdmissionSuccess): MediaSnapshot {
    if (this.active) return this.snapshot;
    const sessionId = randomUUID();
    this.terminal = undefined;
    this.consent = false;
    this.captureOperation = null;
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
    this.clearCaptureTimer();
    this.microphoneOperation++;
    this.consent = false;
    this.terminal = failure;
    this.update({ ...this.state, status: 'leaving', microphone: 'off', playback: 'off' });
    this.timer = setTimeout(() => {
      this.update({ ...this.state, status: 'cleanup-failed', code: 'CLEANUP_FAILED' });
    }, 5_000);
    this.send({ type: 'stop', sessionId });
    return this.snapshot;
  }
  receive(event: MediaRuntimeEvent) {
    if (event.sessionId !== this.state.sessionId || this.state.status === 'cleanup-failed') return;
    if (event.type === 'captureEnded') {
      if (event.operation === this.captureOperation) this.captureOperation = null;
      return;
    }
    if (event.type === 'connected' && this.state.status === 'connecting') {
      this.clearTimer();
      this.update({ ...this.state, status: 'connected', members: event.members });
    } else if (event.type === 'members' && this.state.status === 'connected') {
      this.update({ ...this.state, members: event.members });
    } else if (event.type === 'receiving' && this.state.status === 'connected') {
      this.update({ ...this.state, audioReceiving: event.value });
    } else if (event.type === 'microphone' && this.state.status === 'connected' && event.operation === this.microphoneOperation) {
      if (event.value === 'on' && !this.captureAllowed(event.sessionId)) return;
      this.clearCaptureTimer();
      this.update({ ...this.state, microphone: event.value, audioCode: event.code });
    } else if (event.type === 'playback' && this.state.status === 'connected') {
      this.update({ ...this.state, playback: event.value, audioCode: event.value === 'blocked' ? 'PLAYBACK_BLOCKED' : undefined });
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
    this.clearCaptureTimer();
    this.microphoneOperation++;
    this.consent = false;
    if (this.state.sessionId) this.send({ type: 'stop', sessionId: this.state.sessionId });
  }
}
