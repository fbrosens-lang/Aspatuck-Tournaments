'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'

export function NavProgress() {
  const pathname = usePathname()
  const [pending, setPending] = useState(false)
  const [width, setWidth] = useState(0)
  const lastPathname = useRef(pathname)
  const tickRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hideRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!pending) return
    setWidth(8)
    function creep() {
      setWidth((w) => {
        if (w >= 90) return w
        const inc = Math.max(0.5, (90 - w) * 0.04)
        return Math.min(90, w + inc)
      })
      tickRef.current = setTimeout(creep, 200)
    }
    creep()
    return () => {
      if (tickRef.current) clearTimeout(tickRef.current)
    }
  }, [pending])

  useEffect(() => {
    if (pathname === lastPathname.current) return
    lastPathname.current = pathname
    if (!pending) return
    if (tickRef.current) clearTimeout(tickRef.current)
    setWidth(100)
    setPending(false)
    if (hideRef.current) clearTimeout(hideRef.current)
    hideRef.current = setTimeout(() => setWidth(0), 250)
  }, [pathname, pending])

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
      if (e.defaultPrevented) return
      const a = (e.target as HTMLElement | null)?.closest?.('a')
      if (!a) return
      const href = a.getAttribute('href')
      if (!href || href.startsWith('#')) return
      const tgt = a.getAttribute('target')
      if (tgt && tgt !== '_self') return
      let url: URL
      try {
        url = new URL(href, window.location.href)
      } catch {
        return
      }
      if (url.origin !== window.location.origin) return
      if (
        url.pathname === window.location.pathname &&
        url.search === window.location.search
      )
        return
      if (hideRef.current) clearTimeout(hideRef.current)
      setPending(true)
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [])

  return (
    <div
      aria-hidden
      className="fixed top-0 left-0 right-0 h-0.5 z-50 pointer-events-none"
    >
      <div
        className="h-full bg-[var(--color-accent)]"
        style={{
          width: `${width}%`,
          opacity: width > 0 ? 1 : 0,
          transition: 'width 200ms ease-out, opacity 150ms 100ms ease-out',
        }}
      />
    </div>
  )
}
