import { expect, test } from '@playwright/test';
import Ajv from 'ajv';
import { mediaSessionSchema } from '@babacom/contracts';
import type { AdmissionSuccess, MediaRuntimeCommand } from '@babacom/contracts';
import { MediaSession } from '../../apps/desktop/src/main/media-session';
import { createMicrophone } from '../../apps/desktop/src/features/audio/microphone';

const sessionId = '00000000-0000-4000-8000-000000000001';
const credentials: AdmissionSuccess = {
  accessToken: 'unused-in-main-state-tests', livekitUrl: 'ws://127.0.0.1:7880', roomName: 'room-a',
  participantIdentity: 'member-a', displayName: 'Member A', expiresAt: '2099-01-01T00:00:00Z',
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function connected() {
  const sent: MediaRuntimeCommand[] = [];
  const session = new MediaSession((command) => sent.push(command), () => undefined);
  const id = session.join(credentials).sessionId!;
  session.receive({ type: 'connected', sessionId: id, members: [] });
  return { session, sent, id };
}
function track() {
  return {
    mediaStreamTrack: { enabled: true, readyState: 'live' }, isMuted: false,
    stop() { this.mediaStreamTrack.readyState = 'ended'; },
    async mute() { this.isMuted = true; this.mediaStreamTrack.enabled = false; },
    async unmute() { this.isMuted = false; this.mediaStreamTrack.enabled = true; },
  };
}

test('T2-03 canceled capture stops a late track before publishing', async () => {
  const acquired = deferred<ReturnType<typeof track>>();
  const microphone = createMicrophone(() => undefined, () => acquired.promise);
  const publications = new Set<ReturnType<typeof track>>();
  const context = { current: () => true, allowed: () => true,
    publish: async (value: ReturnType<typeof track>) => publications.add(value),
    unpublish: async (value: ReturnType<typeof track>) => publications.delete(value) };
  const pending = microphone.setEnabled({ type: 'microphone', sessionId, operation: 1, enabled: true }, context);
  await microphone.setEnabled({ type: 'microphone', sessionId, operation: 2, enabled: false }, context);
  const late = track(); acquired.resolve(late);
  await pending;
  expect(late.mediaStreamTrack).toEqual({ enabled: false, readyState: 'ended' });
  expect(publications.size).toBe(0);
});

test('T2-03 cancellation during publish removes the late publication and cannot report on', async () => {
  const published = deferred<void>();
  const value = track();
  const events: string[] = [];
  const microphone = createMicrophone((event) => { if (event.type === 'microphone') events.push(event.value); }, async () => value);
  const publications = new Set<ReturnType<typeof track>>();
  const context = { current: () => true, allowed: () => true,
    publish: async (value: ReturnType<typeof track>) => { await published.promise; publications.add(value); },
    unpublish: async (value: ReturnType<typeof track>) => publications.delete(value) };
  const pending = microphone.setEnabled({ type: 'microphone', sessionId, operation: 1, enabled: true }, context);
  await Promise.resolve();
  await microphone.setEnabled({ type: 'microphone', sessionId, operation: 2, enabled: false }, context);
  expect(value.mediaStreamTrack.enabled).toBe(false);
  published.resolve(); await pending;
  expect(publications.size).toBe(0);
  expect(value.mediaStreamTrack.readyState).toBe('ended');
  expect(events).not.toContain('on');
});

test('T2-03 mute retains a silent track and stop releases every owned track', async () => {
  const value = track();
  const microphone = createMicrophone(() => undefined, async () => value);
  const publications = new Set<ReturnType<typeof track>>();
  const context = { current: () => true, allowed: () => true,
    publish: async (value: ReturnType<typeof track>) => publications.add(value),
    unpublish: async (value: ReturnType<typeof track>) => publications.delete(value) };
  await microphone.setEnabled({ type: 'microphone', sessionId, operation: 1, enabled: true }, context);
  await microphone.setEnabled({ type: 'microphone', sessionId, operation: 2, enabled: false }, context);
  expect(value.mediaStreamTrack).toEqual({ enabled: false, readyState: 'live' });
  await microphone.setEnabled({ type: 'microphone', sessionId, operation: 3, enabled: true }, context);
  expect(value.mediaStreamTrack.enabled).toBe(true);
  expect(publications.size).toBe(1);
  microphone.stop();
  expect(value.mediaStreamTrack).toEqual({ enabled: false, readyState: 'ended' });
});

test('T2-03 canceling a delayed resume reports off when the superseded track is released', async () => {
  const value = track();
  const events: { operation: number; value: string }[] = [];
  const microphone = createMicrophone((event) => {
    if (event.type === 'microphone') events.push(event);
  }, async () => value);
  const publications = new Set<ReturnType<typeof track>>();
  const context = { current: () => true, allowed: () => true,
    publish: async (value: ReturnType<typeof track>) => publications.add(value),
    unpublish: async (value: ReturnType<typeof track>) => publications.delete(value) };
  await microphone.setEnabled({ type: 'microphone', sessionId, operation: 1, enabled: true }, context);
  await microphone.setEnabled({ type: 'microphone', sessionId, operation: 2, enabled: false }, context);
  const resume = deferred<void>();
  const mute = deferred<void>();
  const originalUnmute = value.unmute.bind(value);
  const originalMute = value.mute.bind(value);
  value.unmute = async () => { await resume.promise; await originalUnmute(); };
  value.mute = async () => { await mute.promise; await originalMute(); };
  const pendingResume = microphone.setEnabled({ type: 'microphone', sessionId, operation: 3, enabled: true }, context);
  const pendingMute = microphone.setEnabled({ type: 'microphone', sessionId, operation: 4, enabled: false }, context);
  resume.resolve(); await pendingResume;
  mute.resolve(); await pendingMute;
  expect(value.mediaStreamTrack).toEqual({ enabled: false, readyState: 'ended' });
  expect(publications.size).toBe(0);
  expect(events.at(-1)).toMatchObject({ operation: 4, value: 'off' });
  microphone.stop();
});

test('T2-03 a grant lost during asynchronous publication stops and removes the track', async () => {
  const published = deferred<void>();
  const value = track();
  let allowed = true;
  const events: string[] = [];
  const microphone = createMicrophone((event) => { if (event.type === 'microphone') events.push(event.value); }, async () => value);
  const publications = new Set<ReturnType<typeof track>>();
  const pending = microphone.setEnabled({ type: 'microphone', sessionId, operation: 1, enabled: true }, {
    current: () => true, allowed: () => allowed,
    publish: async (value) => { await published.promise; publications.add(value); },
    unpublish: async (value) => publications.delete(value),
  });
  await Promise.resolve(); allowed = false; published.resolve(); await pending;
  expect(value.mediaStreamTrack).toEqual({ enabled: false, readyState: 'ended' });
  expect(publications.size).toBe(0);
  expect(events).not.toContain('on');
});

test('T2-03 a canceled consent dialog rejection cannot permanently block a later explicit request', async () => {
  const { session, id } = connected();
  const consent = deferred<boolean>();
  try {
    const pending = session.setMicrophoneEnabled(id, true, () => consent.promise);
    await session.setMicrophoneEnabled(id, false, async () => true);
    consent.reject(new Error('Test dialog closed'));
    await pending;
    let prompts = 0;
    await session.setMicrophoneEnabled(id, true, async () => { prompts++; return false; });
    expect(prompts).toBe(1);
    expect(session.captureAllowed(id)).toBe(false);
  } finally { session.close(); }
});

for (const failure of ['capture', 'publish', 'unmute'] as const) {
  test('T2-03 ' + failure + ' failure keeps the microphone off and stops an acquired track', async () => {
    const value = track();
    const publications = new Set<ReturnType<typeof track>>();
    const events: string[] = [];
    const microphone = createMicrophone((event) => { if (event.type === 'microphone') events.push(event.value); }, async () => {
      if (failure === 'capture') throw new Error('Test capture failure');
      return value;
    });
    const context = { current: () => true, allowed: () => true,
      publish: async (value: ReturnType<typeof track>) => {
        if (failure === 'publish') throw new Error('Test publication failure');
        publications.add(value);
      }, unpublish: async (value: ReturnType<typeof track>) => publications.delete(value) };
    await microphone.setEnabled({ type: 'microphone', sessionId, operation: 1, enabled: true }, context);
    if (failure === 'unmute') {
      await microphone.setEnabled({ type: 'microphone', sessionId, operation: 2, enabled: false }, context);
      value.unmute = async () => { throw new Error('Test unmute failure'); };
      await microphone.setEnabled({ type: 'microphone', sessionId, operation: 3, enabled: true }, context);
    }
    expect(events.at(-1)).toBe('off');
    expect(publications.size).toBe(0);
    if (failure !== 'capture') expect(value.mediaStreamTrack).toEqual({ enabled: false, readyState: 'ended' });
    microphone.stop();
  });
}

test('T2-03 stale microphone results and playback events cannot revive a left session', async () => {
  const { session, sent, id } = connected();
  try {
    await session.setMicrophoneEnabled(id, true, async () => true);
    const command = sent.find((value) => value.type === 'microphone');
    if (!command || command.type !== 'microphone') throw new Error('Missing microphone operation');
    await session.setMicrophoneEnabled(id, false, async () => true);
    session.receive({ type: 'microphone', sessionId: id, operation: command.operation, value: 'on' });
    expect(session.snapshot.microphone).toBe('off');
    session.stop(id); session.destroyed(id);
    const fresh = session.join(credentials).sessionId!;
    session.receive({ type: 'connected', sessionId: fresh, members: [] });
    session.receive({ type: 'playback', sessionId: id, value: 'on' });
    session.receive({ type: 'microphone', sessionId: id, operation: command.operation, value: 'on' });
    expect(session.snapshot).toMatchObject({ microphone: 'off', playback: 'off', sessionId: fresh });
  } finally { session.close(); }
});

test('T2-03 audio commands admit only session-bound microphone and playback operations', () => {
  const command = new Ajv({ strict: true }).compile({ ...mediaSessionSchema, $ref: '#/$defs/command' });
  expect(command({ type: 'setMicrophoneEnabled', sessionId, enabled: true })).toBe(true);
  expect(command({ type: 'setMicrophoneEnabled', sessionId, enabled: false })).toBe(true);
  expect(command({ type: 'enableAudio', sessionId })).toBe(true);
  for (const value of [
    { type: 'setMicrophoneEnabled', sessionId, enabled: 'true' },
    { type: 'setMicrophoneEnabled', sessionId, enabled: true, approved: true },
    { type: 'enableAudio', sessionId, accessToken: 'unexpected' },
    { type: 'enableAudio', sessionId: 'old-or-invalid' },
  ]) expect(command(value)).toBe(false);
});

test('T2-03 late consent from a destroyed room cannot clear the new room capture transaction', async () => {
  const { session, id } = connected();
  const oldConsent = deferred<boolean>();
  const newConsent = deferred<boolean>();
  try {
    const oldRequest = session.setMicrophoneEnabled(id, true, () => oldConsent.promise);
    session.stop(id);
    session.destroyed(id);
    const fresh = session.join(credentials).sessionId!;
    session.receive({ type: 'connected', sessionId: fresh, members: [] });
    const newRequest = session.setMicrophoneEnabled(fresh, true, () => newConsent.promise);
    oldConsent.resolve(true);
    await oldRequest;
    newConsent.resolve(true);
    await newRequest;
    expect(session.captureAllowed(id)).toBe(false);
    expect(session.captureAllowed(fresh)).toBe(true);
  } finally { session.close(); }
});

test('T2-03 denial and cancellation keep listening and never reuse a late consent', async () => {
  const { session, sent, id } = connected();
  const consent = deferred<boolean>();
  try {
    await session.setMicrophoneEnabled(id, true, async () => false);
    expect(session.snapshot).toMatchObject({ status: 'connected', microphone: 'off', audioCode: 'MICROPHONE_DENIED' });
    const request = session.setMicrophoneEnabled(id, true, () => consent.promise);
    await session.setMicrophoneEnabled(id, false, async () => true);
    consent.resolve(true);
    await request;
    expect(session.captureAllowed(id)).toBe(false);
    expect(sent.some((value) => value.type === 'microphone' && value.enabled)).toBe(false);
    session.enableAudio(id);
    expect(sent.at(-1)).toEqual({ type: 'enableAudio', sessionId: id });
    let prompts = 0;
    await session.setMicrophoneEnabled(id, true, async () => { prompts++; return false; });
    expect(prompts).toBe(1);
  } finally { session.close(); }
});
