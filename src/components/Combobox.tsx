'use client'

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'

// True if every character of needle appears in haystack in order (not
// necessarily contiguously). Lets "gabi" match "gabriel" so nicknames and
// near-misses still surface the right person.
function isSubsequence(needle: string, haystack: string): boolean {
  let i = 0
  for (let j = 0; j < haystack.length && i < needle.length; j++) {
    if (haystack[j] === needle[i]) i++
  }
  return i === needle.length
}

export type ComboboxItem = {
  /** What gets submitted in the hidden form field when this item is picked. */
  value: string
  /** Primary text shown in the dropdown and in the input after selection. */
  label: string
  /** Optional muted detail (e.g. email) shown beside the label. */
  sublabel?: string
}

type Props = {
  items: ComboboxItem[]
  /** name attribute of the hidden field that carries the picked value. */
  name: string
  required?: boolean
  placeholder?: string
  ariaLabel?: string
  /** Cap on how many results render at once. Defaults to 500 — high enough
   *  to show an entire club directory without scrolling past invisible
   *  entries, low enough that the DOM stays cheap. */
  maxResults?: number
  /** If true, picking an option (by keyboard Enter or by mouse click)
   *  immediately submits the closest form. Useful for single-Combobox forms
   *  where pressing Enter twice — or hunting for the Submit button after a
   *  click — is the most common mistake. */
  submitOnPick?: boolean
}

/**
 * Type-to-filter picker with a hidden form field. The visible text input is
 * UI only; the hidden `<input name={name}>` is what the form submits. If the
 * user types something but never picks an option, the hidden field stays
 * empty so server validation can reject it.
 *
 * Click-to-select uses the standard "mousedown-inside-listbox" trick: a ref
 * is set on the listbox's mousedown, the input's blur handler checks the ref
 * and refuses to close when blur was caused by clicking an option, then the
 * option's onClick fires pick() normally. This is more reliable than using
 * onMouseDown + preventDefault on the option (which suppresses the click
 * event in some browsers and breaks touch).
 */
export function Combobox({
  items,
  name,
  required,
  placeholder,
  ariaLabel,
  maxResults = 500,
  submitOnPick = false,
}: Props) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<ComboboxItem | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const mouseDownInListbox = useRef(false)
  // Holds the form to submit on the next render that has the picked value
  // committed to the hidden field. requestSubmit() before commit would
  // submit the empty value, so we defer until the useEffect fires.
  const pendingSubmitFormRef = useRef<HTMLFormElement | null>(null)
  const reactId = useId()
  const listId = `${reactId}-list`

  const filtered = useMemo(() => {
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (tokens.length === 0) return items.slice(0, maxResults)

    // Primary rule: match by last name. Nicknames (Bob ↔ Robert, Peggy ↔
    // Margaret) make first-name search unreliable, so we use the user's last
    // query token (typically "the last name they wrote") and compare against
    // the candidate's last name. If two people share a last name, both show
    // up and the user disambiguates.
    const lastToken = tokens[tokens.length - 1]
    const byLastName = items.filter((i) => {
      const labelTokens = i.label.toLowerCase().split(/\s+/).filter(Boolean)
      const lastName = labelTokens[labelTokens.length - 1] ?? ''
      return isSubsequence(lastToken, lastName)
    })
    if (byLastName.length > 0) return byLastName.slice(0, maxResults)

    // Fallback when nothing matched as a last name (e.g. user typed only a
    // first name or a partial). Subsequence-match against label or sublabel
    // so we at least surface near-misses instead of an empty list.
    return items
      .filter((i) => {
        const hay = `${i.label} ${i.sublabel ?? ''}`.toLowerCase()
        return tokens.every((t) => isSubsequence(t, hay))
      })
      .slice(0, maxResults)
  }, [items, query, maxResults])

  function pick(item: ComboboxItem, form?: HTMLFormElement | null) {
    if (submitOnPick && form) {
      pendingSubmitFormRef.current = form
    }
    setPicked(item)
    setQuery(item.label)
    setOpen(false)
    setActiveIndex(0)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActiveIndex((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      if (open && filtered[activeIndex]) {
        e.preventDefault()
        pick(filtered[activeIndex], e.currentTarget.form)
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  // The picked value is what the form submits. The hidden field stays empty
  // until the user actually chooses from the list — so server actions can
  // distinguish "typed nothing" from "typed but didn't pick".
  const hiddenValue = picked && picked.label === query ? picked.value : ''

  // If pick-via-Enter happened with submitOnPick on, wait until the picked
  // value has flowed through render into the hidden field, then submit the
  // form. Submitting from inside the Enter handler would race the state
  // commit and post an empty value.
  useEffect(() => {
    if (pendingSubmitFormRef.current && hiddenValue) {
      const form = pendingSubmitFormRef.current
      pendingSubmitFormRef.current = null
      form.requestSubmit()
    }
  }, [hiddenValue])

  return (
    <div className="relative">
      <input
        type="text"
        role="combobox"
        required={required}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        placeholder={placeholder}
        autoComplete="off"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setPicked(null)
          setOpen(true)
          setActiveIndex(0)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // If blur was caused by mousing down on an option, keep the
          // dropdown open long enough for the option's onClick to fire.
          if (mouseDownInListbox.current) return
          setOpen(false)
        }}
        onKeyDown={onKeyDown}
        className="mt-1 w-full rounded border border-[var(--color-border)] px-3 py-2"
      />
      {open && filtered.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          // Flag the listbox while a pointer is held down inside it, so the
          // input's blur handler can tell "user is clicking an option" apart
          // from "user clicked elsewhere".
          onMouseDown={() => {
            mouseDownInListbox.current = true
          }}
          onMouseUp={() => {
            mouseDownInListbox.current = false
          }}
          // Same trick for touch.
          onTouchStart={() => {
            mouseDownInListbox.current = true
          }}
          onTouchEnd={() => {
            mouseDownInListbox.current = false
          }}
          className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded border border-[var(--color-border)] bg-white shadow"
        >
          {filtered.map((i, idx) => {
            const isActive = idx === activeIndex
            return (
              <li key={i.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={(e) => pick(i, e.currentTarget.form)}
                  className={`w-full text-left px-3 py-1.5 ${
                    isActive ? 'bg-zinc-100' : 'hover:bg-zinc-50'
                  }`}
                >
                  <div className="text-sm">{i.label}</div>
                  {i.sublabel && (
                    <div className="text-xs text-[var(--color-muted)]">
                      {i.sublabel}
                    </div>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <input type="hidden" name={name} value={hiddenValue} />
    </div>
  )
}
