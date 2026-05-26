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
  const email = String(formData.get('email') ?? '')
  const password = String(formData.get('password') ?? '')
  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    redirect(`/auth/login?error=${encodeURIComponent(error.message)}`)
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

  // Block accidental duplicate sign-ups: someone using a new email but the
  // same name as an existing account would otherwise quietly create a second
  // user. The RPC allows the signup when the email is already in the club
  // directory (the TD has explicitly added that person under that email).
  const { data: collides } = await supabase.rpc('signup_name_collides', {
    p_full_name: fullName,
    p_email: email,
  })
  if (collides) {
    redirect(
      `/auth/signup?error=${encodeURIComponent(
        "A user with this name already exists. Please log in with the email it was created under (use 'Forgot password?' if you don't remember), or contact the tournament director if you need help.",
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
