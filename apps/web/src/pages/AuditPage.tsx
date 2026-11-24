import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, History, ScrollText, Search, UserRound } from 'lucide-react';
import { AUDIT_CATEGORIES, AUDIT_CATEGORY_KEYS, isRole, type AuditCategory, type AuditEventItem, type Paginated } from '@sms/shared';
import { query, useResource } from '../lib/data';
import { formatDateTime, formatRelative } from '../lib/format';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  DataTable,
  DescriptionList,
  Drawer,
  EmptyState,
  Input,
  PageHeader,
  Pagination,
  Select,
  type Column,
  type Tone,
} from '../components/ui';

const CATEGORY_TONE: Record<AuditCategory, Tone> = {
  signIn: 'neutral',
  people: 'brand',
  records: 'brand',
  attendance: 'ok',
  academic: 'ok',
  settings: 'warn',
  backups: 'neutral',
};

function categoryOf(action: string): AuditCategory | null {
  return AUDIT_CATEGORY_KEYS.find((c) => AUDIT_CATEGORIES[c].some((p) => action.startsWith(p))) ?? null;
}

/** Translated label for an action ("grade.created" → "Grade added"); falls back to the raw code. */
function useActionLabel() {
  const { t, i18n } = useTranslation();
  return (action: string) => {
    const key = `audit.actions.${action.replace(/\./g, '_')}`;
    return i18n.exists(key) ? t(key) : action;
  };
}

/** "User #12" for numeric ids, "Backup: sms-backup-….smsbak" otherwise. */
const recordLabel = (type: string, id: string | null) => (id ? (/^\d+$/.test(id) ? `${type} #${id}` : `${type}: ${id}`) : type);

/** Local calendar day → ISO bounds, so "today" means today where the user is. */
const dayStart = (d: string) => new Date(`${d}T00:00:00`).toISOString();
const nextDayStart = (d: string) => {
  const x = new Date(`${d}T00:00:00`);
  x.setDate(x.getDate() + 1);
  return x.toISOString();
};

interface Filters {
  q: string;
  category: '' | AuditCategory;
  from: string;
  to: string;
  actorUserId?: number;
  actorName?: string;
  entityType?: string;
  entityId?: string;
}
const EMPTY: Filters = { q: '', category: '', from: '', to: '' };

