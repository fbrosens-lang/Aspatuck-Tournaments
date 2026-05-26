import { KindAutoSelect } from './KindAutoSelect'

type TournamentRules = {
  bracket_format: 'single_elim' | 'single_elim_consolation'
  match_kind: 'best_of_3' | 'pro_set_8' | 'pro_set_10'
  final_set_format: 'standard' | 'super_tb_10' | 'super_tb_7' | 'no_ad'
  sets_to_win: number
  games_per_set: number
  tiebreak_at: number
  requires_dob: boolean
  registration_deadline_override: string | null
}

type Props = {
  mode: 'create' | 'edit'
  initial?: Partial<TournamentRules> & { kind?: 'singles' | 'doubles' }
}

function toLocalInput(ts: string | null | undefined): string {
  if (!ts) return ''
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function TournamentRulesFields({ mode, initial }: Props) {
  const i = initial
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-sm">Kind</span>
          <KindAutoSelect
            initial={i?.kind}
            autoFromName={mode === 'create'}
          />
          {mode === 'edit' && (
            <span className="block mt-1 text-xs text-[var(--color-muted)]">
              Changing the kind is only allowed while there are no active
              entries.
            </span>
          )}
        </label>
        <label className="block">
          <span className="text-sm">Bracket format</span>
          <select
            name="bracket_format"
            defaultValue={i?.bracket_format ?? 'single_elim'}
            className="mt-1 w-full rounded border border-[var(--color-border)] px-3 py-2"
          >
            <option value="single_elim">single elimination</option>
            <option value="single_elim_consolation">single elim + consolation</option>
          </select>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-sm">Match format</span>
          <select
            name="match_kind"
            defaultValue={i?.match_kind ?? 'best_of_3'}
            className="mt-1 w-full rounded border border-[var(--color-border)] px-3 py-2"
          >
            <option value="best_of_3">best of 3 sets</option>
            <option value="pro_set_8">pro set to 8</option>
            <option value="pro_set_10">pro set to 10</option>
          </select>
        </label>
        <label className="block">
          <span className="text-sm">Final-set format</span>
          <select
            name="final_set_format"
            defaultValue={i?.final_set_format ?? 'super_tb_10'}
            className="mt-1 w-full rounded border border-[var(--color-border)] px-3 py-2"
          >
            <option value="standard">standard final set</option>
            <option value="super_tb_10">10-point super tiebreak</option>
            <option value="super_tb_7">7-point super tiebreak</option>
            <option value="no_ad">no-ad scoring</option>
          </select>
        </label>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <label className="block">
          <span className="text-sm">Sets to win</span>
          <input
            type="number"
            name="sets_to_win"
            min={1}
            max={3}
            defaultValue={i?.sets_to_win ?? 2}
            className="mt-1 w-full rounded border border-[var(--color-border)] px-3 py-2"
          />
        </label>
        <label className="block">
          <span className="text-sm">Games per set</span>
          <input
            type="number"
            name="games_per_set"
            min={4}
            max={10}
            defaultValue={i?.games_per_set ?? 6}
            className="mt-1 w-full rounded border border-[var(--color-border)] px-3 py-2"
          />
        </label>
        <label className="block">
          <span className="text-sm">Tiebreak at</span>
          <input
            type="number"
            name="tiebreak_at"
            min={0}
            defaultValue={i?.tiebreak_at ?? 6}
            className="mt-1 w-full rounded border border-[var(--color-border)] px-3 py-2"
          />
        </label>
      </div>

      <fieldset className="rounded border border-[var(--color-border)] p-3">
        <legend className="text-sm px-1">Eligibility (optional)</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="requires_dob"
            defaultChecked={i?.requires_dob ?? false}
          />
          Require a date of birth on the participant
        </label>
        <label className="block mt-3">
          <span className="text-sm">Registration deadline override (optional)</span>
          <input
            type="datetime-local"
            name="registration_deadline_override"
            defaultValue={toLocalInput(i?.registration_deadline_override)}
            className="mt-1 w-full rounded border border-[var(--color-border)] px-3 py-2"
          />
        </label>
      </fieldset>
    </>
  )
}
