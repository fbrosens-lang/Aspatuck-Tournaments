'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LinkPending } from '@/components/LinkPending'

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

  // Below sm: stay on one horizontally-scrollable row (snap-x keeps tabs
  // aligned). At sm+: wrap if needed — there's enough room for all four.
  // -mx-4 + px-4 lets the scroll bleed to the viewport edge on phones so
  // the rightmost tab isn't cut off by the page's outer padding.
  return (
    <nav
      className="flex gap-2 text-sm overflow-x-auto sm:overflow-visible snap-x snap-mandatory -mx-4 px-4 sm:mx-0 sm:px-0 sm:flex-wrap"
      style={{ scrollbarWidth: 'none' }}
    >
      {tabs.map((t) => {
        const isActive = pathname === t.href
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={isActive ? 'page' : undefined}
            className={
              'snap-start shrink-0 min-h-11 inline-flex items-center ' +
              (isActive
                ? 'rounded bg-[var(--color-accent)] text-white px-3'
                : 'rounded border border-[var(--color-border)] px-3 hover:bg-zinc-50')
            }
          >
            <LinkPending>{t.label}</LinkPending>
          </Link>
        )
      })}
    </nav>
  )
}
