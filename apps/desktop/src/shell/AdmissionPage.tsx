import { useEffect, useRef, useState } from 'react';
import { admissionSchema } from '@babacom/contracts';
import type { AdmissionSummary, RendererResult } from '@babacom/contracts';
import { Button, StatusFeedback, TextInput } from '@babacom/ui';
import { t } from '../i18n';

type State = { status: 'idle' | 'processing' } | RendererResult;

function normalizeName(raw: string): string | null {
  const rule = admissionSchema['x-nickname'];
  if ([...raw].length > rule.rawMaxCodePoints) return null;
  const value = raw.normalize(rule.normalization).replace(/^ +| +$/g, '');
  const points = [...value];
  if (points.length < rule.normalizedMinCodePoints || points.length > rule.normalizedMaxCodePoints || !value.trim()) return null;
  if (/[\p{Cc}\p{Cs}]/u.test(value) || points.some((point) => rule.forbiddenCodePoints.some((code) => point.codePointAt(0) === code))) return null;
  return value;
}

export function AdmissionPage() {
  const [name, setName] = useState('');
  const [state, setState] = useState<State>({ status: 'idle' });
  const [retryUntil, setRetryUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const inFlight = useRef(false);
  const operation = useRef(0);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => { clearInterval(timer); operation.current++; void window.admission.cancel(); };
  }, []);

  useEffect(() => {
    if (state.status !== 'ready') return;
    const timer = setTimeout(() => {
      operation.current++;
      void window.admission.cancel();
      setState({ status: 'failure', code: 'EXPIRED' });
    }, Math.max(0, Date.parse(state.summary.expiresAt) - Date.now()));
    return () => clearTimeout(timer);
  }, [state]);

  async function prepare(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current || Date.now() < retryUntil) return;
    const normalized = normalizeName(name);
    if (normalized === null) {
      setState({ status: 'failure', code: 'INVALID_NAME' });
      return;
    }
    const current = ++operation.current;
    inFlight.current = true;
    setState({ status: 'processing' });
    try {
      const result = await window.admission.prepare({ roomName: window.admission.roomName, displayName: name });
      if (current !== operation.current) return;
      if (result.status === 'failure' && result.retryAfterSeconds) {
        setRetryUntil(Date.now() + result.retryAfterSeconds * 1000);
      }
      setState(result);
    } catch {
      if (current === operation.current) setState({ status: 'failure', code: 'REQUEST_FAILED' });
    } finally {
      if (current === operation.current) inFlight.current = false;
    }
  }

  function cancel() {
    operation.current++;
    inFlight.current = false;
    void window.admission.cancel();
    setState({ status: 'idle' });
  }

  const waiting = Math.max(0, Math.ceil((retryUntil - now) / 1000));
  const summary: AdmissionSummary | null = state.status === 'ready' ? state.summary : null;
  const message = state.status === 'failure' ? t(state.code)
    : state.status === 'ready' ? t('ready')
      : state.status === 'processing' ? t('processing') : t('idle');

  return <main>
    <p>{t('appName')}</p>
    <section className="card" aria-labelledby="admission-heading">
      <span className="badge">{t(window.admission.environment === 'local-test' ? 'localTest' : 'controlled')}</span>
      <h1 id="admission-heading">{t('heading')}</h1>
      <p>{t('intro')}</p>
      <form onSubmit={prepare}>
        <TextInput id="display-name" label={t('nickname')} value={name}
          onChange={(event) => setName(event.target.value)} disabled={state.status === 'processing'}
          autoComplete="off" aria-describedby="nickname-hint" />
        <p id="nickname-hint" className="hint">{t('nicknameHint')}</p>
        <div className="actions">
          <Button type="submit" disabled={state.status === 'processing' || waiting > 0}>
            {t(state.status === 'processing' ? 'processing' : state.status === 'failure' ? 'retry' : 'prepare')}
          </Button>
          {state.status === 'processing' || state.status === 'ready'
            ? <Button type="button" onClick={cancel}>{t('cancel')}</Button> : null}
        </div>
      </form>
      <StatusFeedback state={state.status}>{message}{waiting > 0 ? ' · ' + t('retryWait', { seconds: waiting }) : ''}</StatusFeedback>
      {summary ? <dl>
        <dt>{t('preparedName')}</dt><dd>{summary.displayName}</dd>
        <dt>{t('preparedRoom')}</dt><dd>{summary.roomName}</dd>
      </dl> : null}
      <p className="hint">{t('notConnected')}</p>
    </section>
  </main>;
}
