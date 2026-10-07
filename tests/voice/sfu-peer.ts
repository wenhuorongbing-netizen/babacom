import { ipcRenderer } from 'electron';
import { Room, setLogLevel, LogLevel, Track, RoomEvent } from 'livekit-client';
import type { AdmissionSuccess } from '@babacom/contracts';
setLogLevel(LogLevel.silent);
const room = new Room({ reconnectPolicy: { nextRetryDelayInMs: () => null } });
let audio: AudioContext | null = null;
let oscillator: OscillatorNode | null = null;
let tracks: MediaStreamTrack[] = [];
const status = (text: string) => {
  const element = document.getElementById('status');
  if (element) element.textContent = text;
};
room.on(RoomEvent.Disconnected, () => {
  for (const track of tracks) track.stop();
  tracks = [];
  oscillator?.stop(); oscillator = null;
  void audio?.close(); audio = null;
  status('disconnected');
});
window.addEventListener('DOMContentLoaded', () => {
  status(room.state);
  void ipcRenderer.invoke('peer:configuration').then(async (value: AdmissionSuccess | null) => {
    if (!value) return;
    status('connecting');
    try {
      await room.connect(value.livekitUrl, value.accessToken, { maxRetries: 0, rtcConfig: { iceServers: [] } });
      status('connected');
      const button = document.getElementById('start');
      if (button instanceof HTMLButtonElement) button.disabled = false;
    } catch { status('failed'); }
  });
  document.getElementById('start')?.addEventListener('click', () => {
    if (room.state !== 'connected' || audio) return;
    // A user gesture resumes a synthetic source; nothing connects to the speaker destination.
    audio = new AudioContext();
    oscillator = audio.createOscillator();
    const destination = audio.createMediaStreamDestination();
    const gain = audio.createGain();
    gain.gain.value = 0.05;
    oscillator.frequency.value = 440;
    oscillator.connect(gain).connect(destination);
    tracks = destination.stream.getAudioTracks();
    oscillator.start();
    void audio.resume().then(async () => {
      await room.localParticipant.publishTrack(tracks[0], { source: Track.Source.Microphone, name: 'synthetic-fixture' });
      status('publishing');
    }).catch(() => status('failed'));
  });
});