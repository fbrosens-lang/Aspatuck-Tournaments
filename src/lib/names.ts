const SUFFIXES = new Set(['jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv', 'esq', 'esq.'])

export function lastName(fullName: string): string {
  const cleaned = fullName.replace(/\(.*?\)/g, ' ').replace(/,/g, ' ')
  const tokens = cleaned.trim().split(/\s+/).filter(Boolean)
  while (tokens.length > 1 && SUFFIXES.has(tokens[tokens.length - 1].toLowerCase())) {
    tokens.pop()
  }
  return tokens[tokens.length - 1] ?? ''
}

export function byLastName<T extends { full_name: string }>(a: T, b: T): number {
  const cmp = lastName(a.full_name).localeCompare(lastName(b.full_name))
  if (cmp !== 0) return cmp
  return a.full_name.localeCompare(b.full_name)
}
