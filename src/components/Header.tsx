import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { logout } from '@/app/auth/actions'

export async function Header() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  let role: string | null = null
  if (user) {
    const { data } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle()
    role = data?.role ?? null
  }

  return (
    <header className="border-b border-[var(--color-border)] bg-white">
      <div className="mx-auto max-w-5xl px-6 py-3 flex items-center justify-between">
        <Link href="/" className="font-semibold text-lg text-[var(--color-accent)]">
          Aspatuck Tournaments
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/" className="hover:underline">Tournaments</Link>
          <Link href="/members" className="hover:underline">Members</Link>
          {user ? (
            <>
              {(role === 'site_admin' || role === 'tournament_director') && (
                <Link href="/director" className="hover:underline font-medium">Director</Link>
              )}
              {role === 'site_admin' && (
                <Link href="/admin" className="hover:underline">Admin</Link>
              )}
              <Link href="/profile" className="hover:underline">Profile</Link>
              <form action={logout}>
                <button type="submit" className="hover:underline cursor-pointer">
                  Log out
                </button>
              </form>
            </>
          ) : (
            <>
              <Link href="/auth/login" className="hover:underline">Log in</Link>
              <Link
                href="/auth/signup"
                className="rounded bg-[var(--color-accent)] px-3 py-1.5 text-white hover:opacity-90"
              >
                Sign up
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  )
}
