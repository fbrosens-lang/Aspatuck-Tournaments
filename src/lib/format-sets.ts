type Set = {
  games_a: number
  games_b: number
  tiebreak_a: number | null
  tiebreak_b: number | null
}

export function formatSetsScore(sets: Set[]): string {
  return sets
    .map((s) => {
      const games = `${s.games_a}-${s.games_b}`
      if (s.tiebreak_a != null && s.tiebreak_b != null) {
        return `${games}(${s.tiebreak_a}-${s.tiebreak_b})`
      }
      return games
    })
    .join(', ')
}
