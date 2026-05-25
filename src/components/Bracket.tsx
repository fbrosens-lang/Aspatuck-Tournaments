type Entry = {
  id: string
  display: string
  seed: number | null
}

type Match = {
  id: string
  bracket: 'main' | 'consolation'
  round: number
  slot: number
  entry_a_id: string | null
  entry_b_id: string | null
  winner_entry_id: string | null
  status: 'pending' | 'reported' | 'confirmed' | 'disputed' | 'overridden'
}

const STATUS_CLASS: Record<Match['status'], string> = {
  pending: 'border-[var(--color-border)]',
  reported: 'border-amber-300 bg-amber-50',
  confirmed: 'border-[var(--color-border)]',
  disputed: 'border-red-300 bg-red-50',
  overridden: 'border-blue-300 bg-blue-50',
}

export function Bracket({
  matches,
  entries,
}: {
  matches: Match[]
  entries: { id: string; display: string; seed: number | null }[]
}) {
  const main = matches.filter((m) => m.bracket === 'main')
  if (main.length === 0) return null

  const byId = new Map<string, Entry>(
    entries.map((e) => ({ ...e })).map((e) => [e.id, e]),
  )

  const rounds = Array.from(
    main.reduce<Map<number, Match[]>>((acc, m) => {
      const arr = acc.get(m.round) ?? []
      arr.push(m)
      acc.set(m.round, arr)
      return acc
    }, new Map()),
  ).sort(([a], [b]) => a - b)

  return (
    <div className="overflow-x-auto">
      <div className="flex gap-6 min-w-max items-stretch">
        {rounds.map(([round, ms]) => (
          <div key={round} className="flex flex-col justify-around min-w-[220px]">
            <div className="text-xs uppercase tracking-wide text-[var(--color-muted)] mb-2">
              Round {round}
            </div>
            <ul className="flex flex-col justify-around flex-1 gap-3">
              {ms
                .slice()
                .sort((a, b) => a.slot - b.slot)
                .map((m) => (
                  <li key={m.id} className={`rounded border bg-white ${STATUS_CLASS[m.status]}`}>
                    <MatchCard match={m} byId={byId} />
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}

function MatchCard({ match, byId }: { match: Match; byId: Map<string, Entry> }) {
  const a = match.entry_a_id ? byId.get(match.entry_a_id) : null
  const b = match.entry_b_id ? byId.get(match.entry_b_id) : null
  const winA = match.winner_entry_id === match.entry_a_id
  const winB = match.winner_entry_id === match.entry_b_id
  return (
    <a href={`/matches/${match.id}`} className="block px-3 py-2 text-sm hover:bg-zinc-50">
      <Row name={a?.display ?? '—'} seed={a?.seed ?? null} winner={!!winA && !!a} />
      <Row name={b?.display ?? '—'} seed={b?.seed ?? null} winner={!!winB && !!b} />
      {match.status !== 'pending' && match.status !== 'confirmed' && (
        <p className="text-[10px] uppercase tracking-wide text-[var(--color-muted)] mt-1">
          {match.status}
        </p>
      )}
    </a>
  )
}

function Row({ name, seed, winner }: { name: string; seed: number | null; winner: boolean }) {
  return (
    <div className={`flex items-center py-0.5 ${winner ? 'font-semibold' : ''}`}>
      <span className="truncate">
        {name}
        {seed != null && (
          <span className="text-[var(--color-muted)] font-normal"> ({seed})</span>
        )}
      </span>
    </div>
  )
}
