import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ROLES, USER_STATUSES, type Paginated, type UserItem } from '@sms/shared';
import { useAuth } from '../../lib/auth';
import { query, useResource } from '../../lib/data';
import { formatDateTime, statusTone } from '../../lib/format';
import { Alert, Button, EmptyState, Field, Loading, PageHeader, SelectInput, StatusBadge, TextInput } from '../../components/ui';
import { CreateUserDialog } from './CreateUserDialog';
import { UserDialog } from './UserDialog';

const PAGE_SIZE = 25;

export default function UsersPage() {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Search as you type, without a request per keystroke.
  useEffect(() => {
    const h = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(h);
  }, [search]);

  const list = useResource<Paginated<UserItem>>(`/users${query({ q, role, status, page, pageSize: PAGE_SIZE })}`);
  const data = list.data;
  const from = data && data.total > 0 ? (data.page - 1) * data.pageSize + 1 : 0;
  const to = data ? Math.min(data.page * data.pageSize, data.total) : 0;

  return (
    <>
      <PageHeader
        title={t('users.title')}
        intro={t('users.intro')}
        actions={
          can('users.manage') && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              {t('users.add')}
            </Button>
          )
        }
      />

      {notice && (
        <div className="mb-4">
          <Alert tone="success">{notice}</Alert>
        </div>
      )}

      <div className="mb-5 grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
        <Field label={t('users.search')}>
          {(id) => (
            <TextInput
              id={id}
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('users.searchPlaceholder')}
            />
          )}
        </Field>
        <Field label={t('users.role')}>
          {(id) => (
            <SelectInput
              id={id}
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
            </SelectInput>
          )}
        </Field>
        <Field label={t('users.status')}>
          {(id) => (
            <SelectInput
              id={id}
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
            </SelectInput>
          )}
        </Field>
      </div>

      {list.error && <Alert>{t(list.error.message)}</Alert>}
      {list.loading && !data && <Loading />}
      {data && data.items.length === 0 && (
        <EmptyState
          title={q || role || status ? t('users.noMatches') : t('users.empty')}
          action={
            can('users.manage') && !q && !role && !status ? (
              <Button variant="primary" onClick={() => setCreating(true)}>
                {t('users.add')}
              </Button>
            ) : undefined
          }
        />
      )}

      {data && data.items.length > 0 && (
        <>
          <div className="overflow-hidden rounded-md border border-rule bg-sheet">
            <table className="w-full text-left text-sm">
              <thead className="hidden border-b border-rule bg-paper text-ink-soft sm:table-header-group">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    {t('users.person')}
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    {t('users.roles')}
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    {t('users.status')}
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    {t('users.lastSignIn')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {data.items.map((u) => (
                  <tr key={u.id} className="block px-4 py-3 hover:bg-paper sm:table-row sm:p-0">
                    <td className="block sm:table-cell sm:px-4 sm:py-3">
                      <button
                        type="button"
                        className="text-left font-medium text-register underline-offset-2 hover:underline"
                        onClick={() => setOpenId(u.id)}
                      >
                        {u.displayName}
                      </button>
                      <div className="text-ink-soft">{u.identifier}</div>
                    </td>
                    <td className="block pt-1 sm:table-cell sm:px-4 sm:py-3">
                      {u.roles.length ? (
                        u.roles.map((r) => t(`roles.${r}`)).join(', ')
                      ) : (
                        <span className="text-ink-soft">{t('users.noRoles')}</span>
                      )}
                    </td>
                    <td className="inline-block pt-2 pr-3 sm:table-cell sm:px-4 sm:py-3">
                      <StatusBadge tone={statusTone(u.status)}>{t(`users.statuses.${u.status}`)}</StatusBadge>
                      {u.mustChangePassword && <span className="ml-2 text-xs text-ink-soft">{t('users.temporaryPasswordShort')}</span>}
                    </td>
                    <td className="inline-block pt-2 text-ink-soft sm:table-cell sm:px-4 sm:py-3">
                      <span className="sm:hidden">{t('users.lastSignIn')}: </span>
                      {formatDateTime(u.lastLoginAt, i18n.language)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="text-ink-soft" aria-live="polite">
              {t('users.showing', { from, to, total: data.total })}
            </p>
            <div className="flex gap-2">
              <Button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                {t('common.previous')}
              </Button>
              <Button disabled={to >= data.total} onClick={() => setPage((p) => p + 1)}>
                {t('common.next')}
              </Button>
            </div>
          </div>
        </>
      )}

      <CreateUserDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(u, invited) => {
          setCreating(false);
          setNotice(invited ? t('users.invitedNotice', { name: u.displayName }) : t('users.createdNotice', { name: u.displayName }));
          list.reload();
        }}
      />
      <UserDialog userId={openId} onClose={() => setOpenId(null)} onChanged={() => list.reload()} />
    </>
  );
}
