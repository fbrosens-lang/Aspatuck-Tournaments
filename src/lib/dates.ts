// Flexible date parsing for free-text date-of-birth inputs.
//
// The browser's <input type="date"> calendar widget is fine for near-future
// dates (tournament start/end) but painful for dates of birth — clicking back
// through decades is tedious. We use plain text inputs for DOB and parse here.
//
// Accepts (US-first; the leading-4-digit form is unambiguous either way):
//   MM/DD/YYYY      e.g.  03/14/1975
//   M/D/YYYY        e.g.   3/14/1975
//   MM-DD-YYYY      e.g.  03-14-1975
//   YYYY-MM-DD      e.g.  1975-03-14   (ISO; also what Postgres stores)
//   YYYY/MM/DD      e.g.  1975/03/14
//
// Ambiguous forms like 01/02/2025 are treated as MM/DD/YYYY (Jan 2).

const ISO = /^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/
const US = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/

/**
 * Parse a free-text date into an ISO YYYY-MM-DD string suitable for Postgres
 * `date` columns. Returns `null` if the input is empty, unparseable, or not a
 * real calendar date (e.g., Feb 30).
 */
export function parseFlexibleDate(
  input: string | null | undefined,
): string | null {
  if (!input) return null
  const s = String(input).trim()
  if (!s) return null

  let year: number
  let month: number
  let day: number

  const iso = s.match(ISO)
  const us = !iso ? s.match(US) : null

  if (iso) {
    year = Number(iso[1])
    month = Number(iso[2])
    day = Number(iso[3])
  } else if (us) {
    month = Number(us[1])
    day = Number(us[2])
    year = Number(us[3])
  } else {
    return null
  }

  // Round-trip via Date to catch impossible calendar dates (Feb 30, etc.).
  const d = new Date(Date.UTC(year, month - 1, day))
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return null
  }

  const mm = String(month).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  return `${year}-${mm}-${dd}`
}

/**
 * Format a stored date (YYYY-MM-DD as Postgres returns it) for display in the
 * text input. Returns '' for null/empty, or the input unchanged if it doesn't
 * look like ISO (defensive — never silently drop data).
 */
export function formatDateUS(value: string | null | undefined): string {
  if (!value) return ''
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return String(value)
  return `${m[2]}/${m[3]}/${m[1]}`
}

const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/**
 * Format a stored date (YYYY-MM-DD) as "June 1, 2026". Parses the components
 * manually so the result is always the calendar date Postgres stored — using
 * `new Date('2026-06-01')` would parse as UTC midnight and shift a day back
 * in negative-offset timezones (Eastern time, etc.).
 */
export function formatDateLong(value: string | null | undefined): string {
  if (!value) return ''
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return String(value)
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12) return String(value)
  return `${MONTHS_LONG[month - 1]} ${day}, ${year}`
}
