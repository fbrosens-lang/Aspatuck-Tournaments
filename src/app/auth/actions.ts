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

export async function signup(formData: FormData) {
  const email = String(formData.get('email') ?? '')
  const password = String(formData.get('password') ?? '')
  const fullName = String(formData.get('full_name') ?? '').trim()
  if (!fullName) {
    redirect('/auth/signup?error=Full+name+is+required')
  }
  const supabase = await createClient()

  // The club's policy is "only directory members can self-sign-up; the TD
  // adds people to the directory first." Anyone whose email isn't on the
  // roster is bounced to a message explaining how to get added. This both
  // closes the duplicate-account loophole (Johnny vs John Brosens) and keeps
  // strangers from ever showing up in /admin.
  const { data: allowed } = await supabase.rpc('signup_allowed_for_email', {
    p_email: email,
  })
  if (!allowed) {
    redirect(
      `/auth/signup?error=${encodeURIComponent(
        "This email isn't on the club roster. If you're a member, please sign up with the email the tournament director has on file (or ask them to update it). If you're not a member yet, please contact the tournament director to be added first.",
      )}`,
    )
  }

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
  // Send the user through our existing OAuth callback so the PKCE code is
  // exchanged into a session, then forward them to the update-password page.
  const redirectTo = `${await getSiteOrigin()}/auth/callback?next=/auth/update-password`
  await supabase.auth.resetPasswordForEmail(email, { redirectTo })
  // Confirm to the user regardless of whether the account exists. Supabase's
  // API doesn't reveal account existence either way, so this is safe.
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
