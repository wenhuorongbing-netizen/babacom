import { Room, RoomEvent, RemoteAudioTrack, LogLevel, setLogLevel } from 'livekit-client';
import type { MediaRuntimeCommand, MediaRuntimeEvent, MediaSnapshot } from '@babacom/contracts';

setLogLevel(LogLevel.silent);
type AudioPort = { add(track: RemoteAudioTrack): void; remove(track: RemoteAudioTrack): void; clear(): void };
type Active = { id: string; room: Room; connecting: Promise<void>; stopped: boolean; stopping: boolean };

export function createVoiceSession(audio: AudioPort, emit: (event: MediaRuntimeEvent) => void) {
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
    try {
      await item.room.disconnect(true);
      audio.clear();
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
      if (active) { emit({ type: 'failed', sessionId: command.sessionId }); return; }
      const room = new Room({ reconnectPolicy: { nextRetryDelayInMs: () => null } });
      const item: Active = { id: command.sessionId, room, connecting: Promise.resolve(), stopped: false, stopping: false };
      active = item;
      const announceMembers = () => { if (current(item)) emit({ type: 'members', sessionId: item.id, members: members(room) }); };
      room.on(RoomEvent.ParticipantConnected, announceMembers);
      room.on(RoomEvent.ParticipantDisconnected, announceMembers);
      room.on(RoomEvent.ParticipantNameChanged, announceMembers);
      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (current(item) && track instanceof RemoteAudioTrack) audio.add(track);
      });
      room.on(RoomEvent.TrackUnsubscribed, (track) => {
        if (current(item) && track instanceof RemoteAudioTrack) audio.remove(track);
      });
      room.on(RoomEvent.Disconnected, () => { if (current(item)) emit({ type: 'failed', sessionId: item.id }); });
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