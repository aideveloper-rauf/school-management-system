import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { BadgeCheck, ShieldX } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { Alert, Button, Card, Field, Input } from '../../components/ui';

interface Verification {
  serial: string;
  valid: boolean;
  status: 'issued' | 'revoked';
  title: string;
  holder: string;
  issuedOn: string;
  revokedOn: string | null;
  school: string | null;
}

/** Public certificate check (no sign-in). Shows only validity and the minimum needed to confirm it. */
export default function VerifyPage() {
  const { t, i18n } = useTranslation();
  const [params, setParams] = useSearchParams();
  const [serial, setSerial] = useState(params.get('serial') ?? '');
  const [result, setResult] = useState<Verification | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function check(e?: FormEvent) {
    e?.preventDefault();
    const s = serial.trim().toUpperCase();
    if (!s) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setParams({ serial: s }, { replace: true });
    try {
      setResult(await api<Verification>(`/public/certificates/${encodeURIComponent(s)}`));
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'NOT_FOUND' ? t('verify.notFound') : t((err as Error).message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-lg space-y-6 px-4 py-12">
      <div>
        <h1 className="text-xl font-semibold">{t('verify.title')}</h1>
        <p className="mt-1 text-sm text-fg-muted">{t('verify.intro')}</p>
      </div>
      <form onSubmit={check} className="flex items-end gap-2">
        <div className="flex-1">
          <Field label={t('certificates.serial')}>
            {(id) => <Input id={id} className="font-mono uppercase" value={serial} onChange={(e) => setSerial(e.target.value)} />}
          </Field>
        </div>
        <Button type="submit" variant="primary" busy={busy} disabled={!serial.trim()}>
          {t('verify.check')}
        </Button>
      </form>
      {error && <Alert>{error}</Alert>}
      {result && (
        <Card>
          <div className="flex gap-3">
            {result.valid ? <BadgeCheck className="size-8 shrink-0 text-ok" /> : <ShieldX className="size-8 shrink-0 text-danger" />}
            <div className="space-y-1 text-sm">
              <p className={`text-base font-semibold ${result.valid ? 'text-ok' : 'text-danger'}`}>
                {result.valid ? t('verify.valid') : t('verify.revoked')}
              </p>
              <p>
                <strong>{result.title}</strong>
              </p>
              <p>{t('verify.holder', { name: result.holder })}</p>
              <p>{t('verify.issued', { school: result.school ?? '', date: formatDate(result.issuedOn, i18n.language) })}</p>
              {result.revokedOn && <p>{t('verify.revokedOn', { date: formatDate(result.revokedOn, i18n.language) })}</p>}
              <p className="font-mono text-xs text-fg-muted">{result.serial}</p>
            </div>
          </div>
        </Card>
      )}
    </main>
  );
}
