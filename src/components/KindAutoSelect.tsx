'use client'

import { useEffect, useState } from 'react'

type Kind = 'singles' | 'doubles'

type Props = {
  /** Initial value of the kind select. Defaults to 'singles'. */
  initial?: Kind | null
  /**
   * When true, the component watches the form's `name` input and auto-flips
   * the kind to match any 'singles' / 'doubles' substring (case-insensitive).
   * Use this on the create form so typing "Aspatuck Doubles" defaults the
   * kind to doubles, but leave it off on the edit form so renames don't
   * silently change a tournament's kind under the TD's feet.
   */
  autoFromName?: boolean
}

/** Kind dropdown for tournament forms. On the create form, watches the name
 * input and updates itself when the title contains "singles" or "doubles".
 * The user can always override by picking explicitly. */
export function KindAutoSelect({ initial, autoFromName }: Props) {
  const [value, setValue] = useState<Kind>(initial ?? 'singles')
  // Lets us know whether the user has explicitly chosen a value yet — once
  // they have, we stop auto-flipping so we don't fight them.
  const [autoControlled, setAutoControlled] = useState(true)

  useEffect(() => {
    if (!autoFromName || !autoControlled) return
    // The kind select lives inside the same <form> as the name input. Walk
    // up from the select's surrounding select element via the form to find
    // the input by name attribute. We use document.querySelector as a
    // simpler fallback — there's only one name=name input per page in this
    // app.
    const nameInput = document.querySelector<HTMLInputElement>(
      'form input[name="name"]',
    )
    if (!nameInput) return

    function update() {
      const v = nameInput!.value.toLowerCase()
      if (v.includes('doubles')) {
        setValue('doubles')
      } else if (v.includes('singles')) {
        setValue('singles')
      }
      // Otherwise leave the current value alone — clearing the name
      // shouldn't reset the kind.
    }

    // Run once in case the field was pre-filled (e.g. browser autofill).
    update()
    nameInput.addEventListener('input', update)
    return () => nameInput.removeEventListener('input', update)
  }, [autoFromName, autoControlled])

  return (
    <select
      name="kind"
      value={value}
      onChange={(e) => {
        setValue(e.target.value as Kind)
        // The user picked one explicitly; stop auto-flipping from now on.
        setAutoControlled(false)
      }}
      className="mt-1 w-full rounded border border-[var(--color-border)] px-3 py-2"
    >
      <option value="singles">singles</option>
      <option value="doubles">doubles</option>
    </select>
  )
}
