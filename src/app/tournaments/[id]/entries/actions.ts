'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

function backUrl(tid: string, error?: string, ok?: string) {
  const qs = new URLSearchParams()
  if (error) qs.set('error', error)
  if (ok) qs.set('ok', ok)
  const s = qs.toString()
  return `/tournaments/${tid}/entries${s ? `?${s}` : ''}`
}

export async function tdEnterMember(formData: FormData) {
  const tid = String(formData.get('tournament_id') ?? '')
  const userId = String(formData.get('user_id') ?? '')
  const bypass = formData.get('bypass') === 'on'
  if (!userId) {
    redirect(backUrl(tid, 'Pick a registered user from the list.'))
  }
  const supabase = await createClient()
  const { error } = await supabase.rpc('td_enter_member', {
    p_tournament_id: tid,
    p_user_id: userId,
    p_bypass_requirements: bypass,
  })
  if (error) redirect(backUrl(tid, error.message))
  revalidatePath(`/tournaments/${tid}`)
  redirect(backUrl(tid, undefined, '1'))
}

export async function tdEnterClubMember(formData: FormData) {
  const tid = String(formData.get('tournament_id') ?? '')
  const clubMemberId = String(formData.get('club_member_id') ?? '')
  const bypass = formData.get('bypass') === 'on'
  if (!clubMemberId) {
    redirect(backUrl(tid, 'Pick a member from the directory list.'))
  }
  const supabase = await createClient()
  const { error } = await supabase.rpc('td_enter_club_member', {
    p_tournament_id: tid,
    p_club_member_id: clubMemberId,
    p_bypass_requirements: bypass,
  })
  if (error) redirect(backUrl(tid, error.message))
  revalidatePath(`/tournaments/${tid}`)
  redirect(backUrl(tid, undefined, '1'))
}

export async function tdEnterTeamFromClubMembers(formData: FormData) {
  const tid = String(formData.get('tournament_id') ?? '')
  const captainId = String(formData.get('captain_club_member_id') ?? '')
  const partnerId = String(formData.get('partner_club_member_id') ?? '')
  const bypass = formData.get('bypass') === 'on'
  if (!captainId || !partnerId) {
    redirect(backUrl(tid, 'Pick both partners from the directory.'))
  }
  if (captainId === partnerId) {
    redirect(backUrl(tid, 'Captain and partner must be different.'))
  }
  const supabase = await createClient()
  const { error } = await supabase.rpc('td_enter_team_from_club_members', {
    p_tournament_id: tid,
    p_captain_club_member_id: captainId,
    p_partner_club_member_id: partnerId,
    p_bypass_requirements: bypass,
  })
  if (error) redirect(backUrl(tid, error.message))
  revalidatePath(`/tournaments/${tid}`)
  redirect(backUrl(tid, undefined, '1'))
}

export async function tdEnterGuest(formData: FormData) {
  const tid = String(formData.get('tournament_id') ?? '')
  const participantId = String(formData.get('participant_id') ?? '')
  const bypass = formData.get('bypass') === 'on'
  if (!participantId) {
    redirect(backUrl(tid, 'Pick a guest from the list.'))
  }
  const supabase = await createClient()
  const { error } = await supabase.rpc('td_enter_guest', {
    p_tournament_id: tid,
    p_participant_id: participantId,
    p_bypass_requirements: bypass,
  })
  if (error) redirect(backUrl(tid, error.message))
  revalidatePath(`/tournaments/${tid}`)
  redirect(backUrl(tid, undefined, '1'))
}

export async function tdWithdrawEntry(formData: FormData) {
  const tid = String(formData.get('tournament_id') ?? '')
  const entryId = String(formData.get('entry_id') ?? '')
  const supabase = await createClient()
  const { error } = await supabase.rpc('td_withdraw_entry', { p_entry_id: entryId })
  if (error) redirect(backUrl(tid, error.message))
  revalidatePath(`/tournaments/${tid}`)
  redirect(backUrl(tid, undefined, '1'))
}

export async function tdRegenerateDraw(formData: FormData) {
  const tid = String(formData.get('tournament_id') ?? '')
  const supabase = await createClient()
  const { error } = await supabase.rpc('td_regenerate_draw', { p_tournament_id: tid })
  if (error) redirect(backUrl(tid, error.message))
  revalidatePath(`/tournaments/${tid}`)
  revalidatePath(`/tournaments/${tid}/draw`)
  redirect(backUrl(tid, undefined, 'regenerated'))
}

export async function tdGenerateDraw(formData: FormData) {
  const tid = String(formData.get('tournament_id') ?? '')
  const supabase = await createClient()
  const { error } = await supabase.rpc('generate_draw', { p_tournament_id: tid })
  if (error) redirect(backUrl(tid, error.message))
  revalidatePath(`/tournaments/${tid}`)
  revalidatePath(`/tournaments/${tid}/draw`)
  redirect(backUrl(tid, undefined, 'generated'))
}
