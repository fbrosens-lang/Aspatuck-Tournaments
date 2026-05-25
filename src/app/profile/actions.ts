'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export async function updateProfile(formData: FormData) {
  const supabase = await createClient()
  const { error } = await supabase.rpc('td_update_self_profile', {
    p_full_name: String(formData.get('full_name') ?? ''),
    p_contact_email: String(formData.get('contact_email') ?? ''),
    p_date_of_birth: String(formData.get('date_of_birth') ?? '').trim() || null,
  })
  if (error) {
    redirect(`/profile?error=${encodeURIComponent(error.message)}`)
  }
  revalidatePath('/profile')
  redirect('/profile?ok=1')
}
