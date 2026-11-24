import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, ClipboardList, Download, FileText, Paperclip, Plus, Send, Trash2, Upload, X } from 'lucide-react';
import { API_PREFIX, type Paginated } from '@sms/shared';
import { api, ApiError, csrfHeader } from '../../lib/api';
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
  useToast,
} from '../../components/ui';

interface FileRef {
  id: number;
  name: string;
  mimeType: string;
  size: number;
}
interface Submission {
  id: number;
  textAnswer: string | null;
  submittedAt: string;
  isLate: boolean;
  status: 'submitted' | 'returned';
  feedback: string | null;
  score: number | null;
  returnedAt: string | null;
  files: FileRef[];
}
interface Item {
  id: number;
  kind: 'resource' | 'assignment';
  title: string;
  instructions: string | null;
  dueAt: string | null;
  allowLate: boolean;
  maxScore: number | null;
  publishedAt: string | null;
  classSection: { id: number; name: string; gradeName: string };
  subject: { id: number; name: string };
  author: string | null;
  mySubmission?: { status: string; isLate: boolean; submittedAt: string; score: number | null } | null;
}
interface ItemDetail extends Item {
  files: FileRef[];
  canManage: boolean;
  mySubmission: Submission | null;
}
interface Teaching {
  assignments: Array<{
    class: { id: number; name: string; gradeName: string; isCurrentYear: boolean };
    subject: { id: number; name: string };
  }>;
}

const MAX_BYTES = 10 * 1024 * 1024;
const sizeLabel = (n: number) => (n > 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} kB`);

/** Upload one file as raw bytes; the server sniffs its type. */
async function uploadFile(file: File): Promise<FileRef> {
  const res = await fetch(`${API_PREFIX}/files?name=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/octet-stream', ...csrfHeader() },
    body: file,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok)
    throw new ApiError(res.status, body?.error?.code ?? 'INTERNAL', body?.error?.message ?? 'errors.internal', body?.error?.details);
  return body as FileRef;
}

function FileList({ files, onRemove }: { files: FileRef[]; onRemove?: (id: number) => void }) {
  const { t } = useTranslation();
  if (files.length === 0) return null;
  return (
    <ul className="space-y-1.5">
      {files.map((f) => (
        <li key={f.id} className="flex items-center justify-between gap-2 rounded-md border border-line px-3 py-2 text-sm">
          <a className="flex min-w-0 items-center gap-2 text-brand-600 hover:underline" href={`${API_PREFIX}/files/${f.id}`}>
            <FileText className="size-4 shrink-0" />
            <span className="truncate">{f.name}</span>
            <span className="shrink-0 text-xs text-fg-faint">{sizeLabel(f.size)}</span>
          </a>
          {onRemove ? (
            <button
              type="button"
              aria-label={t('learning.removeFile', { name: f.name })}
              className="text-fg-faint hover:text-fg"
              onClick={() => onRemove(f.id)}
            >
              <X className="size-4" />
            </button>
          ) : (
            <Download className="size-4 shrink-0 text-fg-faint" aria-hidden />
          )}
        </li>
      ))}
    </ul>
  );
}

function FilePicker({ files, setFiles, max }: { files: FileRef[]; setFiles: (f: FileRef[]) => void; max: number }) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const list = [...(e.target.files ?? [])];
    e.target.value = '';
    setError(null);
    if (files.length + list.length > max) return setError(t('learning.tooManyFiles', { max }));
    if (list.some((f) => f.size > MAX_BYTES)) return setError(t('learning.fileTooLarge'));
    setBusy(true);
    try {
      const added: FileRef[] = [];
      for (const f of list) added.push(await uploadFile(f));
      setFiles([...files, ...added]);
    } catch (err) {
      setError(t((err as Error).message));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2">
      <FileList files={files} onRemove={(id) => setFiles(files.filter((f) => f.id !== id))} />
      {error && <Alert>{error}</Alert>}
      <input
        ref={input}
        type="file"
        multiple
        className="hidden"
        accept=".pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx,.pptx,.odt,.ods,.odp,.txt"
        onChange={(e) => void onPick(e)}
      />
      <Button
        type="button"
        size="sm"
        icon={<Paperclip className="size-4" />}
        busy={busy}
        disabled={files.length >= max}
        onClick={() => input.current?.click()}
      >
        {t('learning.attach')}
      </Button>
      <p className="text-xs text-fg-faint">{t('learning.fileHint')}</p>
    </div>
  );
}

