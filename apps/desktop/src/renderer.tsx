import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { MediaSnapshot } from '@babacom/contracts';
import { AdmissionPage } from './shell/AdmissionPage';
import { VoicePanel } from './features/voice/VoicePanel';
import { t } from './i18n';
import './styles/tokens.css';

function Desktop() {
  const [prepared, setPrepared] = useState(false);
  const [snapshot, setSnapshot] = useState<MediaSnapshot>({
    status: 'idle', sessionId: null, microphone: 'off', playback: 'off', members: [], audioReceiving: false,
  });
  useEffect(() => {
    let changes = 0;
    let mounted = true;
    const off = window.media.subscribe((value) => {
      changes++;
      if (value.status === 'idle' || value.status === 'failed') setPrepared(false);
      setSnapshot(value);
    });
    void window.media.getSnapshot().then((value) => {
      if (mounted && changes === 0) setSnapshot(value);
    }).catch(() => {
      if (mounted && changes === 0) setSnapshot({
        status: 'failed', sessionId: null, microphone: 'off', playback: 'off',
        members: [], audioReceiving: false, code: 'CONNECT_FAILED',
      });
    });
    return () => { mounted = false; off(); };
  }, []);
  const panel = <VoicePanel snapshot={snapshot} prepared={prepared} />;
  const active = ['connecting', 'connected', 'leaving', 'cleanup-failed'].includes(snapshot.status);
  return active ? <main><p>{t('appName')}</p>{panel}</main>
    : <AdmissionPage onPreparedChange={setPrepared}>{panel}</AdmissionPage>;
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');
createRoot(root).render(<Desktop />);
