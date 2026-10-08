import type { RemoteAudioTrack } from 'livekit-client';

// Receipt and playback are separate; elements are created only by explicit enable.
export function createAudioReceiver(onReceiving: (value: boolean) => void) {
  const tracks = new Map<string, RemoteAudioTrack>();
  const players = new Map<string, HTMLMediaElement>();
  let enabled = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let generation = 0;
  let busy = false;
  async function inspect() {
    if (busy) return;
    busy = true;
    const current = generation;
    try {
      const reports = await Promise.all([...tracks.values()].map((track) => track.getReceiverStats().catch(() => undefined)));
      if (current === generation) onReceiving(reports.some((report) => (report?.bytesReceived ?? 0) > 0));
    } finally { if (current === generation) busy = false; }
  }
  const detach = (track: RemoteAudioTrack) => {
    for (const element of track.detach()) {
      element.pause(); element.srcObject = null; element.remove();
    }
    if (track.sid) players.delete(track.sid);
  };
  const attach = (track: RemoteAudioTrack) => {
    if (!track.sid || players.has(track.sid)) return;
    const element = track.attach();
    element.hidden = true;
    document.body.append(element);
    players.set(track.sid, element);
  };
  return {
    add(track: RemoteAudioTrack) {
      if (!track.sid) return;
      const previous = tracks.get(track.sid);
      if (previous === track) return;
      if (previous) detach(previous);
      tracks.set(track.sid, track);
      if (enabled) attach(track);
      if (!timer) timer = setInterval(() => { void inspect(); }, 500);
    },
    remove(track: RemoteAudioTrack) {
      if (!track.sid || tracks.get(track.sid) !== track) return;
      detach(track);
      tracks.delete(track.sid);
    },
    async enable(start: () => Promise<void>, current: () => boolean): Promise<boolean> {
      if (!current()) return false;
      const token = generation;
      enabled = true;
      for (const track of tracks.values()) attach(track);
      try {
        await start();
        return current() && generation === token;
      } catch {
        if (generation === token) {
          enabled = false;
          for (const track of tracks.values()) detach(track);
        }
        return false;
      }
    },
    clear() {
      generation++;
      enabled = false;
      busy = false;
      if (timer) clearInterval(timer);
      timer = null;
      for (const track of tracks.values()) detach(track);
      tracks.clear();
      onReceiving(false);
    },
  };
}