export default function LearningPage() {
  const { t, i18n } = useTranslation();
  const { can, session } = useAuth();
  const staff = can('learning.manage.scoped') || can('learning.manage.all') || can('learning.read.all');
  const guardian = session?.user.roles.includes('guardian') && !staff;
  const [kind, setKind] = useState('');
  const [pair, setPair] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const teaching = useResource<Teaching>(can('learning.manage.scoped') ? '/me/teaching' : null);
  const pairs = useMemo(
    () =>
      (teaching.data?.assignments ?? [])
        .filter((a) => a.class.isCurrentYear)
        .map((a) => ({ value: `${a.class.id}:${a.subject.id}`, label: `${a.class.gradeName} / ${a.class.name} · ${a.subject.name}` })),
    [teaching.data],
  );
  const children = useResource<{ items: Array<{ id: number; fullName: string }> }>(guardian ? '/me/children' : null);
  const [childId, setChildId] = useState('');
  useEffect(() => {
    if (guardian && !childId && children.data?.items.length) setChildId(String(children.data.items[0]!.id));
  }, [guardian, childId, children.data]);
  const [classSectionId, subjectId] = pair ? pair.split(':') : ['', ''];
  const list = useResource<Paginated<Item>>(
    `/learning-items${query({ kind, classSectionId, subjectId, studentId: guardian ? childId : '', page, pageSize: 20 })}`,
  );

  return (
    <>
      <PageHeader
        crumbs={[{ label: t('nav.dashboard'), to: '/' }, { label: t('learning.title') }]}
        title={t('learning.title')}
        description={staff ? t('learning.introStaff') : t('learning.intro')}
        actions={
          (can('learning.manage.scoped') || can('learning.manage.all')) && (
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              {t('learning.new')}
            </Button>
          )
        }
      />
      <div className="space-y-4">
        <div className="flex flex-wrap gap-3">
          {guardian && (children.data?.items.length ?? 0) > 1 && (
            <Select aria-label={t('portal.child')} className="w-full sm:w-52" value={childId} onChange={(e) => setChildId(e.target.value)}>
              {children.data!.items.map((ch) => (
                <option key={ch.id} value={ch.id}>
                  {ch.fullName}
                </option>
              ))}
            </Select>
          )}
          {pairs.length > 0 && (
            <Select
              aria-label={t('learning.classSubject')}
              className="w-full sm:w-72"
              value={pair}
              onChange={(e) => (setPair(e.target.value), setPage(1))}
            >
              <option value="">{t('learning.allMyClasses')}</option>
              {pairs.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
          )}
          <Select
            aria-label={t('learning.kind')}
            className="w-full sm:w-44"
            value={kind}
            onChange={(e) => (setKind(e.target.value), setPage(1))}
          >
            <option value="">{t('learning.allKinds')}</option>
            <option value="resource">{t('learning.kinds.resource')}</option>
            <option value="assignment">{t('learning.kinds.assignment')}</option>
          </Select>
        </div>
        {list.error && <Alert>{t(list.error.message)}</Alert>}
        {!list.data ? (
          <Loading />
        ) : list.data.items.length === 0 ? (
          <EmptyState icon={<BookOpen className="size-5" />} title={t('learning.empty')} />
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {list.data.items.map((it) => {
              const overdue = it.dueAt && new Date(it.dueAt) < new Date() && !it.mySubmission;
              return (
                <li key={it.id}>
                  <button
                    type="button"
                    className="flex w-full flex-wrap items-start justify-between gap-2 px-4 py-3 text-left hover:bg-subtle"
                    onClick={() => setOpenId(it.id)}
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 font-medium">
                        {it.kind === 'assignment' ? (
                          <ClipboardList className="size-4 text-brand-600" />
                        ) : (
                          <BookOpen className="size-4 text-fg-muted" />
                        )}
                        {it.title}
                      </span>
                      <span className="mt-0.5 block text-[0.8125rem] text-fg-muted">
                        {it.subject.name} · {it.classSection.gradeName} / {it.classSection.name}
                        {it.dueAt && ` · ${t('learning.due', { when: formatDateTime(it.dueAt, i18n.language) })}`}
                      </span>
                    </span>
                    <span className="flex flex-wrap gap-1.5">
                      {!it.publishedAt && <Badge tone="warn">{t('learning.draft')}</Badge>}
                      {it.mySubmission && (
                        <Badge tone={it.mySubmission.status === 'returned' ? 'ok' : 'brand'} dot>
                          {t(`learning.subStatus.${it.mySubmission.status}`)}
                          {it.mySubmission.score !== null && ` · ${it.mySubmission.score}`}
                        </Badge>
                      )}
                      {overdue && !staff && <Badge tone="danger">{t('learning.overdue')}</Badge>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {list.data && list.data.total > list.data.pageSize && (
          <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
        )}
      </div>
      {creating && (
        <Editor
          pairs={pairs}
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            list.reload();
          }}
        />
      )}
      {openId !== null && <ItemDrawer id={openId} onClose={() => setOpenId(null)} onChanged={list.reload} />}
    </>
  );
}

function Editor({
  pairs,
  item,
  onClose,
  onDone,
}: {
  pairs: Array<{ value: string; label: string }>;
  item?: ItemDetail;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [kind, setKind] = useState<'resource' | 'assignment'>(item?.kind ?? 'resource');
  const [pair, setPair] = useState(item ? `${item.classSection.id}:${item.subject.id}` : (pairs[0]?.value ?? ''));
  const [title, setTitle] = useState(item?.title ?? '');
  const [instructions, setInstructions] = useState(item?.instructions ?? '');
  const [dueAt, setDueAt] = useState(item?.dueAt ? toLocalInput(item.dueAt) : '');
  const [allowLate, setAllowLate] = useState(item?.allowLate ?? true);
  const [maxScore, setMaxScore] = useState(item?.maxScore !== null && item?.maxScore !== undefined ? String(item.maxScore) : '');
  const [files, setFiles] = useState<FileRef[]>(item?.files ?? []);
  const submit = useSubmit();

  async function save(publish: boolean) {
    const [classSectionId, subjectId] = pair.split(':').map(Number);
    const common = {
      title,
      instructions: instructions.trim() || null,
      dueAt: kind === 'assignment' && dueAt ? new Date(dueAt).toISOString() : null,
      allowLate,
      maxScore: kind === 'assignment' && maxScore ? Number(maxScore) : null,
      fileIds: files.map((f) => f.id),
    };
    const ok = await submit.run(async () => {
      if (item) {
        await api(`/learning-items/${item.id}`, { method: 'PUT', body: common });
        if (publish && !item.publishedAt) await api(`/learning-items/${item.id}/publish`, { method: 'POST' });
      } else {
        await api('/learning-items', { method: 'POST', body: { ...common, kind, classSectionId, subjectId, publish } });
      }
      return true;
    });
    if (ok) {
      toast.success(publish ? t('learning.publishedMsg') : t('common.saved'));
      onDone();
    }
  }

  return (
    <Drawer
      open
      wide
      title={item ? t('learning.edit') : t('learning.new')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          {(!item || !item.publishedAt) && (
            <Button busy={submit.busy} disabled={!title.trim() || !pair} onClick={() => void save(false)}>
              {t('announcements.saveDraft')}
            </Button>
          )}
          <Button
            variant="primary"
            icon={<Send className="size-4" />}
            busy={submit.busy}
            disabled={!title.trim() || !pair}
            onClick={() => void save(true)}
          >
            {item?.publishedAt ? t('common.saveChanges') : t('announcements.publish')}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {submit.error && <Alert>{submit.error}</Alert>}
        {pairs.length === 0 && !item && <Alert tone="info">{t('learning.noAssignments')}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('learning.kind')}>
            {(id) => (
              <Select id={id} value={kind} disabled={!!item} onChange={(e) => setKind(e.target.value as 'resource' | 'assignment')}>
                <option value="resource">{t('learning.kinds.resource')}</option>
                <option value="assignment">{t('learning.kinds.assignment')}</option>
              </Select>
            )}
          </Field>
          <Field label={t('learning.classSubject')}>
            {(id) =>
              item ? (
                <Input id={id} disabled value={`${item.classSection.gradeName} / ${item.classSection.name} · ${item.subject.name}`} />
              ) : (
                <Select id={id} value={pair} onChange={(e) => setPair(e.target.value)}>
                  {pairs.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              )
            }
          </Field>
        </div>
        <Field label={t('announcements.titleField')} error={submit.fieldErrors.title}>
          {(id) => <Input id={id} maxLength={191} value={title} onChange={(e) => setTitle(e.target.value)} />}
        </Field>
        <Field label={t('learning.instructions')} optional={t('common.optional')}>
          {(id) => (
            <textarea
              id={id}
              rows={5}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              className="block w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm focus:border-brand-500 focus:ring-3 focus:ring-brand-100 focus:outline-none"
            />
          )}
        </Field>
        {kind === 'assignment' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('learning.dueAt')} optional={t('common.optional')} error={submit.fieldErrors.dueAt}>
              {(id) => <Input id={id} type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />}
            </Field>
            <Field label={t('learning.maxScore')} optional={t('common.optional')} error={submit.fieldErrors.maxScore}>
              {(id) => (
                <Input
                  id={id}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.5"
                  value={maxScore}
                  onChange={(e) => setMaxScore(e.target.value)}
                />
              )}
            </Field>
            <div className="sm:col-span-2">
              <Checkbox
                label={t('learning.allowLate')}
                description={t('learning.allowLateHint')}
                checked={allowLate}
                onChange={(e) => setAllowLate(e.target.checked)}
              />
            </div>
          </div>
        )}
        <FilePicker files={files} setFiles={setFiles} max={10} />
      </div>
    </Drawer>
  );
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function ItemDrawer({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { t, i18n } = useTranslation();
  const { session } = useAuth();
  const toast = useToast();
  const res = useResource<ItemDetail>(`/learning-items/${id}`);
  const [editing, setEditing] = useState(false);
  const act = useSubmit();
  const it = res.data;
  const isStudent = session?.user.roles.includes('student');
  const remove = async () => {
    const ok = await act.run(async () => (await api(`/learning-items/${id}`, { method: 'DELETE' })) ?? true);
    if (ok) {
      toast.success(t('crud.deleted', { noun: t('learning.item') }));
      onChanged();
      onClose();
    }
  };
  return (
    <Drawer
      open
      wide
      title={it?.title ?? t('common.loading')}
      description={it ? `${it.subject.name} · ${it.classSection.gradeName} / ${it.classSection.name}` : undefined}
      onClose={onClose}
      footer={
        <>
          {it?.canManage && (
            <>
              <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => void remove()}>
                {t('crud.delete')}
              </Button>
              <Button onClick={() => setEditing(true)}>{t('crud.edit')}</Button>
            </>
          )}
          <Button onClick={onClose}>{t('common.close')}</Button>
        </>
      }
    >
      {res.error ? (
        <Alert>{t(res.error.message)}</Alert>
      ) : !it ? (
        <Loading />
      ) : (
        <div className="space-y-5">
          {act.error && <Alert>{act.error}</Alert>}
          <p className="flex flex-wrap gap-2 text-[0.8125rem] text-fg-muted">
            <Badge>{t(`learning.kinds.${it.kind}`)}</Badge>
            {!it.publishedAt && <Badge tone="warn">{t('learning.draft')}</Badge>}
            {it.dueAt && <span>{t('learning.due', { when: formatDateTime(it.dueAt, i18n.language) })}</span>}
            {it.maxScore !== null && <span>· {t('learning.outOf', { max: it.maxScore })}</span>}
            {it.dueAt && !it.allowLate && <span>· {t('learning.noLate')}</span>}
          </p>
          {it.instructions && <p className="text-sm whitespace-pre-line">{it.instructions}</p>}
          <FileList files={it.files} />
          {it.kind === 'assignment' && isStudent && <SubmitPanel item={it} onChanged={() => (res.reload(), onChanged())} />}
          {it.kind === 'assignment' && it.canManage && <SubmissionsPanel item={it} />}
        </div>
      )}
      {editing && it && (
        <Editor
          pairs={[]}
          item={it}
          onClose={() => setEditing(false)}
          onDone={() => {
            setEditing(false);
            res.reload();
            onChanged();
          }}
        />
      )}
    </Drawer>
  );
}

function SubmitPanel({ item, onChanged }: { item: ItemDetail; onChanged: () => void }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const sub = item.mySubmission;
  const [text, setText] = useState(sub?.textAnswer ?? '');
  const [files, setFiles] = useState<FileRef[]>([]);
  const submit = useSubmit();
  const closed = item.dueAt !== null && !item.allowLate && new Date(item.dueAt) < new Date();
  async function send() {
    const ok = await submit.run(() =>
      api(`/learning-items/${item.id}/submission`, {
        method: 'POST',
        body: { textAnswer: text.trim() || null, fileIds: files.map((f) => f.id) },
      }),
    );
    if (ok) {
      toast.success(t('learning.submitted'));
      setFiles([]);
      onChanged();
    }
  }
  return (
    <section className="space-y-3 rounded-lg border border-line p-4">
      <h3 className="text-sm font-semibold">{t('learning.yourWork')}</h3>
      {sub && (
        <div className="space-y-2 text-sm">
          <p className="text-fg-muted">
            {t('learning.submittedAt', { when: formatDateTime(sub.submittedAt, i18n.language) })}
            {sub.isLate && (
              <span className="ml-2">
                <Badge tone="warn">{t('learning.late')}</Badge>
              </span>
            )}
          </p>
          <FileList files={sub.files} />
          {sub.status === 'returned' && (
            <Alert
              tone="success"
              title={sub.score !== null ? t('learning.scored', { score: sub.score, max: item.maxScore }) : t('learning.returned')}
            >
              {sub.feedback}
            </Alert>
          )}
        </div>
      )}
      {sub?.status !== 'returned' &&
        (closed ? (
          <Alert tone="info">{t('learning.closed')}</Alert>
        ) : (
          <>
            {submit.error && <Alert>{submit.error}</Alert>}
            <Field label={t('learning.answer')} optional={t('common.optional')}>
              {(id) => (
                <textarea
                  id={id}
                  rows={5}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  className="block w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm focus:border-brand-500 focus:ring-3 focus:ring-brand-100 focus:outline-none"
                />
              )}
            </Field>
            <FilePicker files={files} setFiles={setFiles} max={5} />
            {sub && <p className="text-xs text-fg-faint">{t('learning.resubmitNote')}</p>}
            <Button
              variant="primary"
              icon={<Upload className="size-4" />}
              busy={submit.busy}
              disabled={!text.trim() && files.length === 0}
              onClick={() => void send()}
            >
              {sub ? t('learning.resubmit') : t('learning.submit')}
            </Button>
          </>
        ))}
    </section>
  );
}

interface SubRow {
  student: { id: number; fullName: string; admissionNo: string };
  submission: Submission | null;
}

function SubmissionsPanel({ item }: { item: ItemDetail }) {
  const { t, i18n } = useTranslation();
  const list = useResource<{ items: SubRow[] }>(`/learning-items/${item.id}/submissions`);
  const [open, setOpen] = useState<number | null>(null);
  const rows = list.data?.items ?? [];
  const done = rows.filter((r) => r.submission).length;
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">{t('learning.submissions', { done, total: rows.length })}</h3>
      {list.error && <Alert>{t(list.error.message)}</Alert>}
      <ul className="divide-y divide-line rounded-lg border border-line">
        {rows.map((r) => (
          <li key={r.student.id} className="px-3.5 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{r.student.fullName}</span>
              {r.submission ? (
                <button
                  type="button"
                  className="flex items-center gap-1.5 text-[0.8125rem]"
                  onClick={() => setOpen(open === r.submission!.id ? null : r.submission!.id)}
                >
                  {r.submission.isLate && <Badge tone="warn">{t('learning.late')}</Badge>}
                  <Badge tone={r.submission.status === 'returned' ? 'ok' : 'brand'} dot>
                    {t(`learning.subStatus.${r.submission.status}`)}
                    {r.submission.score !== null && ` · ${r.submission.score}`}
                  </Badge>
                </button>
              ) : (
                <span className="text-[0.8125rem] text-fg-faint">{t('learning.notSubmitted')}</span>
              )}
            </div>
            {r.submission && open === r.submission.id && (
              <div className="mt-2 space-y-2">
                <p className="text-xs text-fg-faint">
                  {t('learning.submittedAt', { when: formatDateTime(r.submission.submittedAt, i18n.language) })}
                </p>
                {r.submission.textAnswer && (
                  <p className="rounded-md bg-subtle p-3 text-sm whitespace-pre-line">{r.submission.textAnswer}</p>
                )}
                <FileList files={r.submission.files} />
                <ReturnForm submission={r.submission} maxScore={item.maxScore} onDone={list.reload} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ReturnForm({ submission, maxScore, onDone }: { submission: Submission; maxScore: number | null; onDone: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [feedback, setFeedback] = useState(submission.feedback ?? '');
  const [score, setScore] = useState(submission.score !== null ? String(submission.score) : '');
  const submit = useSubmit();
  async function send() {
    const ok = await submit.run(
      async () =>
        (await api(`/submissions/${submission.id}/return`, {
          method: 'POST',
          body: { feedback: feedback.trim() || null, score: score ? Number(score) : null },
        })) ?? true,
    );
    if (ok) {
      toast.success(t('learning.returnedMsg'));
      onDone();
    }
  }
  return (
    <div className="space-y-2 rounded-md border border-line p-3">
      {submit.error && <Alert>{submit.error}</Alert>}
      <Field label={t('learning.feedback')}>
        {(id) => <Input id={id} value={feedback} maxLength={5000} onChange={(e) => setFeedback(e.target.value)} />}
      </Field>
      {maxScore !== null && (
        <Field label={t('learning.scoreOutOf', { max: maxScore })} error={submit.fieldErrors.score}>
          {(id) => (
            <Input
              id={id}
              type="number"
              inputMode="decimal"
              min={0}
              max={maxScore}
              step="0.5"
              value={score}
              onChange={(e) => setScore(e.target.value)}
            />
          )}
        </Field>
      )}
      <Button size="sm" variant="primary" busy={submit.busy} onClick={() => void send()}>
        {submission.status === 'returned' ? t('learning.updateReturn') : t('learning.return')}
      </Button>
    </div>
  );
}
