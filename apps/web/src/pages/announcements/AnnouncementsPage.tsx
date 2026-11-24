import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Eye, Megaphone, Pencil, Plus, Send, Trash2, Undo2 } from 'lucide-react';
import { ANNOUNCEMENT_AUDIENCES, ROLES, type Paginated } from '@sms/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { query, useResource, useSubmit } from '../../lib/data';
import { sectionLabel, useSections, useYears } from '../../lib/academic';
import { formatDate, formatDateTime } from '../../lib/format';
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
import type { Grade } from '../students/types';

interface Announcement {
  id: number;
  title: string;
  body: string;
  audience: (typeof ANNOUNCEMENT_AUDIENCES)[number];
  audienceRole: string | null;
  audienceGrade: { id: number; name: string } | null;
  audienceClass: { id: number; name: string; gradeName: string } | null;
  publishedAt: string | null;
  expiresOn: string | null;
  withdrawnAt: string | null;
  author: string | null;
  createdAt: string;
  notifyGuardians?: boolean;
  isRead?: boolean;
  reads?: number;
}

function AudienceLabel({ a }: { a: Announcement }) {
  const { t } = useTranslation();
  if (a.audience === 'role') return <>{t('announcements.audienceRole', { role: t(`roles.${a.audienceRole}`) })}</>;
  if (a.audience === 'grade') return <>{a.audienceGrade?.name}</>;
  if (a.audience === 'class') return <>{a.audienceClass && `${a.audienceClass.gradeName} / ${a.audienceClass.name}`}</>;
  if (a.audience === 'guardians_of_class')
    return (
      <>
        {t('announcements.audienceGuardiansOf', { cls: a.audienceClass ? `${a.audienceClass.gradeName} / ${a.audienceClass.name}` : '' })}
      </>
    );
  return <>{t('announcements.audiences.school')}</>;
}

export default function AnnouncementsPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const publisher = can('announcements.publish');
  const tab = publisher && params.get('tab') === 'manage' ? 'manage' : 'feed';
  return (
    <>
      <PageHeader
        crumbs={[{ label: t('nav.dashboard'), to: '/' }, { label: t('announcements.title') }]}
        title={t('announcements.title')}
        description={t('announcements.intro')}
      />
      <div className="space-y-6">
        {publisher && (
          <Tabs
            label={t('announcements.title')}
            value={tab}
            onChange={(k) => setParams(k === 'feed' ? {} : { tab: k }, { replace: true })}
            items={[
              { key: 'feed', label: t('announcements.feed'), icon: <Megaphone className="size-4" /> },
              { key: 'manage', label: t('announcements.manage'), icon: <Pencil className="size-4" /> },
            ]}
          />
        )}
        {tab === 'feed' ? <Feed /> : <Manage />}
      </div>
    </>
  );
}

function Feed() {
  const { t, i18n } = useTranslation();
  const [page, setPage] = useState(1);
  const list = useResource<Paginated<Announcement> & { unread: number }>(`/announcements${query({ page, pageSize: 10 })}`);
  const [read, setRead] = useState<Set<number>>(new Set());
  const markRead = (a: Announcement) => {
    if (a.isRead || read.has(a.id)) return;
    setRead((s) => new Set(s).add(a.id));
    void api(`/announcements/${a.id}/read`, { method: 'POST' }).catch(() => undefined);
  };
  if (list.error) return <Alert>{t(list.error.message)}</Alert>;
  if (!list.data) return <Loading />;
  if (list.data.items.length === 0) return <EmptyState icon={<Megaphone className="size-5" />} title={t('announcements.empty')} />;
  return (
    <div className="space-y-4">
      <ul className="space-y-3">
        {list.data.items.map((a) => {
          const unread = !a.isRead && !read.has(a.id);
          return (
            <li key={a.id}>
              <article
                className={`rounded-lg border bg-surface p-4 ${unread ? 'border-brand-200' : 'border-line'}`}
                onMouseEnter={() => markRead(a)}
                onFocus={() => markRead(a)}
                onClick={() => markRead(a)}
                tabIndex={0}
              >
                <header className="flex flex-wrap items-start justify-between gap-2">
                  <h2 className="text-[0.9375rem] font-semibold">
                    {unread && (
                      <span
                        aria-label={t('announcements.unread')}
                        className="mr-2 inline-block size-2 rounded-full bg-brand-600 align-middle"
                      />
                    )}
                    {a.title}
                  </h2>
                  <Badge>
                    <AudienceLabel a={a} />
                  </Badge>
                </header>
                <p className="mt-2 text-sm whitespace-pre-line">{a.body}</p>
                <p className="mt-3 text-xs text-fg-faint">
                  {[a.author, a.publishedAt && formatDateTime(a.publishedAt, i18n.language)].filter(Boolean).join(' · ')}
                  {a.expiresOn && ` · ${t('announcements.until', { date: formatDate(a.expiresOn, i18n.language) })}`}
                </p>
              </article>
            </li>
          );
        })}
      </ul>
      {list.data.total > list.data.pageSize && (
        <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
      )}
    </div>
  );
}

