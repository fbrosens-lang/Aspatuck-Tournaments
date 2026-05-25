'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

function s(v: FormDataEntryValue | null) {
  return v === null ? '' : String(v).trim()
}

export async function createMember(formData: FormData) {
  const supabase = await createClient()
  const { error } = await supabase.rpc('td_create_club_member', {
    p_full_name: s(formData.get('full_name')),
    p_email: s(formData.get('email')),
    p_date_of_birth: s(formData.get('date_of_birth')) || null,
    p_notes: s(formData.get('notes')),
  })
  if (error) redirect(`/members?error=${encodeURIComponent(error.message)}`)
  revalidatePath('/members')
  redirect('/members?ok=created')
}

export async function updateMember(formData: FormData) {
  const id = s(formData.get('id'))
  const supabase = await createClient()
  const { error } = await supabase.rpc('td_update_club_member', {
    p_id: id,
    p_full_name: s(formData.get('full_name')),
    p_email: s(formData.get('email')),
    p_date_of_birth: s(formData.get('date_of_birth')) || null,
    p_notes: s(formData.get('notes')),
  })
  if (error) redirect(`/members?error=${encodeURIComponent(error.message)}`)
  revalidatePath('/members')
  redirect('/members?ok=updated')
}

export async function deleteMember(formData: FormData) {
  const id = s(formData.get('id'))
  const supabase = await createClient()
  const { error } = await supabase.rpc('td_delete_club_member', { p_id: id })
  if (error) redirect(`/members?error=${encodeURIComponent(error.message)}`)
  revalidatePath('/members')
  redirect('/members?ok=deleted')
}
