import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth'
import { byLastName } from '@/lib/names'
import { formatDateUS } from '@/lib/dates'
import { Combobox, type ComboboxItem } from '@/components/Combobox'
import {
  createMember,
  deleteMember,
  deleteOrphanProfile,
  linkMemberToAccount,
  unlinkMember,
} from './actions'
import Link from 'next/link'

type Props = {
  searchParams: Promise<{ q?: string; error?: string; ok?: string }>
}

export default async function MembersPage({ searchParams }: Props) {
  const { q, error, ok } = await searchParams
  const supabase = await createClient()

  let query = supabase
    .from('club_members')
    .select('id, full_name, email, date_of_birth, user_id, notes')
  if (q && q.trim()) {
    const term = `%${q.trim()}%`
    query = query.or(`full_name.ilike.${term},email.ilike.${term}`)
  }

  // The directory is logged-in-only — some members don't want their name or
  // email visible to logged-out visitors. RLS (migration 0033) also enforces
  // this at the data layer; the redirect is just the front-door UX.
  const { userId, role } = await getSession()
  if (!userId) {
    redirect('/auth/login?error=Please+log+in+to+see+the+club+directory')
  }

  const { data: rawMembers } = await query
  const members = rawMembers ? [...rawMembers].sort(byLastName) : null
  const canEdit = role === 'tournament_director' || role === 'site_admin'

  // Orphan accounts: profiles that aren't yet linked to any directory entry.
  // These are the only valid targets for "Link to account…" pickers below,
  // and they're also the rows a TD can outright delete (e.g. an accidental
  // duplicate signup made before the name-collision check landed).
  // Only loaded for TDs/admins since regular members can't link or delete.
  type Orphan = { id: string; full_name: string; contact_email: string }
  let orphans: Orphan[] = []
  let orphanItems: ComboboxItem[] = []
  let unlinkedCount = 0
  if (canEdit) {
    const { data: linkedRows } = await supabase
      .from('club_members')
      .select('user_id')
      .not('user_id', 'is', null)
    const linkedIds = new Set((linkedRows ?? []).map((r) => r.user_id as string))

    const { data: allProfiles } = await supabase
      .from('profiles')
      .select('id, full_name, contact_email')
    orphans = (allProfiles ?? [])
      .filter((p) => !linkedIds.has(p.id))
      .sort(byLastName)
    orphanItems = orphans.map((p) => ({
      value: p.id,
      label: p.full_name,
      sublabel: p.contact_email,
    }))

    unlinkedCount = (members ?? []).filter((m) => !m.user_id).length
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Member directory</h1>
        <p className="text-[var(--color-muted)] mt-1">
          The Aspatuck club roster.
          {canEdit &&
            ' Members with a linked account have a green dot in the Linked column.'}
        </p>
      </header>

      {error && (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {ok && (
        <p className="rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-700">
          {ok === 'created' && 'Member added.'}
          {ok === 'updated' && 'Member updated.'}
          {ok === 'deleted' && 'Member removed.'}
          {ok === 'linked' && 'Directory entry linked to account.'}
          {ok === 'unlinked' && 'Directory entry unlinked.'}
          {ok === 'account_deleted' && 'Account deleted.'}
        </p>
      )}

      {canEdit && unlinkedCount > 0 && orphanItems.length > 0 && (
        <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {unlinkedCount} directory{' '}
          {unlinkedCount === 1 ? 'entry has' : 'entries have'} no linked
          account, and there{' '}
          {orphanItems.length === 1 ? 'is' : 'are'} {orphanItems.length}{' '}
          signed-up{' '}
          {orphanItems.length === 1 ? 'account' : 'accounts'} not yet tied to
          a directory entry. Use the &quot;Link to account…&quot; picker on
          each unlinked row to pair them up.
        </p>
      )}

      <form action="/members" method="get" className="flex gap-2 items-end">
        <label className="block flex-1">
          <span className="text-sm">Search</span>
          <input
            name="q"
            defaultValue={q ?? ''}
            placeholder="Name or email"
            className="mt-1 w-full rounded border border-[var(--color-border)] px-3 py-2"
          />
        </label>
        <button
          type="submit"
          className="rounded border border-[var(--color-border)] px-4 py-2 hover:bg-zinc-50"
        >
          Search
        </button>
        {q && (
          <Link
            href="/members"
            className="rounded border border-[var(--color-border)] px-4 py-2 hover:bg-zinc-50"
          >
            Clear
          </Link>
        )}
      </form>

      {canEdit && orphans.length > 0 && (
        <details className="rounded border border-amber-300 bg-amber-50 p-4">
          <summary className="cursor-pointer font-medium">
            Accounts without a directory entry ({orphans.length})
          </summary>
          <p className="text-sm text-[var(--color-muted)] mt-2">
            These accounts signed up but aren&apos;t tied to any directory
            entry. Link them above on a matching row, or delete the account if
            it&apos;s an accidental duplicate.
          </p>
          <ul className="mt-3 divide-y divide-amber-200 bg-white rounded border border-amber-200">
            {orphans.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <div className="truncate">{p.full_name}</div>
                  <div className="text-xs text-[var(--color-muted)] truncate">
                    {p.contact_email}
                  </div>
                </div>
                <form action={deleteOrphanProfile} className="shrink-0">
                  <input type="hidden" name="user_id" value={p.id} />
                  <button
                    type="submit"
                    className="text-xs text-red-700 hover:underline"
                    title="Delete this account permanently"
                  >
                    Delete account
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </details>
      )}

      {canEdit && (
        <details className="rounded border border-[var(--color-border)] bg-white p-4">
          <summary className="cursor-pointer font-medium">Add a member</summary>
          <form
            action={createMember}
            className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3"
          >
            <label className="block">
              <span className="text-sm">Full name</span>
              <input
                name="full_name"
                required
                className="mt-1 w-full rounded border border-[var(--color-border)] px-3 py-2"
              />
            </label>
            <label className="block">
              <span className="text-sm">Email</span>
              <input
                type="email"
                name="email"
                required
                className="mt-1 w-full rounded border border-[var(--color-border)] px-3 py-2"
              />
            </label>
            <label className="block">
              <span className="text-sm">Date of birth (optional)</span>
              <input
                type="text"
                name="date_of_birth"
                placeholder="MM/DD/YYYY"
                inputMode="numeric"
                autoComplete="bday"
                pattern="\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}|\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}"
                title="Type the date as MM/DD/YYYY (e.g. 03/14/1975)"
                className="mt-1 w-full rounded border border-[var(--color-border)] px-3 py-2"
              />
            </label>
            <label className="block">
              <span className="text-sm">Notes (optional)</span>
              <input
                name="notes"
                className="mt-1 w-full rounded border border-[var(--color-border)] px-3 py-2"
              />
            </label>
            <button
              type="submit"
              className="rounded bg-[var(--color-accent)] text-white px-4 py-2 hover:opacity-90 sm:col-span-2 justify-self-start"
            >
              Add member
            </button>
          </form>
        </details>
      )}

      <section>
        <p className="text-sm text-[var(--color-muted)] mb-2">
          {members?.length ?? 0} {members?.length === 1 ? 'member' : 'members'}
        </p>
        {!members || members.length === 0 ? (
          <div className="rounded border border-dashed border-[var(--color-border)] p-6 text-center text-[var(--color-muted)]">
            No matches.
          </div>
        ) : (
          <>
            {/* Desktop / tablet table. Hidden on phones — the 5-column
                layout (with the Link-to-account combobox) doesn't fit. */}
            <table className="hidden sm:table w-full text-sm bg-white border border-[var(--color-border)] rounded">
              <thead className="text-left text-[var(--color-muted)] uppercase text-xs">
                <tr>
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Email</th>
                  {canEdit && <th className="px-4 py-2 font-medium">DOB</th>}
                  {canEdit && <th className="px-4 py-2 font-medium">Linked</th>}
                  {canEdit && <th className="px-4 py-2 font-medium"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {members.map((m) => (
                  <tr key={m.id}>
                    <td className="px-4 py-2">{m.full_name}</td>
                    <td className="px-4 py-2 text-[var(--color-muted)]">
                      <a href={`mailto:${m.email}`} className="hover:underline">
                        {m.email}
                      </a>
                    </td>
                    {canEdit && (
                      <td className="px-4 py-2 text-[var(--color-muted)]">
                        {formatDateUS(m.date_of_birth)}
                      </td>
                    )}
                    {canEdit && (
                    <td className="px-4 py-2">
                      {m.user_id ? (
                        <span className="inline-flex items-center gap-2">
                          <span className="inline-flex items-center gap-1 text-xs text-green-700">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                            account
                          </span>
                          {canEdit && (
                            <form action={unlinkMember} className="inline">
                              <input
                                type="hidden"
                                name="club_member_id"
                                value={m.id}
                              />
                              <button
                                type="submit"
                                className="text-xs text-[var(--color-muted)] hover:underline"
                                title="Disconnect this directory entry from the account it was linked to"
                              >
                                unlink
                              </button>
                            </form>
                          )}
                        </span>
                      ) : canEdit && orphanItems.length > 0 ? (
                        <form
                          action={linkMemberToAccount}
                          className="flex items-end gap-2 min-w-[260px]"
                        >
                          <input
                            type="hidden"
                            name="club_member_id"
                            value={m.id}
                          />
                          <div className="flex-1">
                            <Combobox
                              name="user_id"
                              items={orphanItems}
                              required
                              placeholder="Link to account…"
                              ariaLabel="Account to link"
                            />
                          </div>
                          <button
                            type="submit"
                            className="text-xs rounded border border-[var(--color-border)] px-2 py-1 hover:bg-zinc-50"
                          >
                            Link
                          </button>
                        </form>
                      ) : (
                        <span className="text-xs text-[var(--color-muted)]">—</span>
                      )}
                    </td>
                    )}
                    {canEdit && (
                      <td className="px-4 py-2 text-right">
                        <form
                          action={deleteMember}
                          className="inline"
                        >
                          <input type="hidden" name="id" value={m.id} />
                          <button
                            type="submit"
                            className="text-xs text-red-700 hover:underline"
                          >
                            Remove
                          </button>
                        </form>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Mobile: each member becomes a card. The link-to-account
                combobox gets its own row underneath so it's not squeezed
                into a column that would force horizontal scroll. */}
            <ul className="sm:hidden divide-y divide-[var(--color-border)] bg-white border border-[var(--color-border)] rounded">
              {members.map((m) => (
                <li key={m.id} className="px-4 py-3 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{m.full_name}</div>
                      <a
                        href={`mailto:${m.email}`}
                        className="text-sm text-[var(--color-muted)] hover:underline break-all"
                      >
                        {m.email}
                      </a>
                      {canEdit && m.date_of_birth && (
                        <div className="text-xs text-[var(--color-muted)] mt-1">
                          DOB {formatDateUS(m.date_of_birth)}
                        </div>
                      )}
                      {m.user_id ? (
                        <span className="inline-flex items-center gap-1 text-xs text-green-700 mt-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                          linked account
                        </span>
                      ) : (
                        <span className="text-xs text-[var(--color-muted)] mt-1 block">
                          no linked account
                        </span>
                      )}
                    </div>
                    {canEdit && (
                      <form action={deleteMember} className="shrink-0">
                        <input type="hidden" name="id" value={m.id} />
                        <button
                          type="submit"
                          className="min-h-11 inline-flex items-center text-xs text-red-700 hover:underline px-2"
                        >
                          Remove
                        </button>
                      </form>
                    )}
                  </div>
                  {canEdit && m.user_id && (
                    <form action={unlinkMember}>
                      <input type="hidden" name="club_member_id" value={m.id} />
                      <button
                        type="submit"
                        className="min-h-11 inline-flex items-center text-xs text-[var(--color-muted)] hover:underline"
                      >
                        Unlink account
                      </button>
                    </form>
                  )}
                  {canEdit && !m.user_id && orphanItems.length > 0 && (
                    <form
                      action={linkMemberToAccount}
                      className="flex items-end gap-2"
                    >
                      <input type="hidden" name="club_member_id" value={m.id} />
                      <div className="flex-1 min-w-0">
                        <Combobox
                          name="user_id"
                          items={orphanItems}
                          required
                          placeholder="Link to account…"
                          ariaLabel="Account to link"
                        />
                      </div>
                      <button
                        type="submit"
                        className="rounded border border-[var(--color-border)] px-3 py-2 text-sm hover:bg-zinc-50"
                      >
                        Link
                      </button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  )
}
