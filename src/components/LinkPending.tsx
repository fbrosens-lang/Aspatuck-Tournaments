'use client'

import { useLinkStatus } from 'next/link'

export function LinkPending({ children }: { children: React.ReactNode }) {
  const { pending } = useLinkStatus()
  return (
    <span
      className="link-pending"
      style={{ display: 'contents' }}
      data-pending={pending ? 'true' : undefined}
    >
      {children}
    </span>
  )
}
