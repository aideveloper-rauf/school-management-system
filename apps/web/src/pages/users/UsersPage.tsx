import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Ban, KeyRound, MailPlus, Pencil, RotateCcw, Search, UserPlus, Users } from 'lucide-react';
import { ROLES, USER_STATUSES, type Paginated, type UserItem } from '@sms/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { query, useResource } from '../../lib/data';
import { formatDateTime, formatRelative, statusTone } from '../../lib/format';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  Input,
  PageHeader,
  Pagination,
  Select,
  useToast,
  type Column,
  type MenuItem,
} from '../../components/ui';
import { CreateUserDialog } from './CreateUserDialog';
import { UserDialog, type UserTab } from './UserDialog';

export function RoleBadges({ roles }: { roles: UserItem['roles'] }) {
  const { t } = useTranslation();
  if (roles.length === 0) return <span className="text-fg-faint">{t('users.noRoles')}</span>;
  const shown = roles.slice(0, 2);
  return (
    <span className="flex flex-wrap gap-1">
      {shown.map((r) => (
        <Badge key={r} tone={r === 'school_admin' ? 'brand' : 'neutral'}>
          {t(`roles.${r}`)}
        </Badge>
      ))}
      {roles.length > shown.length && (
        <Badge tone="neutral">
          <span
            title={roles
              .slice(2)
              .map((r) => t(`roles.${r}`))
              .join(', ')}
          >
            +{roles.length - shown.length}
          </span>
        </Badge>
      )}
    </span>
  );
}

