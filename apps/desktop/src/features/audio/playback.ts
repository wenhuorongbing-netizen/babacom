import type { RemoteAudioTrack } from 'livekit-client';

// Receipt is separate from audible playback. T2-01 never attaches an autoplay element.
export function createAudioReceiver(onReceiving: (value: boolean) => void) {
  const tracks = new Map<string, RemoteAudioTrack>();
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
    } finally { busy = false; }
  }
  return {
    add(track: RemoteAudioTrack) {
      if (!track.sid) return;
      tracks.set(track.sid, track);
      if (!timer) timer = setInterval(() => { void inspect(); }, 500);
    },
    remove(track: RemoteAudioTrack) { if (track.sid) tracks.delete(track.sid); },
    clear() {
      generation++;
      if (timer) clearInterval(timer);
      timer = null;
      for (const track of tracks.values()) for (const element of track.detach()) element.remove();
      tracks.clear();
      onReceiving(false);
    },
  };
}