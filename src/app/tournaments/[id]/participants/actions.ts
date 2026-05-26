'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { parseFlexibleDate } from '@/lib/dates'
import { createClient } from '@/lib/supabase/server'

export async function addGuest(formData: FormData) {
  const tournamentId = String(formData.get('tournament_id') ?? '')
  const name = String(formData.get('name') ?? '').trim()
  const email = String(formData.get('email') ?? '').trim()
  const dobRaw = String(formData.get('dob') ?? '').trim()
  const dob = dobRaw ? parseFlexibleDate(dobRaw) : null
  if (dobRaw && !dob) {
    redirect(
      `/tournaments/${tournamentId}/participants?error=Date+of+birth+must+be+MM%2FDD%2FYYYY`,
    )
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc('td_add_guest_participant', {
    p_tournament_id: tournamentId,
    p_name: name,
    p_email: email,
    p_dob: dob,
  })
  if (error) {
    redirect(
      `/tournaments/${tournamentId}/participants?error=${encodeURIComponent(error.message)}`,
    )
  }
  revalidatePath(`/tournaments/${tournamentId}/participants`)
  redirect(`/tournaments/${tournamentId}/participants?ok=1`)
}
