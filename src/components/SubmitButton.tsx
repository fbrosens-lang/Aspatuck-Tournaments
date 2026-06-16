'use client'

import { useFormStatus } from 'react-dom'

type Variant = 'primary' | 'secondary' | 'danger' | 'plain'

const VARIANT_CLASS: Record<Variant, string> = {
  primary:
    'rounded bg-[var(--color-accent)] text-white px-4 py-2 hover:opacity-90',
  secondary:
    'rounded border border-[var(--color-border)] px-3 py-1.5 text-sm hover:bg-zinc-50',
  danger: 'rounded bg-red-600 text-white px-4 py-2 hover:opacity-90',
  plain: '',
}

type Props = {
  children: React.ReactNode
  pendingLabel?: React.ReactNode
  className?: string
  variant?: Variant
  formAction?: (formData: FormData) => void | Promise<void>
  name?: string
  value?: string
  disabled?: boolean
  title?: string
  formNoValidate?: boolean
}

export function SubmitButton({
  children,
  pendingLabel = 'Submitting…',
  className,
  variant = 'primary',
  formAction,
  name,
  value,
  disabled,
  title,
  formNoValidate,
}: Props) {
  const { pending } = useFormStatus()
  const base = VARIANT_CLASS[variant]
  const joined = [base, className, pending ? 'opacity-60 cursor-wait' : '']
    .filter(Boolean)
    .join(' ')
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      formAction={formAction}
      formNoValidate={formNoValidate}
      name={name}
      value={value}
      title={title}
      className={joined}
    >
      {pending ? pendingLabel : children}
    </button>
  )
}
