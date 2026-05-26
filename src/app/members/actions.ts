'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { parseFlexibleDate } from '@/lib/dates'
import { createClient } from '@/lib/supabase/server'

function s(v: FormDataEntryValue | null) {
  return v === null ? '' : String(v).trim()
}

/** Returns the parsed ISO date, or `false` if the user typed something we
 * couldn't parse (so the caller can return a friendly error). Empty input
 * returns null. */
function parseDob(raw: string): string | null | false {
  if (!raw) return null
  const parsed = parseFlexibleDate(raw)
  return parsed ?? false
}

export async function createMember(formData: FormData) {
  const supabase = await createClient()
  const dob = parseDob(s(formData.get('date_of_birth')))
  if (dob === false) {
    redirect('/members?error=Date+of+birth+must+be+MM%2FDD%2FYYYY')
  }
  const { error } = await supabase.rpc('td_create_club_member', {
    p_full_name: s(formData.get('full_name')),
    p_email: s(formData.get('email')),
    p_date_of_birth: dob,
    p_notes: s(formData.get('notes')),
  })
  if (error) redirect(`/members?error=${encodeURIComponent(error.message)}`)
  revalidatePath('/members')
  redirect('/members?ok=created')
}

export async function updateMember(formData: FormData) {
  const id = s(formData.get('id'))
  const supabase = await createClient()
  const dob = parseDob(s(formData.get('date_of_birth')))
  if (dob === false) {
    redirect('/members?error=Date+of+birth+must+be+MM%2FDD%2FYYYY')
  }
  const { error } = await supabase.rpc('td_update_club_member', {
    p_id: id,
    p_full_name: s(formData.get('full_name')),
    p_email: s(formData.get('email')),
    p_date_of_birth: dob,
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

export async function linkMemberToAccount(formData: FormData) {
  const clubMemberId = s(formData.get('club_member_id'))
  const userId = s(formData.get('user_id'))
  if (!clubMemberId) {
    redirect('/members?error=Missing+directory+entry')
  }
  if (!userId) {
    redirect('/members?error=Pick+an+account+from+the+list')
  }
  const supabase = await createClient()
  const { error } = await supabase.rpc('td_link_club_member_to_profile', {
    p_club_member_id: clubMemberId,
    p_user_id: userId,
  })
  if (error) redirect(`/members?error=${encodeURIComponent(error.message)}`)
  revalidatePath('/members')
  redirect('/members?ok=linked')
}

export async function unlinkMember(formData: FormData) {
  const clubMemberId = s(formData.get('club_member_id'))
  if (!clubMemberId) {
    redirect('/members?error=Missing+directory+entry')
  }
  const supabase = await createClient()
  const { error } = await supabase.rpc('td_unlink_club_member', {
    p_club_member_id: clubMemberId,
  })
  if (error) redirect(`/members?error=${encodeURIComponent(error.message)}`)
  revalidatePath('/members')
  redirect('/members?ok=unlinked')
}

export async function deleteOrphanProfile(formData: FormData) {
  const userId = s(formData.get('user_id'))
  if (!userId) {
    redirect('/members?error=Missing+account')
  }
  const supabase = await createClient()
  const { error } = await supabase.rpc('td_delete_orphan_profile', {
    p_user_id: userId,
  })
  if (error) redirect(`/members?error=${encodeURIComponent(error.message)}`)
  revalidatePath('/members')
  redirect('/members?ok=account_deleted')
}
