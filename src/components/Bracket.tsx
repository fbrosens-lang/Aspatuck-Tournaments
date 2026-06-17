'use client'

import { useRef } from 'react'

/**
 * Render a match's sets in the WINNER's perspective (winner's games first).
 * The stored `games_a` / `games_b` are entry-A vs entry-B, so we flip when
 * the winner is entry B. Used in the bracket to show "6-2, 6-0" under the
 * winner's name in the next round (standard tennis bracket convention).
 */
function formatSetsWinnerFirst(sets: MatchSet[], winnerIsA: boolean): string {
  return sets
    .map((s) => {
      const w = winnerIsA ? s.games_a : s.games_b
      const l = winnerIsA ? s.games_b : s.games_a
      const tbW = winnerIsA ? s.tiebreak_a : s.tiebreak_b
      const tbL = winnerIsA ? s.tiebreak_b : s.tiebreak_a
      const base = `${w}-${l}`
      if (tbW != null && tbL != null) return `${base}(${tbW}-${tbL})`
      return base
    })
    .join(', ')
}

type Entry = {
  id: string
  display: string
  shortDisplay: string
  seed: number | null
  handicap: number | null
}

type MatchSet = {
  set_number: number
  games_a: number
  games_b: number
  tiebreak_a: number | null
  tiebreak_b: number | null
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
  score_summary: string | null
  sets?: MatchSet[]
}

const STATUS_CLASS: Record<Match['status'], string> = {
  pending: 'border-[var(--color-border)]',
  reported: 'border-[var(--color-border)]',
  confirmed: 'border-[var(--color-border)]',
  disputed: 'border-[var(--color-border)]',
  overridden: 'border-[var(--color-border)]',
}

/**
 * Pick a short label for a round when the total round count is known.
 *
 * The final round is always "F", semifinals "SF", quarterfinals "QF",
 * round of 16 "R16", and earlier rounds just keep their number. The
 * shorter labels keep the round-jump tab bar readable on phones where
 * we only have ~390px of width.
 */
function shortRoundLabel(round: number, totalRounds: number): string {
  const fromEnd = totalRounds - round
  if (fromEnd === 0) return 'F'
  if (fromEnd === 1) return 'SF'
  if (fromEnd === 2) return 'QF'
  if (fromEnd === 3) return 'R16'
  return `R${round}`
}

function roundLabel(round: number, totalRounds: number): string {
  const fromEnd = totalRounds - round
  if (fromEnd === 0) return 'Finals'
  if (fromEnd === 1) return 'Semis'
  if (fromEnd === 2) return 'Quarters'
  return `Round ${round}`
}

