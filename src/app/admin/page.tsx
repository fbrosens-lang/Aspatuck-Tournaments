import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { setUserRole } from './actions'

const ROLES = ['player', 'tournament_director', 'site_admin'] as const

export default async function AdminPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login?error=Please+log+in')

  const { data: me } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()
  if (me?.role !== 'site_admin') {
    return (
      <div className="max-w-md mx-auto py-12">
        <h1 className="text-2xl font-semibold mb-3">Admin</h1>
        <p className="text-red-700">
          You don&apos;t have site-admin access. If you should, ask another site admin
          to grant it, or set <code>profiles.role = &apos;site_admin&apos;</code> on your
          row in the Supabase dashboard for the bootstrap user.
        </p>
      </div>
    )
  }

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, full_name, contact_email, role, created_at')
    .order('created_at', { ascending: true })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Admin · Users</h1>
        <p className="text-[var(--color-muted)] mt-1">
          Grant or revoke the tournament director role for any user.
        </p>
      </div>

      <table className="w-full text-sm bg-white border border-[var(--color-border)] rounded">
        <thead className="text-left text-[var(--color-muted)] uppercase text-xs">
          <tr>
            <th className="px-4 py-2 font-medium">Name</th>
            <th className="px-4 py-2 font-medium">Email</th>
            <th className="px-4 py-2 font-medium">Role</th>
            <th className="px-4 py-2 font-medium">Change to</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-border)]">
          {profiles?.map((p) => (
            <tr key={p.id}>
              <td className="px-4 py-2">{p.full_name}</td>
              <td className="px-4 py-2 text-[var(--color-muted)]">{p.contact_email}</td>
              <td className="px-4 py-2">{p.role}</td>
              <td className="px-4 py-2">
                <form action={setUserRole} className="flex gap-2">
                  <input type="hidden" name="user_id" value={p.id} />
                  <select
                    name="role"
                    defaultValue={p.role}
                    className="rounded border border-[var(--color-border)] px-2 py-1"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    className="rounded bg-[var(--color-accent)] text-white px-3 py-1 hover:opacity-90"
                  >
                    Save
                  </button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
