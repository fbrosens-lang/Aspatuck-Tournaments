'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

function backUrl(tid: string, error?: string, ok?: string) {
  const qs = new URLSearchParams()
  if (error) qs.set('error', error)
  if (ok) qs.set('ok', ok)
  const s = qs.toString()
  return `/tournaments/${tid}/draw${s ? `?${s}` : ''}`
}

export async function generateDraw(formData: FormData) {
  const tid = String(formData.get('tournament_id') ?? '')
  const supabase = await createClient()
  const { error } = await supabase.rpc('generate_draw', { p_tournament_id: tid })
  if (error) redirect(backUrl(tid, error.message))
  revalidatePath(`/tournaments/${tid}`)
  revalidatePath(`/tournaments/${tid}/draw`)
  redirect(backUrl(tid, undefined, 'generated'))
}

export async function regenerateDraw(formData: FormData) {
  const tid = String(formData.get('tournament_id') ?? '')
  const supabase = await createClient()
  const { error } = await supabase.rpc('td_regenerate_draw', { p_tournament_id: tid })
  if (error) redirect(backUrl(tid, error.message))
  revalidatePath(`/tournaments/${tid}`)
  revalidatePath(`/tournaments/${tid}/draw`)
  redirect(backUrl(tid, undefined, 'regenerated'))
}

export async function publishDraw(formData: FormData) {
  const tid = String(formData.get('tournament_id') ?? '')
  const supabase = await createClient()
  const { error } = await supabase.rpc('publish_draw', { p_tournament_id: tid })
  if (error) redirect(backUrl(tid, error.message))
  revalidatePath(`/tournaments/${tid}`)
  revalidatePath(`/tournaments/${tid}/draw`)
  redirect(backUrl(tid, undefined, 'published'))
}

export async function swapEntries(formData: FormData) {
  const tid = String(formData.get('tournament_id') ?? '')
  const a = String(formData.get('entry_a') ?? '')
  const b = String(formData.get('entry_b') ?? '')
  if (!a || !b || a === b) redirect(backUrl(tid, 'pick two different entries'))
  const supabase = await createClient()
  const { error } = await supabase.rpc('td_swap_entries', { p_entry_a: a, p_entry_b: b })
  if (error) redirect(backUrl(tid, error.message))
  revalidatePath(`/tournaments/${tid}`)
  revalidatePath(`/tournaments/${tid}/draw`)
  redirect(backUrl(tid, undefined, 'swapped'))
}

export async function replaceParticipant(formData: FormData) {
  const tid = String(formData.get('tournament_id') ?? '')
  const entryId = String(formData.get('entry_id') ?? '')
  const newParticipantId = String(formData.get('new_participant_id') ?? '')
  const supabase = await createClient()
  const { error } = await supabase.rpc('td_replace_participant', {
    p_entry_id: entryId,
    p_new_participant_id: newParticipantId,
  })
  if (error) redirect(backUrl(tid, error.message))
  revalidatePath(`/tournaments/${tid}`)
  revalidatePath(`/tournaments/${tid}/draw`)
  redirect(backUrl(tid, undefined, 'replaced'))
}

// Note: the setSeeds action lived here when the Seeds form was on /draw.
// It's now on /entries as saveSeeds (in entries/actions.ts) so the TD
// can seed in the same place they manage the roster.

export async function substituteFromDirectory(formData: FormData) {
  const tid = String(formData.get('tournament_id') ?? '')
  const entryId = String(formData.get('entry_id') ?? '')
  const clubMemberId = String(formData.get('club_member_id') ?? '')
  const bypass = formData.get('bypass') === 'on'
  const supabase = await createClient()
  const { error } = await supabase.rpc('td_substitute_with_club_member', {
    p_entry_id: entryId,
    p_club_member_id: clubMemberId,
    p_bypass_requirements: bypass,
  })
  if (error) redirect(backUrl(tid, error.message))
  revalidatePath(`/tournaments/${tid}`)
  revalidatePath(`/tournaments/${tid}/draw`)
  redirect(backUrl(tid, undefined, 'substituted'))
}

/**
 * Adds a brand-new player into an existing R1 bye slot, turning what
 * would have been a free pass into a real first-round match. The bye
 * winner's auto-advance into R2 is unwound by the RPC. The action just
 * wires the form values through and surfaces the RPC's error message
 * verbatim (which already includes friendly text like "already played
 * in a later round — withdraw and regenerate instead").
 */
export async function fillByeSlot(formData: FormData) {
  const tid = String(formData.get('tournament_id') ?? '')
  const matchId = String(formData.get('match_id') ?? '')
  const clubMemberId = String(formData.get('club_member_id') ?? '')
  if (!matchId || !clubMemberId) {
    redirect(backUrl(tid, 'Pick a player and a bye slot.'))
  }
  const supabase = await createClient()
  const { error } = await supabase.rpc('td_add_player_to_bye_slot', {
    p_tournament_id: tid,
    p_club_member_id: clubMemberId,
    p_match_id: matchId,
  })
  if (error) redirect(backUrl(tid, error.message))
  revalidatePath(`/tournaments/${tid}`)
  revalidatePath(`/tournaments/${tid}/draw`)
  revalidatePath(`/tournaments/${tid}/entries`)
  redirect(backUrl(tid, undefined, 'bye_filled'))
}

/**
 * Doubles twin of fillByeSlot: drops a brand-new team into a R1 bye slot,
 * creating the team + entry as part of the same transaction. See the
 * comment on fillByeSlot for the bracket-unwind semantics.
 */
export async function fillByeSlotTeam(formData: FormData) {
  const tid = String(formData.get('tournament_id') ?? '')
  const matchId = String(formData.get('match_id') ?? '')
  const captainId = String(formData.get('captain_club_member_id') ?? '')
  const partnerId = String(formData.get('partner_club_member_id') ?? '')
  if (!matchId || !captainId || !partnerId) {
    redirect(backUrl(tid, 'Pick both partners and a bye slot.'))
  }
  if (captainId === partnerId) {
    redirect(backUrl(tid, 'Captain and partner must be different.'))
  }
  const supabase = await createClient()
  const { error } = await supabase.rpc('td_add_team_to_bye_slot', {
    p_tournament_id: tid,
    p_captain_club_member_id: captainId,
    p_partner_club_member_id: partnerId,
    p_match_id: matchId,
  })
  if (error) redirect(backUrl(tid, error.message))
  revalidatePath(`/tournaments/${tid}`)
  revalidatePath(`/tournaments/${tid}/draw`)
  revalidatePath(`/tournaments/${tid}/entries`)
  redirect(backUrl(tid, undefined, 'bye_filled'))
}
