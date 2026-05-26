'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { parseFlexibleDate } from '@/lib/dates'
import { createClient } from '@/lib/supabase/server'

export async function updateProfile(formData: FormData) {
  const supabase = await createClient()
  const dobRaw = String(formData.get('date_of_birth') ?? '').trim()
  const dob = dobRaw ? parseFlexibleDate(dobRaw) : null
  if (dobRaw && !dob) {
    redirect('/profile?error=Date+of+birth+must+be+MM%2FDD%2FYYYY')
  }
  const { error } = await supabase.rpc('td_update_self_profile', {
    p_full_name: String(formData.get('full_name') ?? ''),
    p_contact_email: String(formData.get('contact_email') ?? ''),
    p_date_of_birth: dob,
  })
  if (error) {
    redirect(`/profile?error=${encodeURIComponent(error.message)}`)
  }
  revalidatePath('/profile')
  redirect('/profile?ok=1')
}

export async function changePassword(formData: FormData) {
  const current = String(formData.get('current_password') ?? '')
  const next = String(formData.get('new_password') ?? '')
  const confirm = String(formData.get('confirm_password') ?? '')
  if (!current) {
    redirect('/profile?error=Enter+your+current+password')
  }
  if (next.length < 8) {
    redirect('/profile?error=New+password+must+be+at+least+8+characters')
  }
  if (next !== confirm) {
    redirect('/profile?error=New+passwords+do+not+match')
  }
  if (next === current) {
    redirect('/profile?error=New+password+must+differ+from+current')
  }
  const supabase = await createClient()
  const { data: userData, error: userErr } = await supabase.auth.getUser()
  if (userErr || !userData.user || !userData.user.email) {
    redirect('/auth/login?error=Please+log+in')
  }
  // Re-verify the current password by attempting a sign-in. This protects
  // against a casual session hijack flipping the password without proof of
  // the original credential.
  const { error: reauthError } = await supabase.auth.signInWithPassword({
    email: userData.user.email,
    password: current,
  })
  if (reauthError) {
    redirect('/profile?error=Current+password+is+incorrect')
  }
  const { error } = await supabase.auth.updateUser({ password: next })
  if (error) {
    redirect(`/profile?error=${encodeURIComponent(error.message)}`)
  }
  redirect('/profile?password_changed=1')
}

export async function updateLoginEmail(formData: FormData) {
  const newEmail = String(formData.get('new_email') ?? '').trim()
  if (!newEmail) {
    redirect('/profile?error=Enter+a+new+email+address')
  }
  const supabase = await createClient()
  const { data: userData, error: userErr } = await supabase.auth.getUser()
  if (userErr || !userData.user) {
    redirect('/auth/login?error=Please+log+in')
  }
  if (userData.user.email?.toLowerCase() === newEmail.toLowerCase()) {
    redirect('/profile?error=That+is+already+your+email')
  }
  // Supabase sends a confirmation link to the new address (and, if Secure
  // Email Change is on, also to the current one). The change is only applied
  // after the link is clicked; our trigger then mirrors it to contact_email.
  // We thread `email_changed=1` through the `next` param so /profile can show
  // a "your login email is now X" banner once the user lands back.
  const next = encodeURIComponent('/profile?email_changed=1')
  const emailRedirectTo = process.env.NEXT_PUBLIC_SITE_URL
    ? `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback?next=${next}`
    : undefined
  const { error } = await supabase.auth.updateUser(
    { email: newEmail },
    { emailRedirectTo },
  )
  if (error) {
    redirect(`/profile?error=${encodeURIComponent(error.message)}`)
  }
  redirect(`/profile?email_change_sent=${encodeURIComponent(newEmail)}`)
}
