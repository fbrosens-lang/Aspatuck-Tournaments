import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { logout } from '@/app/auth/actions'
import { MobileNav } from '@/components/MobileNav'
import { SubmitButton } from '@/components/SubmitButton'

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

  // Single source of truth for the link list. Rendered twice with
  // different wrappers — inline at sm+, stacked inside the drawer below.
  // The auth/role checks live here so we don't duplicate them.
  const links = user ? (
    <>
      <Link
        href="/"
        className="min-h-11 sm:min-h-0 inline-flex items-center py-2 sm:py-0 hover:underline"
      >
        Tournaments
      </Link>
      <Link
        href="/members"
        className="min-h-11 sm:min-h-0 inline-flex items-center py-2 sm:py-0 hover:underline"
      >
        Members
      </Link>
      {(role === 'site_admin' || role === 'tournament_director') && (
        <Link
          href="/director"
          className="min-h-11 sm:min-h-0 inline-flex items-center py-2 sm:py-0 hover:underline font-medium"
        >
          Director
        </Link>
      )}
      {role === 'site_admin' && (
        <Link
          href="/admin"
          className="min-h-11 sm:min-h-0 inline-flex items-center py-2 sm:py-0 hover:underline"
        >
          Admin
        </Link>
      )}
      <Link
        href="/profile"
        className="min-h-11 sm:min-h-0 inline-flex items-center py-2 sm:py-0 hover:underline"
      >
        Profile
      </Link>
      <form action={logout}>
        <SubmitButton
          variant="plain"
          className="min-h-11 sm:min-h-0 inline-flex items-center py-2 sm:py-0 hover:underline cursor-pointer"
          pendingLabel="Logging out…"
        >
          Log out
        </SubmitButton>
      </form>
    </>
  ) : (
    <>
      <Link
        href="/auth/login"
        className="min-h-11 sm:min-h-0 inline-flex items-center py-2 sm:py-0 hover:underline"
      >
        Log in
      </Link>
      <Link
        href="/auth/signup"
        className="min-h-11 sm:min-h-0 inline-flex items-center rounded bg-[var(--color-accent)] px-3 text-white hover:opacity-90 sm:py-1.5"
      >
        Sign up
      </Link>
    </>
  )

  return (
    <header className="relative border-b border-[var(--color-border)] bg-white">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
        <Link
          href="/"
          className="font-semibold text-lg text-[var(--color-accent)]"
        >
          Aspatuck Tournaments
        </Link>

        {/* Desktop / tablet: inline nav. Hidden on small screens. */}
        <nav className="hidden sm:flex items-center gap-4 text-sm">
          {links}
        </nav>

        {/* Mobile: hamburger that opens a drawer with the same links. */}
        <MobileNav>{links}</MobileNav>
      </div>
    </header>
  )
}
