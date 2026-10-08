import { useState } from 'react';
import type { MediaSnapshot } from '@babacom/contracts';
import { Button, List, StatusFeedback } from '@babacom/ui';
import { t } from '../../i18n';

export function VoicePanel({ snapshot, prepared }: { snapshot: MediaSnapshot; prepared: boolean }) {
  const [unavailable, setUnavailable] = useState(false);
  const pending = snapshot.status === 'connecting' || snapshot.status === 'leaving';
  const active = pending || snapshot.status === 'connected' || snapshot.status === 'cleanup-failed';
  const statusKey = {
    idle: 'mediaIdle', connecting: 'mediaConnecting', connected: 'mediaConnected',
    leaving: 'mediaLeaving', failed: 'mediaFailed', 'cleanup-failed': 'mediaCleanupFailed',
  } as const;
  const microphoneKey = { off: 'microphoneOff', requesting: 'microphoneRequesting', on: 'microphoneOn', muted: 'microphoneMuted' } as const;
  const act = (operation: () => Promise<MediaSnapshot>) => {
    setUnavailable(false);
    void operation().catch(() => setUnavailable(true));
  };
  return <section className="card" aria-labelledby="voice-heading">
    <h2 id="voice-heading">{t('voiceHeading')}</h2>
    <p>{t(microphoneKey[snapshot.microphone])}</p>
    {snapshot.status !== 'idle' || unavailable ? <StatusFeedback state={snapshot.status}>
      {unavailable ? t('mediaUnavailable') : snapshot.code ? t(snapshot.code) : t(statusKey[snapshot.status])}
    </StatusFeedback> : null}
    {snapshot.status === 'connected' ? <p>{t(snapshot.audioReceiving
      ? snapshot.playback === 'on' ? 'audioReceivingActive' : 'audioReceiving' : 'audioWaiting')}</p> : null}
    <div className="actions">
      {!active ? <Button type="button" disabled={!prepared} onClick={() => act(() => window.media.join())}>
        {t('joinVoice')}
      </Button> : null}
      {snapshot.status === 'connecting' && snapshot.sessionId
        ? <Button type="button" onClick={() => act(() => window.media.cancelJoin(snapshot.sessionId!))}>{t('cancelVoice')}</Button> : null}
      {snapshot.status === 'connected' && snapshot.sessionId
        ? <Button type="button" onClick={() => act(() => window.media.leave(snapshot.sessionId!))}>{t('leaveVoice')}</Button> : null}
    </div>
    {snapshot.members.length ? <List label={t('members')} items={snapshot.members.map((member) => ({
      key: member.identity, content: <>
        <span>{member.displayName}{member.isLocal ? ' · ' + t('self') : ''}</span>
        <p className="hint">{member.identity}</p>
      </>,
    }))} /> : null}
  </section>;
}
