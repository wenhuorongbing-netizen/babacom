import { useState } from 'react';
import type { MediaSnapshot } from '@babacom/contracts';
import { Button, StatusFeedback } from '@babacom/ui';
import { t } from '../../i18n';

export function AudioControls({ snapshot }: { snapshot: MediaSnapshot }) {
  const [unavailable, setUnavailable] = useState(false);
  if (snapshot.status !== 'connected' || !snapshot.sessionId) return null;
  const id = snapshot.sessionId;
  const act = (operation: () => Promise<MediaSnapshot>) => {
    setUnavailable(false);
    void operation().catch(() => setUnavailable(true));
  };
  return <section className="card" aria-labelledby="audio-heading">
    <h2 id="audio-heading">{t('audioHeading')}</h2>
    <p>{t(snapshot.playback === 'on' ? 'audioEnabled' : 'audioDisabled')}</p>
    {snapshot.audioCode || unavailable ? <StatusFeedback state="audio-error">
      {unavailable ? t('mediaUnavailable') : snapshot.audioCode ? t(snapshot.audioCode) : null}
    </StatusFeedback> : null}
    <div className="actions">
      <Button type="button" onClick={() => act(() => window.media.setMicrophoneEnabled(id,
        snapshot.microphone !== 'on' && snapshot.microphone !== 'requesting'))}>
        {t(snapshot.microphone === 'on' ? 'microphoneMute' : snapshot.microphone === 'requesting' ? 'microphoneCancel' : 'microphoneEnable')}
      </Button>
      {snapshot.playback !== 'on' ? <Button type="button" onClick={() => act(() => window.media.enableAudio(id))}>{t('audioEnable')}</Button> : null}
    </div>
  </section>;
}
