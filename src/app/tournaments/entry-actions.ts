'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

function backUrl(tid: string, error?: string, ok?: string) {
  const qs = new URLSearchParams()
  if (error) qs.set('error', error)
  if (ok) qs.set('ok', ok)
  const s = qs.toString()
  return `/tournaments/${tid}${s ? `?${s}` : ''}`
}

export async function register(formData: FormData) {
  const tid = String(formData.get('tournament_id') ?? '')
  const supabase = await createClient()
  const { error } = await supabase.rpc('register_for_tournament', {
    p_tournament_id: tid,
  })
  if (error) redirect(backUrl(tid, error.message))
  revalidatePath(`/tournaments/${tid}`)
  revalidatePath('/')
  redirect(backUrl(tid, undefined, 'registered'))
}

export async function registerTeam(formData: FormData) {
  const tid = String(formData.get('tournament_id') ?? '')
  const partnerEmail = String(formData.get('partner_email') ?? '').trim()
  if (!partnerEmail) {
    redirect(backUrl(tid, 'Pick your partner from the suggestions.'))
  }
  const supabase = await createClient()
  const { error } = await supabase.rpc('register_team_for_tournament', {
    p_tournament_id: tid,
    p_partner_email: partnerEmail,
  })
  if (error) redirect(backUrl(tid, error.message))
  revalidatePath(`/tournaments/${tid}`)
  revalidatePath('/')
  redirect(backUrl(tid, undefined, 'invited'))
}

export async function withdrawSelf(formData: FormData) {
  const tid = String(formData.get('tournament_id') ?? '')
  const entryId = String(formData.get('entry_id') ?? '')
  const supabase = await createClient()
  const { error } = await supabase.rpc('withdraw_self', { p_entry_id: entryId })
  if (error) redirect(backUrl(tid, error.message))
  revalidatePath(`/tournaments/${tid}`)
  revalidatePath('/')
  redirect(backUrl(tid, undefined, 'withdrawn'))
}

export async function acceptInvite(formData: FormData) {
  const tid = String(formData.get('tournament_id') ?? '')
  const teamId = String(formData.get('team_id') ?? '')
  const supabase = await createClient()
  const { error } = await supabase.rpc('accept_partner_invite', { p_team_id: teamId })
  if (error) redirect(backUrl(tid, error.message))
  revalidatePath(`/tournaments/${tid}`)
  revalidatePath('/')
  redirect(backUrl(tid, undefined, 'accepted'))
}

export async function declineInvite(formData: FormData) {
  const tid = String(formData.get('tournament_id') ?? '')
  const teamId = String(formData.get('team_id') ?? '')
  const supabase = await createClient()
  const { error } = await supabase.rpc('decline_partner_invite', { p_team_id: teamId })
  if (error) redirect(backUrl(tid, error.message))
  revalidatePath(`/tournaments/${tid}`)
  revalidatePath('/')
  redirect(backUrl(tid, undefined, 'declined'))
}
