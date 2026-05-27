import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isTdOfTournament } from '@/lib/auth'
import { TournamentTabs } from '@/components/TournamentTabs'

type Props = {
  params: Promise<{ id: string }>
  children: React.ReactNode
}

/**
 * Shared chrome for every page under /tournaments/[id]/. The tournament
 * name is always visible at the top, and TDs always have a one-click path
 * to Manage / Participants / Roster / Draw — replacing the "← Tournament"
 * backlink pattern each sub-page used to repeat.
 */
export default async function TournamentLayout({ params, children }: Props) {
  const { id } = await params
  const supabase = await createClient()
  const { data: tournament } = await supabase
    .from('tournaments')
    .select('name')
    .eq('id', id)
    .maybeSingle()
  if (!tournament) notFound()

  const td = await isTdOfTournament(id)

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Link
          href="/"
          className="text-xs text-[var(--color-muted)] hover:underline"
        >
          ← All tournaments
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href={`/tournaments/${id}`}
            className="text-2xl font-semibold hover:underline"
          >
            {tournament.name}
          </Link>
          <TournamentTabs tournamentId={id} isTd={td} />
        </div>
      </div>
      {children}
    </div>
  )
}
