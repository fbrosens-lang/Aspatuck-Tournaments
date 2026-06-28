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
 * Doubles equivalent of fillByeSlot: pairs two players AND drops the
 * resulting team into a first-round bye in one atomic call. Each side
 * (captain, partner) can be picked as either a brand-new club-directory
 * member OR an existing unpaired roster entry. The form encodes each
 * side as a single value of the form "cm:<uuid>" or "ue:<uuid>" so the
 * picker can hand back either kind from one Combobox without separate
 * hidden fields per branch. Handicap input is forwarded but the RPC
 * rejects non-null values outside Calcutta (solo_only doubles).
 */
export async function fillByeSlotPairTeam(formData: FormData) {
  const tid = String(formData.get('tournament_id') ?? '')
  const matchId = String(formData.get('match_id') ?? '')
  const captainRef = String(formData.get('captain_ref') ?? '')
  const partnerRef = String(formData.get('partner_ref') ?? '')
  const handicapRaw = String(formData.get('handicap') ?? '').trim()

  if (!matchId || !captainRef || !partnerRef) {
    redirect(backUrl(tid, 'Pick a captain, a partner, and a bye slot.'))
  }
  if (captainRef === partnerRef) {
    redirect(backUrl(tid, 'Captain and partner must be different.'))
  }
  const cap = parsePickerRef(captainRef)
  const par = parsePickerRef(partnerRef)
  if (!cap || !par) {
    redirect(backUrl(tid, 'Invalid picker selection.'))
  }

  let handicap: number | null = null
  if (handicapRaw !== '') {
    const n = Number(handicapRaw)
    if (!Number.isInteger(n) || n < -40 || n > 40) {
      redirect(backUrl(tid, 'Handicap must be a whole number from -40 to 40.'))
    }
    handicap = n
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc('td_pair_team_into_bye_slot', {
    p_tournament_id: tid,
    p_match_id: matchId,
    p_captain_club_member_id: cap.kind === 'cm' ? cap.id : null,
    p_captain_unpaired_entry_id: cap.kind === 'ue' ? cap.id : null,
    p_partner_club_member_id: par.kind === 'cm' ? par.id : null,
    p_partner_unpaired_entry_id: par.kind === 'ue' ? par.id : null,
    p_handicap: handicap,
  })
  if (error) redirect(backUrl(tid, error.message))
  revalidatePath(`/tournaments/${tid}`)
  revalidatePath(`/tournaments/${tid}/draw`)
  revalidatePath(`/tournaments/${tid}/entries`)
  redirect(backUrl(tid, undefined, 'bye_filled'))
}

function parsePickerRef(raw: string): { kind: 'cm' | 'ue'; id: string } | null {
  const m = /^(cm|ue):([0-9a-f-]{36})$/i.exec(raw)
  if (!m) return null
  return { kind: m[1] as 'cm' | 'ue', id: m[2] }
}
