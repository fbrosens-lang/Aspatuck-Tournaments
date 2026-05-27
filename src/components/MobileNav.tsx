'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

type MobileNavProps = {
  children: React.ReactNode
}

/**
 * MobileNav — hamburger drawer for screen widths below sm (640px).
 *
 * The links live in the children slot so the parent (Header) can render
 * them once and reuse them in both the desktop inline nav and the mobile
 * drawer. We don't duplicate auth-conditional logic here.
 *
 * Closes on:
 *   • the Escape key
 *   • outside click (anywhere outside the panel + button)
 *   • route change (the parent re-mounts via Server Component, but
 *     internal Link clicks need explicit close — see onLinkClick).
 */
export function MobileNav({ children }: MobileNavProps) {
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    // Handler is shared between mousedown and touchstart; widen the
    // event type so TS accepts both registrations.
    function onPointerOutside(e: Event) {
      const target = e.target as Node
      if (
        panelRef.current?.contains(target) ||
        buttonRef.current?.contains(target)
      ) {
        return
      }
      setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onPointerOutside)
    document.addEventListener('touchstart', onPointerOutside)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onPointerOutside)
      document.removeEventListener('touchstart', onPointerOutside)
    }
  }, [open])

  return (
    <div className="sm:hidden">
      <button
        ref={buttonRef}
        type="button"
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
        aria-controls="mobile-nav-panel"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center justify-center min-h-11 min-w-11 rounded text-[var(--color-fg)] hover:bg-zinc-100"
      >
        {/* Inline icon — no dependency. Toggles between hamburger and X. */}
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {open ? (
            <>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </>
          ) : (
            <>
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </>
          )}
        </svg>
      </button>

      {open && (
        <div
          id="mobile-nav-panel"
          ref={panelRef}
          role="dialog"
          aria-modal="false"
          aria-label="Site navigation"
          className="absolute left-0 right-0 top-full z-20 border-b border-[var(--color-border)] bg-white shadow-sm"
        >
          {/* onLinkClick closes the drawer when any descendant <Link> or
              <button> is activated. Cheaper than wrapping each child. */}
          <nav
            className="mx-auto max-w-5xl px-4 py-2 flex flex-col text-sm"
            onClick={(e) => {
              const t = e.target as HTMLElement
              if (t.closest('a, button')) setOpen(false)
            }}
          >
            {children}
          </nav>
        </div>
      )}
    </div>
  )
}

/**
 * Helper to render a nav row that meets the 44px tap floor.
 * Used by Header for both desktop and mobile so the visual is
 * consistent and the touch zone is large on phones.
 */
export function MobileNavLink({
  href,
  children,
}: {
  href: string
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      className="min-h-11 inline-flex items-center py-2 hover:underline"
    >
      {children}
    </Link>
  )
}