export default function AuditPage() {
  const { t, i18n } = useTranslation();
  const label = useActionLabel();
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [open, setOpen] = useState<AuditEventItem | null>(null);

  useEffect(() => {
    const h = setTimeout(() => {
      setFilters((f) => ({ ...f, q: search.trim() }));
      setPage(1);
    }, 300);
    return () => clearTimeout(h);
  }, [search]);

  const update = (patch: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  };
  const url = `/audit-events${query({
    q: filters.q,
    category: filters.category,
    from: filters.from ? dayStart(filters.from) : '',
    to: filters.to ? nextDayStart(filters.to) : '',
    actorUserId: filters.actorUserId,
    entityType: filters.entityType,
    entityId: filters.entityId,
    page,
    pageSize,
  })}`;
  const list = useResource<Paginated<AuditEventItem>>(url);
  const filtered = JSON.stringify({ ...filters, q: search.trim() }) !== JSON.stringify(EMPTY);
  const entityLabel = (type: string | null) => (type ? (i18n.exists(`audit.entities.${type}`) ? t(`audit.entities.${type}`) : type) : '—');

  const columns: Column<AuditEventItem>[] = [
    {
      key: 'action',
      header: t('audit.action'),
      cell: (e) => {
        const cat = categoryOf(e.action);
        return (
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-fg">{label(e.action)}</span>
            {cat && <Badge tone={CATEGORY_TONE[cat]}>{t(`audit.categories.${cat}`)}</Badge>}
          </span>
        );
      },
    },
    {
      key: 'who',
      header: t('audit.person'),
      cell: (e) =>
        e.actor ? (
          <span className="flex items-center gap-2">
            <Avatar name={e.actor.displayName} size="sm" />
            <span className="min-w-0 truncate">{e.actor.displayName}</span>
          </span>
        ) : (
          <span className="flex items-center gap-2 text-fg-muted">
            <span className="flex size-7 items-center justify-center rounded-full bg-subtle">
              <Bot aria-hidden className="size-3.5" />
            </span>
            {e.action === 'auth.login.failed' ? t('audit.unknownPerson') : t('audit.system')}
          </span>
        ),
    },
    {
      key: 'record',
      header: t('audit.record'),
      hideBelow: 'lg',
      cell: (e) => (e.entityType ? <span className="text-fg-muted">{recordLabel(entityLabel(e.entityType), e.entityId)}</span> : '—'),
    },
    {
      key: 'when',
      header: t('audit.when'),
      cell: (e) => (
        <span className="tabular whitespace-nowrap text-fg-muted" title={formatDateTime(e.createdAt, i18n.language)}>
          {formatRelative(e.createdAt, i18n.language)}
        </span>
      ),
    },
  ];

  // Chips for filters set from the details drawer (person / record).
  const chips: Array<{ label: string; clear: () => void }> = [];
  if (filters.actorUserId)
    chips.push({
      label: t('audit.chipPerson', { name: filters.actorName ?? `#${filters.actorUserId}` }),
      clear: () => update({ actorUserId: undefined, actorName: undefined }),
    });
  if (filters.entityType)
    chips.push({
      label: t('audit.chipRecord', { record: recordLabel(entityLabel(filters.entityType), filters.entityId ?? null) }),
      clear: () => update({ entityType: undefined, entityId: undefined }),
    });

  return (
    <>
      <PageHeader
        crumbs={[{ label: t('nav.dashboard'), to: '/' }, { label: t('audit.title') }]}
        title={t('audit.title')}
        description={t('audit.intro')}
      />
      {list.error && (
        <div className="mb-4">
          <Alert>{t(list.error.message)}</Alert>
        </div>
      )}
      <DataTable<AuditEventItem>
        label={t('audit.title')}
        columns={columns}
        rows={list.data?.items ?? null}
        loading={list.loading}
        onRowClick={setOpen}
        toolbar={
          <>
            <div className="min-w-[12rem] flex-1">
              <Input
                type="search"
                aria-label={t('audit.searchPerson')}
                placeholder={t('audit.searchPerson')}
                leading={<Search className="size-4" />}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select
              aria-label={t('audit.category')}
              className="w-full sm:w-44"
              value={filters.category}
              onChange={(e) => update({ category: e.target.value as Filters['category'] })}
            >
              <option value="">{t('audit.allCategories')}</option>
              {AUDIT_CATEGORY_KEYS.map((c) => (
                <option key={c} value={c}>
                  {t(`audit.categories.${c}`)}
                </option>
              ))}
            </Select>
            <label className="flex w-full items-center gap-2 text-[0.8125rem] text-fg-muted sm:w-auto">
              {t('audit.from')}
              <Input
                type="date"
                className="sm:w-38"
                value={filters.from}
                max={filters.to || undefined}
                onChange={(e) => update({ from: e.target.value })}
              />
            </label>
            <label className="flex w-full items-center gap-2 text-[0.8125rem] text-fg-muted sm:w-auto">
              {t('audit.to')}
              <Input
                type="date"
                className="sm:w-38"
                value={filters.to}
                min={filters.from || undefined}
                onChange={(e) => update({ to: e.target.value })}
              />
            </label>
            {filtered && (
              <Button
                variant="ghost"
                onClick={() => {
                  setSearch('');
                  setFilters(EMPTY);
                  setPage(1);
                }}
              >
                {t('table.clearFilters')}
              </Button>
            )}
            {chips.length > 0 && (
              <div className="flex w-full flex-wrap gap-2">
                {chips.map((c) => (
                  <button
                    key={c.label}
                    type="button"
                    onClick={c.clear}
                    className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700 ring-1 ring-brand-200 hover:bg-brand-100"
                    aria-label={t('audit.removeFilter', { filter: c.label })}
                  >
                    {c.label}
                    <span aria-hidden>×</span>
                  </button>
                ))}
              </div>
            )}
          </>
        }
        empty={
          <EmptyState
            icon={filtered ? <Search className="size-5" /> : <ScrollText className="size-5" />}
            title={filtered ? t('audit.noMatches') : t('audit.empty')}
            description={filtered ? t('table.tryOtherFilters') : undefined}
          />
        }
        footer={
          list.data && list.data.total > 0 ? (
            <Pagination
              page={list.data.page}
              pageSize={list.data.pageSize}
              total={list.data.total}
              onPage={setPage}
              onPageSize={(n) => {
                setPageSize(n);
                setPage(1);
              }}
            />
          ) : undefined
        }
      />
      <AuditDrawer
        entry={open}
        onClose={() => setOpen(null)}
        entityLabel={entityLabel}
        onFilterPerson={(e) => {
          if (e.actor) update({ actorUserId: e.actor.id, actorName: e.actor.displayName });
          setOpen(null);
        }}
        onFilterRecord={(e) => {
          update({ entityType: e.entityType ?? undefined, entityId: e.entityId ?? undefined });
          setOpen(null);
        }}
      />
    </>
  );
}

