import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, CheckCircle2, FileQuestion, Files, Lock, Plus, Printer, Send, Trash2, XCircle } from 'lucide-react';
import { DIFFICULTIES, LOCALES, QUESTION_KINDS, REVIEW_STATUSES, type Paginated } from '@sms/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { query, useResource, useSubmit } from '../../lib/data';
import { formatDateTime } from '../../lib/format';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Drawer,
  EmptyState,
  Field,
  Input,
  Loading,
  PageHeader,
  Pagination,
  Select,
  Tabs,
  useToast,
} from '../../components/ui';

interface Subject {
  id: number;
  name: string;
  isActive: boolean;
}
interface Grade {
  id: number;
  name: string;
}
interface QuestionRow {
  id: number;
  subject: { id: number; name: string };
  grade: { id: number; name: string } | null;
  language: string;
  outcome: string | null;
  difficulty: string;
  latest: { id: number; version: number; kind: string; stem: string; marks: number; reviewStatus: string };
  approvedVersionId: number | null;
}
interface Version {
  id: number;
  version: number;
  kind: 'mcq' | 'short' | 'essay';
  stem: string;
  options: Array<{ text: string; correct?: boolean }> | null;
  answer: string | null;
  marks: number;
  licence: string | null;
  source: string | null;
  reviewStatus: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
}
interface QuestionDetail {
  id: number;
  subjectId: number;
  versions: Version[];
  usedIn: Array<{ paperId: number; title: string; version: number; questionVersionId: number }>;
}
const REVIEW_TONE: Record<string, 'neutral' | 'warn' | 'ok' | 'danger'> = {
  draft: 'neutral',
  in_review: 'warn',
  approved: 'ok',
  rejected: 'danger',
};
const textarea =
  'block w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm focus:border-brand-500 focus:ring-3 focus:ring-brand-100 focus:outline-none';

export default function QuestionsPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'papers' ? 'papers' : 'questions';
  return (
    <>
      <PageHeader
        crumbs={[{ label: t('nav.dashboard'), to: '/' }, { label: t('questions.title') }]}
        title={t('questions.title')}
        description={t('questions.intro')}
      />
      <div className="space-y-6">
        <Tabs
          label={t('questions.title')}
          value={tab}
          onChange={(k) => setParams(k === 'questions' ? {} : { tab: k }, { replace: true })}
          items={[
            { key: 'questions', label: t('questions.tabs.questions'), icon: <FileQuestion className="size-4" /> },
            { key: 'papers', label: t('questions.tabs.papers'), icon: <Files className="size-4" /> },
          ]}
        />
        {tab === 'questions' ? <QuestionList /> : <PaperList />}
      </div>
    </>
  );
}

function useCatalog() {
  const subjects = useResource<{ items: Subject[] }>('/subjects');
  const grades = useResource<{ items: Grade[] }>('/grades');
  return { subjects: (subjects.data?.items ?? []).filter((s) => s.isActive), grades: grades.data?.items ?? [] };
}

