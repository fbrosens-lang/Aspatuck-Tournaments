'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

async function getSiteOrigin(): Promise<string> {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  const proto = h.get('x-forwarded-proto') ?? 'http'
  return `${proto}://${host}`
}

export async function login(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')
  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    const params = new URLSearchParams({ error: error.message })
    // For credential failures specifically, look up whether the email is on
    // the club roster so the login page can show a more useful hint:
    // - On roster: they likely just haven't signed up yet (prefill signup).
    // - Off roster: their membership may be under a different email.
    if (error.message.toLowerCase().includes('invalid login credentials') && email) {
      const { data: onRoster } = await supabase.rpc('signup_allowed_for_email', {
        p_email: email,
      })
      params.set('email', email)
      params.set('on_roster', onRoster ? '1' : '0')
    }
    redirect(`/auth/login?${params.toString()}`)
  }
  redirect('/')
}

const NOT_ON_ROSTER_MESSAGE =
  "This email isn't on the club roster. If you're a member, please sign up with the email the tournament director has on file (or ask them to update it). If you're not a member yet, please contact the tournament director to be added first."

type AccountStatus = 'not_on_roster' | 'no_account' | 'unconfirmed' | 'confirmed'

export async function signup(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')
  const fullName = String(formData.get('full_name') ?? '').trim()
  if (!fullName) {
    redirect('/auth/signup?error=Full+name+is+required')
  }
  const supabase = await createClient()

  // Look up where this email stands so we can route to the right next step
  // instead of leaving the user stuck. The states we care about:
  // - not_on_roster: TD hasn't added them yet, bounce with instructions.
  // - confirmed:    they already have a working account — send them to login.
  // - unconfirmed:  prior signup created the row but they never clicked the
  //                 confirmation link (the case that bit Michael Thaler) —
  //                 re-send that link instead of trying to create a new user.
  // - no_account:   on roster, no auth row yet — proceed with auth.signUp.
  const { data: statusRaw } = await supabase.rpc('account_status_for_email', {
    p_email: email,
  })
  const status = statusRaw as AccountStatus | null
  if (status === 'not_on_roster') {
    redirect(`/auth/signup?error=${encodeURIComponent(NOT_ON_ROSTER_MESSAGE)}`)
  }
  if (status === 'confirmed') {
    redirect(
      `/auth/login?email=${encodeURIComponent(email)}&notice=${encodeURIComponent(
        "An account with this email already exists. Log in below, or click “Forgot password?” if you don’t remember your password.",
      )}`,
    )
  }
  if (status === 'unconfirmed') {
    // The user re-submitted the signup form for an account that already
    // exists but was never confirmed. Their original password is still in
    // place — we can't change it from the anon client — so the check-email
    // page tells them to log in with their original password after clicking
    // the link.
    const { error: resendErr } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: `${await getSiteOrigin()}/auth/callback` },
    })
    if (resendErr) {
      console.error('[signup] resend(signup) failed', {
        email,
        status: resendErr.status,
        code: resendErr.code,
        message: resendErr.message,
      })
      redirect(`/auth/signup?error=${encodeURIComponent(resendErr.message)}`)
    }
    redirect('/auth/check-email?resent=1')
  }
  // status === 'no_account' (or null) — proceed with a fresh sign-up.

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      emailRedirectTo: `${await getSiteOrigin()}/auth/callback`,
    },
  })
  if (error) {
    redirect(`/auth/signup?error=${encodeURIComponent(error.message)}`)
  }
  // When email confirmation is off, signUp returns a usable session and the
  // user is immediately logged in. Otherwise they need to click the email link.
  if (data.session) {
    redirect('/')
  }
  redirect('/auth/check-email')
}

export async function logout() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/')
}

export async function requestPasswordReset(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim()
  if (!email) {
    redirect('/auth/login?error=Enter+your+email+first%2C+then+click+%22Forgot+password%3F%22')
  }
  const supabase = await createClient()

  // Same routing as signup: don't send a reset link to someone who's not
  // actually in a state to use one. The 'unconfirmed' branch is the important
  // one — without it Supabase happily sends a recovery email that the user
  // can't really use, because they were never confirmed in the first place.
  const { data: statusRaw } = await supabase.rpc('account_status_for_email', {
    p_email: email,
  })
  const status = statusRaw as AccountStatus | null
  if (status === 'not_on_roster') {
    redirect(
      `/auth/login?reset_error=${encodeURIComponent(
        "This email isn't on the club roster. If you're a member, your account may be under a different email — contact the tournament director to check.",
      )}&email=${encodeURIComponent(email)}`,
    )
  }
  if (status === 'no_account') {
    redirect(
      `/auth/signup?email=${encodeURIComponent(email)}&error=${encodeURIComponent(
        "You don't have an account yet — sign up here first.",
      )}`,
    )
  }
  if (status === 'unconfirmed') {
    const { error: resendErr } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: `${await getSiteOrigin()}/auth/callback` },
    })
    if (resendErr) {
      console.error('[requestPasswordReset] resend(signup) failed', {
        email,
        status: resendErr.status,
        code: resendErr.code,
        message: resendErr.message,
      })
      redirect(
        `/auth/login?reset_error=${encodeURIComponent(resendErr.message)}&email=${encodeURIComponent(email)}`,
      )
    }
    redirect('/auth/check-email?resent=1')
  }

  // status === 'confirmed' — do the actual reset.
  // Send the user through our existing OAuth callback so the PKCE code is
  // exchanged into a session, then forward them to the update-password page.
  const redirectTo = `${await getSiteOrigin()}/auth/callback?next=/auth/update-password`
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
  if (error) {
    // Surface real send failures (rate limit, SMTP error, etc.) instead of
    // claiming success — otherwise the user thinks an email is coming and we
    // have no way to debug why it never arrived. The previous catch-it-all
    // "we sent a link" message bit us when Michael Thaler's reset never came.
    console.error('[requestPasswordReset] resetPasswordForEmail failed', {
      email,
      status: error.status,
      code: error.code,
      message: error.message,
    })
    redirect(
      `/auth/login?reset_error=${encodeURIComponent(error.message)}&email=${encodeURIComponent(email)}`,
    )
  }
  redirect(`/auth/login?reset_sent=${encodeURIComponent(email)}`)
}

export async function updatePassword(formData: FormData) {
  const password = String(formData.get('password') ?? '')
  const confirm = String(formData.get('confirm') ?? '')
  if (password.length < 8) {
    redirect('/auth/update-password?error=Password+must+be+at+least+8+characters')
  }
  if (password !== confirm) {
    redirect('/auth/update-password?error=Passwords+do+not+match')
  }
  const supabase = await createClient()
  const { data: userData, error: userErr } = await supabase.auth.getUser()
  if (userErr || !userData.user) {
    redirect('/auth/login?error=Reset+link+expired.+Please+request+a+new+one.')
  }
  const { error } = await supabase.auth.updateUser({ password })
  if (error) {
    redirect(`/auth/update-password?error=${encodeURIComponent(error.message)}`)
  }
  redirect('/?notice=Password+updated')
}
