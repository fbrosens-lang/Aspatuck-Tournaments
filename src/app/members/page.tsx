import { createClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth'
import { byLastName } from '@/lib/names'
import { formatDateUS } from '@/lib/dates'
import { createMember, deleteMember } from './actions'
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

  const { data: rawMembers } = await query
  const members = rawMembers ? [...rawMembers].sort(byLastName) : null
  const { role } = await getSession()
  const canEdit = role === 'tournament_director' || role === 'site_admin'

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Member directory</h1>
        <p className="text-[var(--color-muted)] mt-1">
          The Aspatuck club roster. Members with a linked account have a green dot.
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
          <table className="w-full text-sm bg-white border border-[var(--color-border)] rounded">
            <thead className="text-left text-[var(--color-muted)] uppercase text-xs">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Email</th>
                <th className="px-4 py-2 font-medium">DOB</th>
                <th className="px-4 py-2 font-medium">Linked</th>
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
                  <td className="px-4 py-2 text-[var(--color-muted)]">
                    {formatDateUS(m.date_of_birth)}
                  </td>
                  <td className="px-4 py-2">
                    {m.user_id ? (
                      <span className="inline-flex items-center gap-1 text-xs text-green-700">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                        account
                      </span>
                    ) : (
                      <span className="text-xs text-[var(--color-muted)]">—</span>
                    )}
                  </td>
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
        )}
      </section>
    </div>
  )
}
