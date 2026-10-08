import { Room, RoomEvent, RemoteAudioTrack, LogLevel, setLogLevel, Track } from 'livekit-client';
import type { LocalAudioTrack, RoomEventCallbacks } from 'livekit-client';
import type { MediaRuntimeCommand, MediaRuntimeEvent, MediaSnapshot } from '@babacom/contracts';

setLogLevel(LogLevel.silent);
type AudioPort = { add(track: RemoteAudioTrack): void; remove(track: RemoteAudioTrack): void; clear(): void; enable(start: () => Promise<void>, allowed: () => boolean): Promise<boolean> };
type MicrophonePort = {
  setEnabled(command: Extract<MediaRuntimeCommand, { type: 'microphone' }>, context: {
    current(): boolean; allowed(): boolean;
    publish(track: LocalAudioTrack): Promise<unknown>; unpublish(track: LocalAudioTrack): Promise<unknown>;
  }): Promise<void>;
  stop(): void;
};
type Active = { id: string; room: Room; connecting: Promise<void>; stopped: boolean; stopping: boolean; off: (() => void)[]; audioBusy: boolean };

export function createVoiceSession(audio: AudioPort, microphone: MicrophonePort, emit: (event: MediaRuntimeEvent) => void) {
  let active: Active | null = null;
  const members = (room: Room): MediaSnapshot['members'] =>
    [room.localParticipant, ...room.remoteParticipants.values()]
      .filter((participant) => participant.identity && participant.identity.length <= 128)
      .slice(0, 100).map((participant) => ({
        identity: participant.identity,
        displayName: [...(participant.name || participant.identity)].slice(0, 128).join(''),
        isLocal: participant === room.localParticipant,
      })).sort((a, b) => a.identity.localeCompare(b.identity));
  const current = (item: Active) => active === item && !item.stopped;
  async function stop(item: Active) {
    if (item.stopping) return;
    item.stopping = true;
    item.stopped = true;
    microphone.stop();
    audio.clear();
    for (const off of item.off) off();
    item.off = [];
    try {
      await item.room.disconnect(true);
      if (active === item) active = null;
      emit({ type: 'ended', sessionId: item.id });
    } catch { emit({ type: 'failed', sessionId: item.id }); }
  }
  return {
    receiving(value: boolean) {
      if (active && !active.stopped && active.room.state === 'connected') emit({ type: 'receiving', sessionId: active.id, value });
    },
    run(command: MediaRuntimeCommand) {
      if (command.type === 'stop') {
        if (active?.id === command.sessionId) void stop(active);
        return;
      }
      if (command.type === 'microphone') {
        const item = active;
        if (!item || item.id !== command.sessionId || !current(item) || item.room.state !== 'connected') return;
        void microphone.setEnabled(command, {
          current: () => current(item) && item.room.state === 'connected',
          allowed: () => item.room.localParticipant.permissions?.canPublish === true
            && (item.room.localParticipant.permissions.canPublishSources?.includes(Track.sourceToProto(Track.Source.Microphone)) ?? false),
          publish: (track) => item.room.localParticipant.publishTrack(track, { source: Track.Source.Microphone }),
          unpublish: (track) => item.room.localParticipant.unpublishTrack(track, true),
        });
        return;
      }
      if (command.type === 'enableAudio') {
        const item = active;
        if (!item || item.id !== command.sessionId || !current(item) || item.room.state !== 'connected' || item.audioBusy) return;
        item.audioBusy = true;
        // Calling enable synchronously preserves the native gesture while startAudio runs.
        void audio.enable(() => item.room.startAudio(), () => current(item)).then((success) => {
          if (current(item)) emit({ type: 'playback', sessionId: item.id, value: success ? 'on' : 'blocked' });
        }).finally(() => { item.audioBusy = false; });
        return;
      }
      if (active) { emit({ type: 'failed', sessionId: command.sessionId }); return; }
      const room = new Room({ reconnectPolicy: { nextRetryDelayInMs: () => null } });
      const item: Active = { id: command.sessionId, room, connecting: Promise.resolve(), stopped: false, stopping: false, off: [], audioBusy: false };
      active = item;
      const listen = <E extends RoomEvent>(name: E, listener: RoomEventCallbacks[E]) => {
        room.on(name, listener);
        item.off.push(() => room.off(name, listener));
      };
      const announceMembers = () => { if (current(item)) emit({ type: 'members', sessionId: item.id, members: members(room) }); };
      listen(RoomEvent.ParticipantConnected, announceMembers);
      listen(RoomEvent.ParticipantDisconnected, announceMembers);
      listen(RoomEvent.ParticipantNameChanged, announceMembers);
      listen(RoomEvent.TrackSubscribed, (track) => {
        if (current(item) && track instanceof RemoteAudioTrack) audio.add(track);
      });
      listen(RoomEvent.TrackUnsubscribed, (track) => {
        if (current(item) && track instanceof RemoteAudioTrack) audio.remove(track);
      });
      listen(RoomEvent.Disconnected, () => { if (current(item)) emit({ type: 'failed', sessionId: item.id }); });
      listen(RoomEvent.AudioPlaybackStatusChanged, (allowed) => {
        if (current(item) && !allowed) emit({ type: 'playback', sessionId: item.id, value: 'blocked' });
      });
      item.connecting = room.connect(command.livekitUrl, 'babacom-no-url-credential', {
        maxRetries: 0, websocketTimeout: 15_000, peerConnectionTimeout: 15_000,
        rtcConfig: { iceServers: [] },
      }).then(async () => {
        if (!current(item)) { await room.disconnect(true); return; }
        if (room.name !== command.roomName || room.localParticipant.identity !== command.participantIdentity) {
          emit({ type: 'failed', sessionId: item.id }); return;
        }
        emit({ type: 'connected', sessionId: item.id, members: members(room) });
      }).catch(() => { if (current(item)) emit({ type: 'failed', sessionId: item.id }); });
    },
  };
}
