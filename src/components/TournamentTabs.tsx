'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

type Props = {
  tournamentId: string
  /** Whether the current user is a TD/admin for this tournament. Non-TDs
   *  only see the Overview tab; the TD-only sub-pages would just redirect
   *  them anyway. */
  isTd: boolean
}

/**
 * Persistent tab bar shown on every page under /tournaments/[id]/. The
 * active tab is highlighted via usePathname so the TD always knows where
 * they are and can jump straight to any other section without hunting for
 * the browser Back button.
 */
export function TournamentTabs({ tournamentId, isTd }: Props) {
  const pathname = usePathname()
  const overviewHref = `/tournaments/${tournamentId}`
  const tabs: { href: string; label: string }[] = [
    { href: overviewHref, label: 'Overview' },
  ]
  if (isTd) {
    tabs.push(
      { href: `/tournaments/${tournamentId}/manage`, label: 'Manage' },
      { href: `/tournaments/${tournamentId}/entries`, label: 'Roster' },
      { href: `/tournaments/${tournamentId}/draw`, label: 'Draw' },
    )
  }

  return (
    <nav className="flex flex-wrap gap-2 text-sm">
      {tabs.map((t) => {
        const isActive = pathname === t.href
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={isActive ? 'page' : undefined}
            className={
              isActive
                ? 'rounded bg-[var(--color-accent)] text-white px-3 py-1.5'
                : 'rounded border border-[var(--color-border)] px-3 py-1.5 hover:bg-zinc-50'
            }
          >
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}