export function Bracket({
  matches,
  entries,
  deadlineByRound,
}: {
  matches: Match[]
  entries: {
    id: string
    display: string
    shortDisplay: string
    seed: number | null
    handicap: number | null
  }[]
  deadlineByRound?: Map<number, string>
}) {
  const main = matches.filter((m) => m.bracket === 'main')

  // Ref-keyed map: round number -> column DOM node. The jump-tab onClick
  // calls scrollIntoView on the corresponding node. Using refs (rather
  // than IDs + querySelector) keeps this self-contained and survives
  // multiple brackets on the same page.
  const columnRefs = useRef<Map<number, HTMLDivElement | null>>(new Map())
  const scrollerRef = useRef<HTMLDivElement | null>(null)

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

  const totalRounds = rounds.length
  const maxRound = rounds.length > 0 ? rounds[rounds.length - 1][0] : 0

  // For each completed match, the winner's score is shown UNDER the winner's
  // name in the round they advance to (standard tennis bracket convention).
  // For the final there is no next round, so the score appears under the
  // winner's name on the same card.
  const scoreUnderEntry = new Map<string, string>()
  for (const m of main) {
    if (!m.winner_entry_id) continue
    const winnerIsA = m.winner_entry_id === m.entry_a_id
    const sets = m.sets && m.sets.length > 0 ? m.sets : null
    const score = sets
      ? formatSetsWinnerFirst(sets, winnerIsA)
      : m.score_summary
    if (!score) continue
    const displayRound = m.round === maxRound ? m.round : m.round + 1
    scoreUnderEntry.set(`${m.winner_entry_id}|${displayRound}`, score)
  }

  function jumpTo(round: number) {
    const node = columnRefs.current.get(round)
    if (!node) return
    node.scrollIntoView({
      behavior: 'smooth',
      inline: 'start',
      block: 'nearest',
    })
  }

  return (
    <div className="space-y-2">
      {/* Round-jump tabs — only shown when there's more than one round.
          On phones they let the user skip between R1 / QF / SF / F
          instead of swiping through every column. Hidden on sm+ where
          the whole bracket usually fits on screen anyway. */}
      {rounds.length > 1 && (
        <div
          className="sm:hidden flex gap-1 overflow-x-auto -mx-4 px-4"
          style={{ scrollbarWidth: 'none' }}
        >
          {rounds.map(([round]) => (
            <button
              key={round}
              type="button"
              onClick={() => jumpTo(round)}
              className="shrink-0 min-h-11 inline-flex items-center rounded border border-[var(--color-border)] px-3 text-xs uppercase tracking-wide text-[var(--color-muted)] hover:bg-zinc-50"
              aria-label={`Jump to round ${round}`}
            >
              {shortRoundLabel(round, totalRounds)}
            </button>
          ))}
        </div>
      )}

      {/* Scroll container. The edge-fade gradients sit above (pointer-
          events-none) so users see the bracket continues off-screen.
          scroll-snap keeps swipes aligned to a round boundary. */}
      <div className="relative">
        <div
          ref={scrollerRef}
          className="overflow-x-auto snap-x snap-mandatory"
        >
          {/* The bracket lays out rounds left-to-right. The gap between
              round columns (gap-4 sm:gap-6 = 16/24px) is also where the
              connector lines live. Each match li uses flex-1 so adjacent
              matches' centers are uniformly spaced — that's what makes
              the connector geometry exact. The vertical line drawn by
              an "upper" match (even slot index) goes from its center
              down to its slot boundary; the "lower" match (odd slot)
              draws the matching half going up. Together they form a
              continuous vertical bar at the gap midpoint that passes
              through the next-round match's center. */}
          <div className="flex gap-4 sm:gap-6 min-w-max items-stretch">
            {rounds.map(([round, ms], roundIdx) => {
              const hasNextRound = roundIdx < rounds.length - 1
              const isNotFirstRound = roundIdx > 0
              return (
                <div
                  key={round}
                  ref={(el) => {
                    columnRefs.current.set(round, el)
                  }}
                  className="snap-start flex flex-col w-[260px] sm:w-[260px] shrink-0"
                >
                  <div className="mb-2">
                    <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
                      {roundLabel(round, totalRounds)}
                    </div>
                    {deadlineByRound?.get(round) && (
                      <div className="text-[11px] text-[var(--color-muted)] mt-0.5">
                        Due {new Date(deadlineByRound.get(round)!).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </div>
                    )}
                  </div>
                  <ul className="flex flex-col flex-1">
                    {ms
                      .slice()
                      .sort((a, b) => a.slot - b.slot)
                      .map((m, idx) => {
                        // Pair parity is by INDEX within the sorted round
                        // (not by raw slot number) so that consolation or
                        // partial brackets still pair adjacent siblings.
                        const isUpperOfPair = idx % 2 === 0
                        return (
                          <li
                            key={m.id}
                            className="relative flex-1 flex items-center py-1.5"
                          >
                            {/* Incoming horizontal stub from the
                                previous round's connector midpoint. */}
                            {isNotFirstRound && (
                              <span
                                aria-hidden
                                className="absolute right-full top-1/2 w-2 sm:w-3 border-t-[3px] border-zinc-700"
                              />
                            )}

                            <div
                              className={`rounded border bg-white w-full ${STATUS_CLASS[m.status]}`}
                            >
                              <MatchCard
                                match={m}
                                byId={byId}
                                scoreUnderEntry={scoreUnderEntry}
                              />
                            </div>

                            {hasNextRound && (
                              <>
                                {/* Outgoing horizontal stub toward the
                                    gap midpoint where it meets the
                                    vertical bar. */}
                                <span
                                  aria-hidden
                                  className="absolute left-full top-1/2 w-2 sm:w-3 border-t-[3px] border-zinc-700"
                                />
                                {/* Vertical half of the connector. Upper
                                    member of the pair draws the BELOW
                                    half (top:50% to bottom:0), lower
                                    draws the ABOVE half (top:0 to
                                    bottom:50%). Their li bottoms touch
                                    at the midpoint between their centers
                                    — which is exactly the next round's
                                    match center, because flex-1 gives
                                    every li in a column the same
                                    height. */}
                                {isUpperOfPair ? (
                                  <span
                                    aria-hidden
                                    className="absolute top-1/2 bottom-0 border-r-[3px] border-zinc-700 left-[calc(100%+0.5rem)] sm:left-[calc(100%+0.75rem)]"
                                  />
                                ) : (
                                  <span
                                    aria-hidden
                                    className="absolute top-0 bottom-1/2 border-r-[3px] border-zinc-700 left-[calc(100%+0.5rem)] sm:left-[calc(100%+0.75rem)]"
                                  />
                                )}
                              </>
                            )}
                          </li>
                        )
                      })}
                  </ul>
                </div>
              )
            })}
          </div>
        </div>
        {/* Left + right edge fades. White-to-transparent so the user knows
            content continues. pointer-events-none so they don't intercept
            taps on match cards near the edge. Only on mobile — at sm+
            the whole bracket usually fits. */}
        <div
          aria-hidden
          className="sm:hidden pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-[var(--color-bg)] to-transparent"
        />
        <div
          aria-hidden
          className="sm:hidden pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-[var(--color-bg)] to-transparent"
        />
      </div>
    </div>
  )
}

function MatchCard({
  match,
  byId,
  scoreUnderEntry,
}: {
  match: Match
  byId: Map<string, Entry>
  scoreUnderEntry: Map<string, string>
}) {
  const a = match.entry_a_id ? byId.get(match.entry_a_id) : null
  const b = match.entry_b_id ? byId.get(match.entry_b_id) : null
  const winA = match.winner_entry_id === match.entry_a_id
  const winB = match.winner_entry_id === match.entry_b_id
  const aScore = a ? scoreUnderEntry.get(`${a.id}|${match.round}`) ?? null : null
  const bScore = b ? scoreUnderEntry.get(`${b.id}|${match.round}`) ?? null : null
  return (
    <a href={`/matches/${match.id}`} className="block px-2 sm:px-3 py-2 text-sm hover:bg-zinc-50">
      <Row
        name={a?.shortDisplay ?? '—'}
        seed={a?.seed ?? null}
        handicap={a?.handicap ?? null}
        winner={!!winA && !!a}
        score={aScore}
      />
      <Row
        name={b?.shortDisplay ?? '—'}
        seed={b?.seed ?? null}
        handicap={b?.handicap ?? null}
        winner={!!winB && !!b}
        score={bScore}
      />
    </a>
  )
}

function Row({
  name,
  seed,
  handicap,
  winner,
  score,
}: {
  name: string
  seed: number | null
  handicap: number | null
  winner: boolean
  score: string | null
}) {
  return (
    <div className={`flex items-center gap-2 py-0.5 ${winner ? 'font-semibold' : ''}`}>
      <span className="truncate flex-1 min-w-0">
        {name}
        {seed != null && (
          <span className="text-[var(--color-muted)] font-normal"> ({seed})</span>
        )}
        {handicap != null && (
          <span className="text-[var(--color-muted)] font-normal"> ({handicap})</span>
        )}
      </span>
      {score && (
        <span className="text-[11px] text-[var(--color-muted)] font-normal shrink-0 tabular-nums">
          {score}
        </span>
      )}
    </div>
  )
}
