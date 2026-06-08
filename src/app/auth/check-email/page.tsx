import Link from 'next/link'

type Props = { searchParams: Promise<{ resent?: string }> }

export default async function CheckEmailPage({ searchParams }: Props) {
  const { resent } = await searchParams
  if (resent) {
    return (
      <div className="max-w-md mx-auto py-12">
        <h1 className="text-2xl font-semibold mb-3">Check your email</h1>
        <p className="text-[var(--color-muted)]">
          An account with this email already existed but wasn&apos;t confirmed
          yet — we&apos;ve re-sent the confirmation link. Click it to verify
          your email.
        </p>
        <p className="mt-3 text-[var(--color-muted)]">
          Once your email is confirmed, log in with the password you used when
          you first signed up. If you don&apos;t remember it, use{' '}
          <Link href="/auth/login" className="underline">Forgot password?</Link>{' '}
          on the login page after you confirm.
        </p>
      </div>
    )
  }
  return (
    <div className="max-w-md mx-auto py-12">
      <h1 className="text-2xl font-semibold mb-3">Check your email</h1>
      <p className="text-[var(--color-muted)]">
        We&apos;ve sent you a confirmation link. Click it to verify your email and finish signing up.
      </p>
    </div>
  )
}