export default function UsersPage() {
  const { t, i18n } = useTranslation();
  const { can, session } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [creating, setCreating] = useState(params.get('new') === '1');
  const [open, setOpen] = useState<{ id: number; tab: UserTab } | null>(null);
  const [disabling, setDisabling] = useState<UserItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  // "Add user" quick action from the dashboard arrives as ?new=1.
  useEffect(() => {
    if (params.get('new') === '1') {
      setCreating(true);
      setParams({}, { replace: true });
    }
  }, [params, setParams]);

  // Search as you type, without a request per keystroke.
  useEffect(() => {
    const h = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(h);
  }, [search]);

  const list = useResource<Paginated<UserItem>>(`/users${query({ q, role, status, page, pageSize })}`);
  const filtered = !!(q || role || status);
  const canManage = can('users.manage');

  const act = async (u: UserItem, path: 'enable' | 'invitation', message: string) => {
    try {
      await api(`/users/${u.id}/${path}`, { method: 'POST' });
      toast.success(message);
      list.reload();
    } catch (e) {
      toast.error(t((e as Error).message));
    }
  };

  const rowActions = (u: UserItem): MenuItem[] => {
    const self = u.id === session?.user.id;
    const items: MenuItem[] = [
      { label: t('users.openDetails'), icon: <Pencil className="size-4" />, onSelect: () => setOpen({ id: u.id, tab: 'details' }) },
    ];
    if (!canManage || self) return items;
    if (u.status === 'invited')
      items.push({
        label: t('users.resendInvitation'),
        icon: <MailPlus className="size-4" />,
        onSelect: () => void act(u, 'invitation', t('users.invitationResent')),
      });
    if (u.status !== 'disabled')
      items.push({
        label: t('users.setTemporaryPassword'),
        icon: <KeyRound className="size-4" />,
        onSelect: () => setOpen({ id: u.id, tab: 'security' }),
      });
    items.push(
      u.status === 'disabled'
        ? {
            label: t('users.enable'),
            icon: <RotateCcw className="size-4" />,
            onSelect: () => void act(u, 'enable', t('users.enabledNamed', { name: u.displayName })),
          }
        : { label: t('users.disable'), icon: <Ban className="size-4" />, danger: true, onSelect: () => setDisabling(u) },
    );
    return items;
  };

  const columns: Column<UserItem>[] = [
    {
      key: 'user',
      header: t('users.person'),
      cell: (u) => (
        <span className="flex items-center gap-3">
          <Avatar name={u.displayName} />
          <span className="min-w-0">
            <span className="block truncate font-medium text-fg">
              {u.displayName}
              {u.id === session?.user.id && <span className="ml-1.5 text-xs font-normal text-fg-faint">({t('users.you')})</span>}
            </span>
            <span className="block truncate text-[0.8125rem] text-fg-muted">{u.identifier}</span>
          </span>
        </span>
      ),
    },
    { key: 'roles', header: t('users.roles'), cell: (u) => <RoleBadges roles={u.roles} /> },
    {
      key: 'status',
      header: t('users.status'),
      cell: (u) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <Badge tone={statusTone(u.status)} dot>
            {t(`users.statuses.${u.status}`)}
          </Badge>
          {u.mustChangePassword && <Badge tone="neutral">{t('users.temporaryPasswordShort')}</Badge>}
        </span>
      ),
    },
    {
      key: 'last',
      header: t('users.lastSignIn'),
      hideBelow: 'lg',
      cell: (u) => (
        <span className="text-fg-muted" title={formatDateTime(u.lastLoginAt, i18n.language)}>
          {u.lastLoginAt ? formatRelative(u.lastLoginAt, i18n.language) : t('users.never')}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        crumbs={[{ label: t('nav.dashboard'), to: '/' }, { label: t('users.title') }]}
        title={t('users.title')}
        description={t('users.intro')}
        actions={
          canManage && (
            <Button variant="primary" icon={<UserPlus className="size-4" />} onClick={() => setCreating(true)}>
              {t('users.add')}
            </Button>
          )
        }
      />

      {list.error && (
        <div className="mb-4">
          <Alert>{t(list.error.message)}</Alert>
        </div>
      )}

      <DataTable<UserItem>
        label={t('users.title')}
        columns={columns}
        rows={list.data?.items ?? null}
        loading={list.loading}
        onRowClick={(u) => setOpen({ id: u.id, tab: 'details' })}
        rowActions={rowActions}
        toolbar={
          <>
            <div className="min-w-[12rem] flex-1">
              <Input
                type="search"
                aria-label={t('users.search')}
                placeholder={t('users.searchPlaceholder')}
                leading={<Search className="size-4" />}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select
              aria-label={t('users.role')}
              className="w-full sm:w-44"
              value={role}
              onChange={(e) => {
                setRole(e.target.value);
                setPage(1);
              }}
            >
              <option value="">{t('users.anyRole')}</option>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`roles.${r}`)}
                </option>
              ))}
            </Select>
            <Select
              aria-label={t('users.status')}
              className="w-full sm:w-40"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">{t('users.anyStatus')}</option>
              {USER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`users.statuses.${s}`)}
                </option>
              ))}
            </Select>
            {filtered && (
              <Button
                variant="ghost"
                onClick={() => {
                  setSearch('');
                  setRole('');
                  setStatus('');
                  setPage(1);
                }}
              >
                {t('table.clearFilters')}
              </Button>
            )}
          </>
        }
        empty={
          <EmptyState
            icon={filtered ? <Search className="size-5" /> : <Users className="size-5" />}
            title={filtered ? t('users.noMatches') : t('users.empty')}
            description={filtered ? t('table.tryOtherFilters') : t('users.emptyHelp')}
            action={
              canManage && !filtered ? (
                <Button variant="primary" icon={<UserPlus className="size-4" />} onClick={() => setCreating(true)}>
                  {t('users.add')}
                </Button>
              ) : undefined
            }
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

      <CreateUserDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(u, invited) => {
          setCreating(false);
          toast.success(invited ? t('users.invitedNotice', { name: u.displayName }) : t('users.createdNotice', { name: u.displayName }));
          list.reload();
        }}
      />
      <UserDialog
        userId={open?.id ?? null}
        initialTab={open?.tab ?? 'details'}
        onClose={() => setOpen(null)}
        onChanged={() => list.reload()}
      />
      <ConfirmDialog
        open={disabling !== null}
        title={t('users.disableTitle', { name: disabling?.displayName ?? '' })}
        body={t('users.disableHelp')}
        confirmLabel={t('users.disable')}
        busy={busy}
        error={confirmError}
        onClose={() => {
          setDisabling(null);
          setConfirmError(null);
        }}
        onConfirm={async () => {
          if (!disabling) return;
          setBusy(true);
          setConfirmError(null);
          try {
            await api(`/users/${disabling.id}/disable`, { method: 'POST' });
            toast.success(t('users.disabledNamed', { name: disabling.displayName }));
            setDisabling(null);
            list.reload();
          } catch (e) {
            setConfirmError(t((e as Error).message));
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}