function QuestionList() {
  const { t } = useTranslation();
  const { subjects } = useCatalog();
  const [subjectId, setSubjectId] = useState('');
  const [review, setReview] = useState('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<number | 'new' | null>(null);
  useEffect(() => {
    const h = setTimeout(() => (setQ(search.trim()), setPage(1)), 300);
    return () => clearTimeout(h);
  }, [search]);
  const list = useResource<Paginated<QuestionRow>>(`/questions${query({ subjectId, review, q, page, pageSize: 25 })}`);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          type="search"
          className="min-w-[12rem] flex-1"
          aria-label={t('questions.search')}
          placeholder={t('questions.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          aria-label={t('staff.subject')}
          className="w-full sm:w-44"
          value={subjectId}
          onChange={(e) => (setSubjectId(e.target.value), setPage(1))}
        >
          <option value="">{t('questions.allSubjects')}</option>
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t('questions.review')}
          className="w-full sm:w-40"
          value={review}
          onChange={(e) => (setReview(e.target.value), setPage(1))}
        >
          <option value="">{t('questions.anyReview')}</option>
          {REVIEW_STATUSES.map((r) => (
            <option key={r} value={r}>
              {t(`questions.reviewStatuses.${r}`)}
            </option>
          ))}
        </Select>
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setOpen('new')}>
          {t('questions.new')}
        </Button>
      </div>
      {list.error && <Alert>{t(list.error.message)}</Alert>}
      {!list.data ? (
        <Loading />
      ) : list.data.items.length === 0 ? (
        <EmptyState icon={<FileQuestion className="size-5" />} title={t('questions.empty')} description={t('questions.emptyHelp')} />
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {list.data.items.map((r) => (
            <li key={r.id}>
              <button type="button" className="w-full px-4 py-3 text-left hover:bg-subtle" onClick={() => setOpen(r.id)}>
                <span className="line-clamp-2 text-sm">{r.latest.stem}</span>
                <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-fg-muted">
                  <Badge tone={REVIEW_TONE[r.latest.reviewStatus]} dot>
                    {t(`questions.reviewStatuses.${r.latest.reviewStatus}`)}
                  </Badge>
                  <span>
                    {r.subject.name}
                    {r.grade && ` · ${r.grade.name}`} · {t(`questions.kinds.${r.latest.kind}`)} ·{' '}
                    {t(`questions.difficulties.${r.difficulty}`)} · {t('questions.marks', { count: r.latest.marks })} · v{r.latest.version}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {list.data && list.data.total > list.data.pageSize && (
        <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
      )}
      {open === 'new' && <QuestionEditor onClose={() => setOpen(null)} onDone={() => (setOpen(null), list.reload())} />}
      {typeof open === 'number' && <QuestionDrawer id={open} onClose={() => setOpen(null)} onChanged={list.reload} />}
    </div>
  );
}

interface Content {
  kind: 'mcq' | 'short' | 'essay';
  stem: string;
  options: Array<{ text: string; correct: boolean }>;
  answer: string;
  marks: string;
  licence: string;
  source: string;
}
const emptyContent = (): Content => ({
  kind: 'mcq',
  stem: '',
  options: [
    { text: '', correct: true },
    { text: '', correct: false },
  ],
  answer: '',
  marks: '1',
  licence: '',
  source: '',
});
const contentBody = (c: Content) => ({
  kind: c.kind,
  stem: c.stem,
  options: c.kind === 'mcq' ? c.options : null,
  answer: c.answer.trim() || null,
  marks: Number(c.marks),
  licence: c.licence.trim() || null,
  source: c.source.trim() || null,
});

function ContentFields({ value, onChange, errors }: { value: Content; onChange: (c: Content) => void; errors: Record<string, string> }) {
  const { t } = useTranslation();
  const set = (patch: Partial<Content>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('questions.kind')}>
          {(id) => (
            <Select id={id} value={value.kind} onChange={(e) => set({ kind: e.target.value as Content['kind'] })}>
              {QUESTION_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`questions.kinds.${k}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('questions.marksLabel')} error={errors.marks}>
          {(id) => (
            <Input
              id={id}
              type="number"
              inputMode="decimal"
              min={0.5}
              step="0.5"
              value={value.marks}
              onChange={(e) => set({ marks: e.target.value })}
            />
          )}
        </Field>
      </div>
      <Field label={t('questions.stem')} error={errors.stem}>
        {(id) => <textarea id={id} rows={4} className={textarea} value={value.stem} onChange={(e) => set({ stem: e.target.value })} />}
      </Field>
      {value.kind === 'mcq' && (
        <fieldset className="space-y-2">
          <legend className="text-[0.8125rem] font-medium">{t('questions.options')}</legend>
          {errors.options && <p className="text-[0.8125rem] text-danger">{errors.options}</p>}
          {value.options.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="radio"
                name="correct"
                aria-label={t('questions.correctOption', { n: i + 1 })}
                className="size-4 accent-brand-600"
                checked={o.correct}
                onChange={() => set({ options: value.options.map((x, j) => ({ ...x, correct: j === i })) })}
              />
              <Input
                aria-label={t('questions.optionN', { n: i + 1 })}
                value={o.text}
                onChange={(e) => set({ options: value.options.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })}
              />
              {value.options.length > 2 && (
                <button
                  type="button"
                  aria-label={t('questions.removeOption')}
                  className="text-fg-faint hover:text-fg"
                  onClick={() => set({ options: value.options.filter((_, j) => j !== i) })}
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </div>
          ))}
          {value.options.length < 8 && (
            <Button
              size="sm"
              type="button"
              icon={<Plus className="size-4" />}
              onClick={() => set({ options: [...value.options, { text: '', correct: false }] })}
            >
              {t('questions.addOption')}
            </Button>
          )}
        </fieldset>
      )}
      <Field label={value.kind === 'mcq' ? t('questions.explanation') : t('questions.answer')} optional={t('common.optional')}>
        {(id) => <textarea id={id} rows={3} className={textarea} value={value.answer} onChange={(e) => set({ answer: e.target.value })} />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('questions.source')} optional={t('common.optional')}>
          {(id) => <Input id={id} value={value.source} onChange={(e) => set({ source: e.target.value })} />}
        </Field>
        <Field label={t('questions.licence')} optional={t('common.optional')} hint={t('questions.licenceHint')}>
          {(id) => <Input id={id} value={value.licence} onChange={(e) => set({ licence: e.target.value })} />}
        </Field>
      </div>
    </div>
  );
}

function QuestionEditor({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { subjects, grades } = useCatalog();
  const [subjectId, setSubjectId] = useState('');
  const [gradeId, setGradeId] = useState('');
  const [language, setLanguage] = useState('en');
  const [difficulty, setDifficulty] = useState('medium');
  const [outcome, setOutcome] = useState('');
  const [content, setContent] = useState<Content>(emptyContent());
  const submit = useSubmit();
  useEffect(() => {
    if (!subjectId && subjects.length) setSubjectId(String(subjects[0]!.id));
  }, [subjects, subjectId]);
  async function save() {
    const ok = await submit.run(() =>
      api('/questions', {
        method: 'POST',
        body: {
          subjectId: Number(subjectId),
          gradeId: gradeId ? Number(gradeId) : null,
          language,
          difficulty,
          outcome: outcome.trim() || null,
          content: contentBody(content),
        },
      }),
    );
    if (ok) {
      toast.success(t('questions.saved'));
      onDone();
    }
  }
  const errors = Object.fromEntries(Object.entries(submit.fieldErrors).map(([k, v]) => [k.replace(/^content\./, ''), v]));
  return (
    <Drawer
      open
      wide
      title={t('questions.new')}
      description={t('questions.newHelp')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" busy={submit.busy} disabled={!subjectId || !content.stem.trim()} onClick={() => void save()}>
            {t('questions.saveDraft')}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {submit.error && <Alert>{submit.error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('staff.subject')}>
            {(id) => (
              <Select id={id} value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('announcements.grade')} optional={t('common.optional')}>
            {(id) => (
              <Select id={id} value={gradeId} onChange={(e) => setGradeId(e.target.value)}>
                <option value="">{t('crud.none')}</option>
                {grades.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('questions.language')}>
            {(id) => (
              <Select id={id} value={language} onChange={(e) => setLanguage(e.target.value)}>
                {LOCALES.map((l) => (
                  <option key={l} value={l}>
                    {t(`language.${l}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('questions.difficulty')}>
            {(id) => (
              <Select id={id} value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
                {DIFFICULTIES.map((d) => (
                  <option key={d} value={d}>
                    {t(`questions.difficulties.${d}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Field label={t('questions.outcome')} optional={t('common.optional')} hint={t('questions.outcomeHint')}>
          {(id) => <Input id={id} value={outcome} maxLength={191} onChange={(e) => setOutcome(e.target.value)} />}
        </Field>
        <ContentFields value={content} onChange={setContent} errors={errors} />
      </div>
    </Drawer>
  );
}

function QuestionDrawer({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const toast = useToast();
  const res = useResource<QuestionDetail>(`/questions/${id}`);
  const [editing, setEditing] = useState<Content | null>(null);
  const act = useSubmit();
  const q = res.data;
  const latest = q?.versions[0];
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    const ok = await act.run(async () => (await fn()) ?? true);
    if (ok) {
      toast.success(msg);
      setEditing(null);
      res.reload();
      onChanged();
    }
  };
  const errors = Object.fromEntries(Object.entries(act.fieldErrors));
  return (
    <Drawer
      open
      wide
      title={t('questions.question')}
      onClose={onClose}
      footer={
        editing ? (
          <>
            <Button onClick={() => setEditing(null)}>{t('common.cancel')}</Button>
            <Button
              variant="primary"
              busy={act.busy}
              onClick={() =>
                void run(
                  () => api(`/questions/${id}/versions`, { method: 'POST', body: contentBody(editing) }),
                  t('questions.versionSaved'),
                )
              }
            >
              {t('questions.saveVersion')}
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>{t('common.close')}</Button>
        )
      }
    >
      {res.error ? (
        <Alert>{t(res.error.message)}</Alert>
      ) : !q || !latest ? (
        <Loading />
      ) : editing ? (
        <div className="space-y-4">
          <Alert tone="info">{t('questions.editHelp')}</Alert>
          {act.error && <Alert>{act.error}</Alert>}
          <ContentFields value={editing} onChange={setEditing} errors={errors} />
        </div>
      ) : (
        <div className="space-y-5">
          {act.error && <Alert>{act.error}</Alert>}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() =>
                setEditing({
                  kind: latest.kind,
                  stem: latest.stem,
                  options: (latest.options ?? emptyContent().options).map((o) => ({ text: o.text, correct: Boolean(o.correct) })),
                  answer: latest.answer ?? '',
                  marks: String(latest.marks),
                  licence: latest.licence ?? '',
                  source: latest.source ?? '',
                })
              }
            >
              {t('questions.newVersion')}
            </Button>
            {(latest.reviewStatus === 'draft' || latest.reviewStatus === 'rejected') && (
              <Button
                size="sm"
                icon={<Send className="size-4" />}
                onClick={() => void run(() => api(`/questions/${id}/submit-review`, { method: 'POST' }), t('questions.sentForReview'))}
              >
                {t('questions.sendForReview')}
              </Button>
            )}
            {can('questions.review') && latest.reviewStatus !== 'approved' && (
              <>
                <Button
                  size="sm"
                  variant="primary"
                  icon={<CheckCircle2 className="size-4" />}
                  onClick={() =>
                    void run(
                      () => api(`/questions/${id}/review`, { method: 'POST', body: { versionId: latest.id, decision: 'approved' } }),
                      t('questions.approved'),
                    )
                  }
                >
                  {t('questions.approve')}
                </Button>
                <Button
                  size="sm"
                  icon={<XCircle className="size-4" />}
                  onClick={() =>
                    void run(
                      () => api(`/questions/${id}/review`, { method: 'POST', body: { versionId: latest.id, decision: 'rejected' } }),
                      t('questions.rejected'),
                    )
                  }
                >
                  {t('questions.reject')}
                </Button>
              </>
            )}
            <Button
              size="sm"
              variant="ghost"
              icon={<Trash2 className="size-4" />}
              onClick={() => void run(() => api(`/questions/${id}/retire`, { method: 'POST' }), t('questions.retired'))}
            >
              {t('questions.retire')}
            </Button>
          </div>
          {q.versions.map((v) => (
            <section key={v.id} className={`space-y-2 rounded-lg border p-4 ${v === latest ? 'border-brand-200' : 'border-line'}`}>
              <p className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                <span className="font-semibold text-fg">v{v.version}</span>
                <Badge tone={REVIEW_TONE[v.reviewStatus]} dot>
                  {t(`questions.reviewStatuses.${v.reviewStatus}`)}
                </Badge>
                {t(`questions.kinds.${v.kind}`)} · {t('questions.marks', { count: v.marks })}
                {v.reviewedBy && v.reviewedAt && ` · ${v.reviewedBy}, ${formatDateTime(v.reviewedAt, i18n.language)}`}
              </p>
              <p className="text-sm whitespace-pre-line">{v.stem}</p>
              {v.options && (
                <ol className="list-[upper-alpha] space-y-0.5 pl-6 text-sm">
                  {v.options.map((o, i) => (
                    <li key={i} className={o.correct ? 'font-semibold text-ok' : ''}>
                      {o.text}
                    </li>
                  ))}
                </ol>
              )}
              {v.answer && (
                <p className="rounded-md bg-subtle p-2 text-[0.8125rem]">
                  <Lock className="mr-1 inline size-3.5" />
                  {v.answer}
                </p>
              )}
              {q.usedIn.some((u) => u.questionVersionId === v.id) && (
                <p className="text-xs text-fg-faint">
                  {t('questions.usedIn', {
                    papers: q.usedIn
                      .filter((u) => u.questionVersionId === v.id)
                      .map((u) => `${u.title} v${u.version}`)
                      .join(', '),
                  })}
                </p>
              )}
            </section>
          ))}
        </div>
      )}
    </Drawer>
  );
}

// Papers -----------------------------------------------------------------------
interface PaperRow {
  id: number;
  title: string;
  subject: { id: number; name: string };
  grade: { id: number; name: string };
  latestVersion: number;
  latestStatus: 'draft' | 'final';
}
interface PaperDetail {
  id: number;
  title: string;
  subjectId: number;
  gradeId: number;
  versions: Array<{ id: number; version: number; status: 'draft' | 'final'; finalizedAt: string | null; finalizedBy: string | null }>;
}
interface PaperVersion {
  id: number;
  title: string;
  subject: string;
  grade: string;
  version: number;
  status: 'draft' | 'final';
  instructions: string | null;
  durationMinutes: number | null;
  totalMarks: number;
  questions: Array<Version & { position: number; itemMarks: number; questionId: number }>;
}

function PaperList() {
  const { t } = useTranslation();
  const { subjects, grades } = useCatalog();
  const list = useResource<{ items: PaperRow[] }>('/papers');
  const [open, setOpen] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [gradeId, setGradeId] = useState('');
  const submit = useSubmit();
  async function create() {
    const r = await submit.run(() =>
      api<{ id: number }>('/papers', { method: 'POST', body: { title, subjectId: Number(subjectId), gradeId: Number(gradeId) } }),
    );
    if (r) {
      setCreating(false);
      setTitle('');
      list.reload();
      setOpen(r.id);
    }
  }
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating((v) => !v)}>
          {t('questions.newPaper')}
        </Button>
      </div>
      {creating && (
        <div className="grid gap-3 rounded-lg border border-line bg-surface p-4 sm:grid-cols-4 sm:items-end">
          {submit.error && (
            <div className="sm:col-span-4">
              <Alert>{submit.error}</Alert>
            </div>
          )}
          <Field label={t('announcements.titleField')}>
            {(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} />}
          </Field>
          <Field label={t('staff.subject')}>
            {(id) => (
              <Select id={id} value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
                <option value="" disabled>
                  {t('crud.choose')}
                </option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('announcements.grade')}>
            {(id) => (
              <Select id={id} value={gradeId} onChange={(e) => setGradeId(e.target.value)}>
                <option value="" disabled>
                  {t('crud.choose')}
                </option>
                {grades.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Button variant="primary" busy={submit.busy} disabled={!title.trim() || !subjectId || !gradeId} onClick={() => void create()}>
            {t('questions.createPaper')}
          </Button>
        </div>
      )}
      {!list.data ? (
        <Loading />
      ) : list.data.items.length === 0 ? (
        <EmptyState icon={<Files className="size-5" />} title={t('questions.noPapers')} />
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {list.data.items.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left hover:bg-subtle"
                onClick={() => setOpen(p.id)}
              >
                <span>
                  <span className="font-medium">{p.title}</span>
                  <span className="ml-2 text-[0.8125rem] text-fg-muted">
                    {p.subject.name} · {p.grade.name}
                  </span>
                </span>
                <Badge tone={p.latestStatus === 'final' ? 'ok' : 'warn'} dot>
                  v{p.latestVersion} · {t(`questions.paperStatuses.${p.latestStatus}`)}
                </Badge>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open !== null && <PaperDrawer id={open} onClose={() => setOpen(null)} onChanged={list.reload} />}
    </div>
  );
}

function PaperDrawer({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const paper = useResource<PaperDetail>(`/papers/${id}`);
  const latest = paper.data?.versions[0];
  const [viewId, setViewId] = useState<number | null>(null);
  const shownId = viewId ?? latest?.id ?? null;
  const version = useResource<PaperVersion>(shownId ? `/paper-versions/${shownId}` : null);
  const bank = useResource<Paginated<QuestionRow>>(
    paper.data ? `/questions${query({ subjectId: paper.data.subjectId, pageSize: 100 })}` : null,
  );
  const [items, setItems] = useState<Array<{ questionVersionId: number; marks: number; stem: string }>>([]);
  const [instructions, setInstructions] = useState('');
  const [duration, setDuration] = useState('');
  const [showKey, setShowKey] = useState(false);
  const act = useSubmit();
  useEffect(() => {
    if (version.data) {
      setItems(version.data.questions.map((q) => ({ questionVersionId: q.id, marks: q.itemMarks, stem: q.stem })));
      setInstructions(version.data.instructions ?? '');
      setDuration(version.data.durationMinutes ? String(version.data.durationMinutes) : '');
    }
  }, [version.data]);
  const editable = version.data && latest && version.data.id === latest.id;
  const available = (bank.data?.items ?? []).filter(
    (q) => q.approvedVersionId && !items.some((i) => i.questionVersionId === q.approvedVersionId),
  );
  const move = (i: number, d: number) =>
    setItems((cur) => {
      const n = [...cur];
      const [x] = n.splice(i, 1);
      n.splice(i + d, 0, x!);
      return n;
    });
  const reload = () => {
    paper.reload();
    version.reload();
    onChanged();
  };
  async function save() {
    const r = await act.run(() =>
      api<{ versionId: number }>(`/papers/${id}/draft`, {
        method: 'PUT',
        body: {
          instructions: instructions.trim() || null,
          durationMinutes: duration ? Number(duration) : null,
          items: items.map((i) => ({ questionVersionId: i.questionVersionId, marks: i.marks })),
        },
      }),
    );
    if (r) {
      toast.success(t('questions.paperSaved'));
      setViewId(null);
      reload();
    }
  }
  async function finalize() {
    const r = await act.run(() => api(`/papers/${id}/finalize`, { method: 'POST' }));
    if (r) {
      toast.success(t('questions.paperFinalized'));
      reload();
    }
  }
  const total = items.reduce((s, i) => s + i.marks, 0);
  return (
    <Drawer
      open
      wide
      title={paper.data?.title ?? t('common.loading')}
      onClose={onClose}
      footer={
        <>
          <Button icon={<Printer className="size-4" />} disabled={!version.data} onClick={() => window.print()}>
            {t('attendance.print')}
          </Button>
          {editable && (
            <>
              <Button busy={act.busy} onClick={() => void save()}>
                {version.data!.status === 'final' ? t('questions.startNewVersion') : t('questions.savePaper')}
              </Button>
              {version.data!.status === 'draft' && (
                <Button
                  variant="primary"
                  icon={<Lock className="size-4" />}
                  busy={act.busy}
                  disabled={items.length === 0}
                  onClick={() => void finalize()}
                >
                  {t('questions.finalize')}
                </Button>
              )}
            </>
          )}
        </>
      }
    >
      {!paper.data || !version.data ? (
        <Loading />
      ) : (
        <div className="space-y-5">
          {act.error && <Alert>{act.error}</Alert>}
          <div className="flex flex-wrap items-center gap-3">
            <Select
              aria-label={t('questions.version')}
              className="w-48"
              value={shownId ?? ''}
              onChange={(e) => setViewId(Number(e.target.value))}
            >
              {paper.data.versions.map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.version} · {t(`questions.paperStatuses.${v.status}`)}
                </option>
              ))}
            </Select>
            <Checkbox label={t('questions.showKey')} checked={showKey} onChange={(e) => setShowKey(e.target.checked)} />
          </div>
          {version.data.status === 'final' && editable && <Alert tone="info">{t('questions.finalHelp')}</Alert>}
          <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
            <Field label={t('questions.paperInstructions')} optional={t('common.optional')}>
              {(fid) => (
                <textarea
                  id={fid}
                  rows={2}
                  className={textarea}
                  disabled={!editable}
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                />
              )}
            </Field>
            <Field label={t('questions.duration')} optional={t('common.optional')}>
              {(fid) => (
                <Input id={fid} type="number" min={5} disabled={!editable} value={duration} onChange={(e) => setDuration(e.target.value)} />
              )}
            </Field>
          </div>
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">{t('questions.paperQuestions', { count: items.length, total })}</h3>
            <ol className="space-y-2">
              {items.map((it, i) => {
                const full = version.data!.questions.find((q) => q.id === it.questionVersionId);
                return (
                  <li key={it.questionVersionId} className="rounded-lg border border-line p-3">
                    <div className="flex items-start gap-3">
                      <span className="tabular font-semibold">{i + 1}.</span>
                      <div className="min-w-0 flex-1 space-y-1 text-sm">
                        <p className="whitespace-pre-line">{it.stem}</p>
                        {showKey && full?.options && (
                          <ol className="list-[upper-alpha] pl-6">
                            {full.options.map((o, j) => (
                              <li key={j} className={o.correct ? 'font-semibold text-ok' : ''}>
                                {o.text}
                              </li>
                            ))}
                          </ol>
                        )}
                        {showKey && full?.answer && <p className="rounded bg-subtle p-2 text-[0.8125rem]">{full.answer}</p>}
                      </div>
                      {editable ? (
                        <div className="flex items-center gap-1">
                          <Input
                            aria-label={t('questions.marksLabel')}
                            className="w-20"
                            type="number"
                            min={0.5}
                            step="0.5"
                            value={String(it.marks)}
                            onChange={(e) => setItems((cur) => cur.map((x, j) => (j === i ? { ...x, marks: Number(e.target.value) } : x)))}
                          />
                          <button
                            type="button"
                            aria-label={t('questions.moveUp')}
                            disabled={i === 0}
                            className="p-1 text-fg-faint disabled:opacity-30"
                            onClick={() => move(i, -1)}
                          >
                            <ArrowUp className="size-4" />
                          </button>
                          <button
                            type="button"
                            aria-label={t('questions.moveDown')}
                            disabled={i === items.length - 1}
                            className="p-1 text-fg-faint disabled:opacity-30"
                            onClick={() => move(i, 1)}
                          >
                            <ArrowDown className="size-4" />
                          </button>
                          <button
                            type="button"
                            aria-label={t('questions.removeFromPaper')}
                            className="p-1 text-fg-faint"
                            onClick={() => setItems((cur) => cur.filter((_, j) => j !== i))}
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </div>
                      ) : (
                        <span className="text-[0.8125rem] text-fg-muted">{t('questions.marks', { count: it.marks })}</span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
          {editable && (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">{t('questions.addFromBank')}</h3>
              {available.length === 0 ? (
                <p className="text-sm text-fg-faint">{t('questions.noApproved')}</p>
              ) : (
                <ul className="max-h-72 divide-y divide-line overflow-auto rounded-lg border border-line">
                  {available.map((q) => (
                    <li key={q.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                      <span className="line-clamp-2">{q.latest.stem}</span>
                      <Button
                        size="sm"
                        icon={<Plus className="size-4" />}
                        onClick={() =>
                          setItems((cur) => [
                            ...cur,
                            { questionVersionId: q.approvedVersionId!, marks: q.latest.marks, stem: q.latest.stem },
                          ])
                        }
                      >
                        {t('questions.add')}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-fg-faint">{t('questions.addHelp')}</p>
            </section>
          )}
        </div>
      )}
    </Drawer>
  );
}
