import { createLocalAudioTrack } from 'livekit-client';
import type { MediaRuntimeCommand, MediaRuntimeEvent } from '@babacom/contracts';

type Command = Extract<MediaRuntimeCommand, { type: 'microphone' }>;
type CapturedAudio = {
  mediaStreamTrack: { enabled: boolean; readyState: string };
  isMuted: boolean; stop(): void; mute(): Promise<unknown>; unmute(): Promise<unknown>;
};
type Publication<T> = {
  current(): boolean; allowed(): boolean;
  publish(track: T): Promise<unknown>; unpublish(track: T): Promise<unknown>;
};

export const captureMicrophone = () => createLocalAudioTrack({ echoCancellation: true, noiseSuppression: true, autoGainControl: true });

// The controller owns every acquired track, including tracks arriving after cancellation.
export function createMicrophone<T extends CapturedAudio>(emit: (event: MediaRuntimeEvent) => void, acquire: () => Promise<T>) {
  const owned = new Set<T>();
  let kept: T | null = null;
  let generation = 0;
  const stopTrack = (track: T) => { track.mediaStreamTrack.enabled = false; track.stop(); owned.delete(track); };
  return {
    async setEnabled(command: Command, context: Publication<T>) {
      const token = ++generation;
      const current = () => token === generation && context.current();
      const report = (value: 'off' | 'on' | 'muted', code?: 'MICROPHONE_DENIED' | 'MICROPHONE_FAILED') => {
        if (current()) emit({ type: 'microphone', sessionId: command.sessionId, operation: command.operation, value, ...(code ? { code } : {}) });
      };
      if (!command.enabled) {
        for (const track of owned) if (track !== kept) stopTrack(track);
        if (!kept) { report('off'); return; }
        const track = kept;
        track.mediaStreamTrack.enabled = false;
        try {
          await track.mute();
          report(kept === track && track.mediaStreamTrack.readyState !== 'ended' ? 'muted' : 'off');
        }
        catch { stopTrack(track); if (kept === track) kept = null; report('off', 'MICROPHONE_FAILED'); }
        return;
      }
      let track: T | null = null;
      try {
        if (!current() || !context.allowed()) { report('off', 'MICROPHONE_DENIED'); return; }
        if (kept?.mediaStreamTrack.readyState === 'ended') {
          const ended = kept; kept = null; stopTrack(ended);
          await context.unpublish(ended);
        }
        if (!current()) return;
        track = kept;
        if (track) {
          await track.unmute();
        } else {
          track = await acquire();
          owned.add(track);
          if (!current()) return;
          // A separate check protects the interval between capture and publication.
          if (!context.allowed()) { report('off', 'MICROPHONE_DENIED'); return; }
          await context.publish(track);
        }
        if (!current()) return;
        if (!context.allowed()) { report('off', 'MICROPHONE_DENIED'); return; }
        kept = track;
        report('on');
      } catch (error) {
        if (track) { stopTrack(track); if (kept === track) kept = null; }
        const denied = error instanceof Error && (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError');
        report('off', denied ? 'MICROPHONE_DENIED' : 'MICROPHONE_FAILED');
      } finally {
        if (track && (!current() || kept !== track)) {
          stopTrack(track);
          if (kept === track) kept = null;
          await context.unpublish(track).catch(() => {
            if (context.current()) emit({ type: 'failed', sessionId: command.sessionId });
          });
        }
        emit({ type: 'captureEnded', sessionId: command.sessionId, operation: command.operation });
      }
    },
    stop() {
      generation++;
      kept = null;
      for (const track of owned) stopTrack(track);
    },
  };
}