function Manage() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const [state, setState] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Announcement | 'new' | null>(null);
  const list = useResource<Paginated<Announcement>>(`/announcements/manage${query({ state, page, pageSize: 20 })}`);
  const act = useSubmit();
  const run = async (path: string, method: string, msg: string) => {
    const ok = await act.run(async () => (await api(path, { method })) ?? true);
    if (ok) {
      toast.success(msg);
      list.reload();
    }
  };
  const stateOf = (a: Announcement) => (a.withdrawnAt ? 'withdrawn' : a.publishedAt ? 'published' : 'draft');
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Select
          aria-label={t('announcements.state')}
          className="w-44"
          value={state}
          onChange={(e) => (setState(e.target.value), setPage(1))}
        >
          <option value="">{t('announcements.anyState')}</option>
          {(['draft', 'published', 'withdrawn'] as const).map((s) => (
            <option key={s} value={s}>
              {t(`announcements.states.${s}`)}
            </option>
          ))}
        </Select>
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
          {t('announcements.new')}
        </Button>
      </div>
      {(list.error || act.error) && <Alert>{act.error ?? t(list.error!.message)}</Alert>}
      {!list.data ? (
        <Loading />
      ) : list.data.items.length === 0 ? (
        <EmptyState icon={<Megaphone className="size-5" />} title={t('announcements.noneYet')} />
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {list.data.items.map((a) => {
            const s = stateOf(a);
            return (
              <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0 space-y-1">
                  <p className="font-medium">{a.title}</p>
                  <p className="flex flex-wrap items-center gap-2 text-[0.8125rem] text-fg-muted">
                    <Badge tone={s === 'published' ? 'ok' : s === 'withdrawn' ? 'neutral' : 'warn'} dot>
                      {t(`announcements.states.${s}`)}
                    </Badge>
                    <AudienceLabel a={a} />
                    {a.publishedAt && <span>· {formatDateTime(a.publishedAt, i18n.language)}</span>}
                    {s !== 'draft' && (
                      <span className="inline-flex items-center gap-1">
                        · <Eye className="size-3.5" /> {t('announcements.reads', { count: a.reads ?? 0 })}
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {s === 'draft' && (
                    <>
                      <Button size="sm" icon={<Pencil className="size-4" />} onClick={() => setEditing(a)}>
                        {t('crud.edit')}
                      </Button>
                      <Button
                        size="sm"
                        variant="primary"
                        icon={<Send className="size-4" />}
                        onClick={() => void run(`/announcements/${a.id}/publish`, 'POST', t('announcements.published'))}
                      >
                        {t('announcements.publish')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<Trash2 className="size-4" />}
                        onClick={() => void run(`/announcements/${a.id}`, 'DELETE', t('crud.deleted', { noun: t('announcements.noun') }))}
                      >
                        {t('crud.delete')}
                      </Button>
                    </>
                  )}
                  {s === 'published' && (
                    <Button
                      size="sm"
                      icon={<Undo2 className="size-4" />}
                      onClick={() => void run(`/announcements/${a.id}/withdraw`, 'POST', t('announcements.withdrawn'))}
                    >
                      {t('announcements.withdraw')}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {list.data && list.data.total > list.data.pageSize && (
        <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
      )}
      {editing && (
        <Editor
          item={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDone={(msg) => {
            setEditing(null);
            toast.success(msg);
            list.reload();
          }}
        />
      )}
    </div>
  );
}

function Editor({ item, onClose, onDone }: { item: Announcement | null; onClose: () => void; onDone: (msg: string) => void }) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(item?.title ?? '');
  const [body, setBody] = useState(item?.body ?? '');
  const [audience, setAudience] = useState<string>(item?.audience ?? 'school');
  const [role, setRole] = useState(item?.audienceRole ?? 'teacher');
  const [gradeId, setGradeId] = useState(item?.audienceGrade ? String(item.audienceGrade.id) : '');
  const [classId, setClassId] = useState(item?.audienceClass ? String(item.audienceClass.id) : '');
  const [expiresOn, setExpiresOn] = useState(item?.expiresOn ?? '');
  const [notifyGuardians, setNotifyGuardians] = useState(item?.notifyGuardians ?? false);
  const reachesGuardians = audience !== 'role' || role === 'guardian';
  const grades = useResource<{ items: Grade[] }>(audience === 'grade' ? '/grades' : null);
  const { current } = useYears();
  const { sections } = useSections(audience === 'class' || audience === 'guardians_of_class' ? (current?.id ?? null) : null);
  const submit = useSubmit();
  useEffect(() => {
    if (audience === 'grade' && !gradeId && grades.data?.items.length) setGradeId(String(grades.data.items[0]!.id));
  }, [audience, gradeId, grades.data]);
  useEffect(() => {
    if ((audience === 'class' || audience === 'guardians_of_class') && !classId && sections.length) setClassId(String(sections[0]!.id));
  }, [audience, classId, sections]);

  async function save(publish: boolean) {
    const payload = {
      title,
      body,
      audience,
      audienceRole: audience === 'role' ? role : null,
      audienceGradeId: audience === 'grade' && gradeId ? Number(gradeId) : null,
      audienceClassSectionId: (audience === 'class' || audience === 'guardians_of_class') && classId ? Number(classId) : null,
      expiresOn: expiresOn || null,
      notifyGuardians: reachesGuardians && notifyGuardians,
    };
    const ok = await submit.run(async () => {
      if (item) {
        await api(`/announcements/${item.id}`, { method: 'PUT', body: payload });
        if (publish) await api(`/announcements/${item.id}/publish`, { method: 'POST' });
      } else {
        await api('/announcements', { method: 'POST', body: { ...payload, publish } });
      }
      return true;
    });
    if (ok) onDone(publish ? t('announcements.published') : t('announcements.draftSaved'));
  }

  return (
    <Drawer
      open
      wide
      title={item ? t('announcements.editTitle') : t('announcements.new')}
      description={t('announcements.editorHelp')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button busy={submit.busy} disabled={!title.trim() || !body.trim()} onClick={() => void save(false)}>
            {t('announcements.saveDraft')}
          </Button>
          <Button
            variant="primary"
            icon={<Send className="size-4" />}
            busy={submit.busy}
            disabled={!title.trim() || !body.trim()}
            onClick={() => void save(true)}
          >
            {t('announcements.publish')}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {submit.error && <Alert>{submit.error}</Alert>}
        <Field label={t('announcements.titleField')} error={submit.fieldErrors.title}>
          {(id) => <Input id={id} maxLength={191} value={title} onChange={(e) => setTitle(e.target.value)} />}
        </Field>
        <Field label={t('announcements.body')} error={submit.fieldErrors.body}>
          {(id) => (
            <textarea
              id={id}
              rows={7}
              maxLength={10000}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="block w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-fg focus:border-brand-500 focus:ring-3 focus:ring-brand-100 focus:outline-none"
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('announcements.audience')}>
            {(id) => (
              <Select id={id} value={audience} onChange={(e) => setAudience(e.target.value)}>
                {ANNOUNCEMENT_AUDIENCES.map((a) => (
                  <option key={a} value={a}>
                    {t(`announcements.audiences.${a}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {audience === 'role' && (
            <Field label={t('announcements.role')}>
              {(id) => (
                <Select id={id} value={role} onChange={(e) => setRole(e.target.value)}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {t(`roles.${r}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          {audience === 'grade' && (
            <Field label={t('announcements.grade')} error={submit.fieldErrors.audienceGradeId}>
              {(id) => (
                <Select id={id} value={gradeId} onChange={(e) => setGradeId(e.target.value)}>
                  {(grades.data?.items ?? []).map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          {(audience === 'class' || audience === 'guardians_of_class') && (
            <Field label={t('students.class')} error={submit.fieldErrors.audienceClassSectionId}>
              {(id) => (
                <Select id={id} value={classId} onChange={(e) => setClassId(e.target.value)}>
                  {sections.map((s) => (
                    <option key={s.id} value={s.id}>
                      {sectionLabel(s)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          <Field label={t('announcements.expiresOn')} hint={t('announcements.expiresHint')} optional={t('common.optional')}>
            {(id) => <Input id={id} type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />}
          </Field>
        </div>
        <p className="text-[0.8125rem] text-fg-muted">{t(`announcements.audienceHelp.${audience}`)}</p>
        {reachesGuardians && (
          <Checkbox
            label={t('announcements.notifyGuardians')}
            description={t('announcements.notifyGuardiansHelp')}
            checked={notifyGuardians}
            onChange={(e) => setNotifyGuardians(e.target.checked)}
          />
        )}
      </div>
    </Drawer>
  );
}
