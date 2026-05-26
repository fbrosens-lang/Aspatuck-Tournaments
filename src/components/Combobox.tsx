'use client'

import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'

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
  /** Cap on how many results render at once. Defaults to 25. */
  maxResults?: number
}

/**
 * Type-to-filter picker with a hidden form field. The visible text input is
 * UI only; the hidden `<input name={name}>` is what the form submits. If the
 * user types something but never picks an option, the hidden field stays
 * empty so server validation can reject it.
 */
export function Combobox({
  items,
  name,
  required,
  placeholder,
  ariaLabel,
  maxResults = 25,
}: Props) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<ComboboxItem | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reactId = useId()
  const listId = `${reactId}-list`

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items.slice(0, maxResults)
    return items
      .filter(
        (i) =>
          i.label.toLowerCase().includes(q) ||
          (i.sublabel?.toLowerCase().includes(q) ?? false),
      )
      .slice(0, maxResults)
  }, [items, query, maxResults])

  function pick(item: ComboboxItem) {
    setPicked(item)
    setQuery(item.label)
    setOpen(false)
    setActiveIndex(0)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      if (open && filtered[activeIndex]) {
        e.preventDefault()
        pick(filtered[activeIndex])
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  // The picked value is what the form submits. The hidden field stays empty
  // until the user actually chooses from the list — so `required` blocks
  // free-text typing that doesn't match an item.
  const hiddenValue = picked && picked.label === query ? picked.value : ''

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
          // Defer close so a click on a dropdown item still registers.
          blurTimer.current = setTimeout(() => setOpen(false), 120)
        }}
        onKeyDown={onKeyDown}
        className="mt-1 w-full rounded border border-[var(--color-border)] px-3 py-2"
      />
      {open && filtered.length > 0 && (
        <ul
          id={listId}
          role="listbox"
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
                  onMouseDown={(e) => {
                    // Prevent the input's blur from firing before pick().
                    e.preventDefault()
                    if (blurTimer.current) clearTimeout(blurTimer.current)
                    pick(i)
                  }}
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
      {/* The submitted value. Empty until the user picks an option from the
          dropdown — server actions reject empty with a "Pick from the list"
          message, distinct from the visible input's `required` (which only
          enforces non-empty text). */}
      <input type="hidden" name={name} value={hiddenValue} />
    </div>
  )
}