function AuditDrawer({
  entry,
  onClose,
  entityLabel,
  onFilterPerson,
  onFilterRecord,
}: {
  entry: AuditEventItem | null;
  onClose: () => void;
  entityLabel: (t: string | null) => string;
  onFilterPerson: (e: AuditEventItem) => void;
  onFilterRecord: (e: AuditEventItem) => void;
}) {
  const { t, i18n } = useTranslation();
  const label = useActionLabel();
  const details = useMemo(() => Object.entries(entry?.metadata ?? {}), [entry]);

  const renderValue = (key: string, v: unknown): ReactNode => {
    const one = (x: unknown) => {
      if (typeof x === 'string' && (key === 'role' || key === 'roles') && isRole(x)) return t(`roles.${x}`);
      if (typeof x === 'string' && key === 'fields') return i18n.exists(`audit.fieldNames.${x}`) ? t(`audit.fieldNames.${x}`) : x;
      return typeof x === 'object' ? JSON.stringify(x) : String(x);
    };
    if (Array.isArray(v)) return v.length ? v.map(one).join(', ') : t('audit.none');
    if (key === 'bytes' && typeof v === 'number') return `${(v / 1024).toFixed(1)} KB`;
    return one(v);
  };

  return (
    <Drawer
      open={entry !== null}
      title={entry ? label(entry.action) : ''}
      description={entry ? formatDateTime(entry.createdAt, i18n.language) : undefined}
      onClose={onClose}
    >
      {entry && (
        <div className="space-y-6">
          <DescriptionList
            items={[
              {
                label: t('audit.person'),
                value: entry.actor ? (
                  <span>
                    {entry.actor.displayName}
                    <span className="block text-[0.8125rem] text-fg-muted">{entry.actor.identifier}</span>
                  </span>
                ) : entry.action === 'auth.login.failed' ? (
                  t('audit.unknownPerson')
                ) : (
                  t('audit.system')
                ),
              },
              { label: t('audit.action'), value: <code className="rounded bg-subtle px-1.5 py-0.5 text-xs">{entry.action}</code> },
              {
                label: t('audit.record'),
                value: entry.entityType ? recordLabel(entityLabel(entry.entityType), entry.entityId) : '—',
              },
              { label: t('audit.ip'), value: entry.ip ?? '—' },
              { label: t('audit.requestId'), value: entry.requestId ? <code className="text-xs break-all">{entry.requestId}</code> : '—' },
            ]}
          />
          <section>
            <h3 className="mb-2 text-sm font-semibold">{t('audit.details')}</h3>
            {details.length === 0 ? (
              <p className="text-sm text-fg-muted">{t('audit.noDetails')}</p>
            ) : (
              <DescriptionList
                items={details.map(([k, v]) => ({
                  label: i18n.exists(`audit.metaKeys.${k}`) ? t(`audit.metaKeys.${k}`) : k,
                  value: renderValue(k, v),
                }))}
              />
            )}
            <p className="mt-3 text-xs text-fg-muted">{t('audit.detailsNote')}</p>
          </section>
          <div className="flex flex-wrap gap-2">
            {entry.actor && (
              <Button icon={<UserRound className="size-4" />} onClick={() => onFilterPerson(entry)}>
                {t('audit.showPersonActivity')}
              </Button>
            )}
            {entry.entityType && entry.entityId && (
              <Button icon={<History className="size-4" />} onClick={() => onFilterRecord(entry)}>
                {t('audit.showRecordHistory')}
              </Button>
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
}
