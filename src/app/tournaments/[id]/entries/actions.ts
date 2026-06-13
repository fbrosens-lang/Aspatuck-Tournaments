'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { parseFlexibleDate } from '@/lib/dates'
import { createClient } from '@/lib/supabase/server'

function backUrl(tid: string, error?: string, ok?: string) {
  const qs = new URLSearchParams()
  if (error) qs.set('error', error)
  if (ok) qs.set('ok', ok)
  const s = qs.toString()
  return `/tournaments/${tid}/entries${s ? `?${s}` : ''}`
}

function addedOk(name: string) {
  // Embed the display name in the ok param so the page can render
  // "Added <name> to the roster." instead of a bland "Saved."
  return `added:${encodeURIComponent(name)}`
}

function addedPostDrawOk(name: string) {
  // Signal that the entry landed in a tournament whose bracket is already
  // built — the page renders an amber banner with a link to the Draw
  // page so the TD knows the player still needs a bracket position.
  return `added_post_draw:${encodeURIComponent(name)}`
}

async function tournamentHasDraw(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tid: string,
): Promise<boolean> {
  const { count } = await supabase
    .from('matches')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', tid)
  return (count ?? 0) > 0
}

async function pickAddedOk(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tid: string,
  name: string,
): Promise<string> {
  return (await tournamentHasDraw(supabase, tid))
    ? addedPostDrawOk(name)
    : addedOk(name)
}

export async function tdEnterMember(formData: FormData) {
  const tid = String(formData.get('tournament_id') ?? '')
  const userId = String(formData.get('user_id') ?? '')
  if (!userId) {
    redirect(backUrl(tid, 'Pick a registered user from the list.'))
  }
  const supabase = await createClient()
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', userId)
    .maybeSingle()
  const { error } = await supabase.rpc('td_enter_member', {
    p_tournament_id: tid,
    p_user_id: userId,
    p_bypass_requirements: true,
  })
  if (error) redirect(backUrl(tid, error.message))
  const ok = await pickAddedOk(supabase, tid, profile?.full_name ?? 'Entry')
  revalidatePath(`/tournaments/${tid}`)
  revalidatePath(`/tournaments/${tid}/entries`)
  redirect(backUrl(tid, undefined, ok))
}

/**
 * TD-only: pair two solo entries into a confirmed team entry. Used to
 * resolve the "I'll sign up alone, find me a partner" flow that lets
 * players join a doubles tournament without already having a partner
 * lined up. The RPC builds the team auto-accepted (since the TD is
 * acting on behalf of both players) and consumes both solo entries.
 */
export async function tdPairSoloEntries(formData: FormData) {
  const tid = String(formData.get('tournament_id') ?? '')
  const a = String(formData.get('entry_a_id') ?? '')
  const b = String(formData.get('entry_b_id') ?? '')
  if (!a || !b) {
    redirect(backUrl(tid, 'Pick two unpaired players.'))
  }
  if (a === b) {
    redirect(backUrl(tid, 'Pick two different players.'))
  }
  const hcpRaw = String(formData.get('handicap') ?? '').trim()
  let handicap: number | null = null
  if (hcpRaw !== '') {
    const n = Number(hcpRaw)
    if (!Number.isInteger(n) || n < -20 || n > 20) {
      redirect(backUrl(tid, 'Handicap must be an integer between -20 and 20.'))
    }
    handicap = n
  }
  const supabase = await createClient()
  const { error } = await supabase.rpc('td_pair_solo_entries', {
    p_tournament_id: tid,
    p_entry_a_id: a,
    p_entry_b_id: b,
    p_handicap: handicap,
  })
  if (error) redirect(backUrl(tid, error.message))
  revalidatePath(`/tournaments/${tid}`)
  revalidatePath(`/tournaments/${tid}/entries`)
  redirect(backUrl(tid, undefined, 'paired'))
}

export async function tdEnterClubMember(formData: FormData) {
  const tid = String(formData.get('tournament_id') ?? '')
  const clubMemberId = String(formData.get('club_member_id') ?? '')
  if (!clubMemberId) {
    redirect(backUrl(tid, 'Pick a member from the directory list.'))
  }
  const supabase = await createClient()
  const { data: cm } = await supabase
    .from('club_members')
    .select('full_name')
    .eq('id', clubMemberId)
    .maybeSingle()
  const { error } = await supabase.rpc('td_enter_club_member', {
    p_tournament_id: tid,
    p_club_member_id: clubMemberId,
    p_bypass_requirements: true,
  })
  if (error) redirect(backUrl(tid, error.message))
  const ok = await pickAddedOk(supabase, tid, cm?.full_name ?? 'Entry')
  revalidatePath(`/tournaments/${tid}`)
  revalidatePath(`/tournaments/${tid}/entries`)
  redirect(backUrl(tid, undefined, ok))
}

export async function tdEnterSoloInDoubles(formData: FormData) {
  const tid = String(formData.get('tournament_id') ?? '')
  const clubMemberId = String(formData.get('club_member_id') ?? '')
  if (!clubMemberId) {
    redirect(backUrl(tid, 'Pick a member from the directory list.'))
  }
  const supabase = await createClient()
  const { data: cm } = await supabase
    .from('club_members')
    .select('full_name')
    .eq('id', clubMemberId)
    .maybeSingle()
  const { error } = await supabase.rpc('td_enter_solo_member_in_doubles', {
    p_tournament_id: tid,
    p_club_member_id: clubMemberId,
    p_bypass_requirements: true,
  })
  if (error) redirect(backUrl(tid, error.message))
  revalidatePath(`/tournaments/${tid}`)
  revalidatePath(`/tournaments/${tid}/entries`)
  // Solo entries can't be drawn until they're paired with another solo,
  // so the standard post-draw "drop into a bye slot" banner is misleading.
  // Use a dedicated ok param that points the TD at the Unpaired pairing
  // UI below.
  const name = cm?.full_name ?? 'Player'
  redirect(backUrl(tid, undefined, `added_solo:${encodeURIComponent(name)}`))
}

export async function tdEnterTeamFromClubMembers(formData: FormData) {
  const tid = String(formData.get('tournament_id') ?? '')
  const captainId = String(formData.get('captain_club_member_id') ?? '')
  const partnerId = String(formData.get('partner_club_member_id') ?? '')
  if (!captainId || !partnerId) {
    redirect(backUrl(tid, 'Pick both partners from the directory.'))
  }
  if (captainId === partnerId) {
    redirect(backUrl(tid, 'Captain and partner must be different.'))
  }
  const supabase = await createClient()
  const { data: cms } = await supabase
    .from('club_members')
    .select('id, full_name')
    .in('id', [captainId, partnerId])
  const captainName = cms?.find((m) => m.id === captainId)?.full_name ?? 'captain'
  const partnerName = cms?.find((m) => m.id === partnerId)?.full_name ?? 'partner'
  const { error } = await supabase.rpc('td_enter_team_from_club_members', {
    p_tournament_id: tid,
    p_captain_club_member_id: captainId,
    p_partner_club_member_id: partnerId,
    p_bypass_requirements: true,
  })
  if (error) redirect(backUrl(tid, error.message))
  const ok = await pickAddedOk(supabase, tid, `${captainName} & ${partnerName}`)
  revalidatePath(`/tournaments/${tid}`)
  revalidatePath(`/tournaments/${tid}/entries`)
  redirect(backUrl(tid, undefined, ok))
}

export async function tdEnterGuest(formData: FormData) {
  const tid = String(formData.get('tournament_id') ?? '')
  const participantId = String(formData.get('participant_id') ?? '')
  if (!participantId) {
    redirect(backUrl(tid, 'Pick a guest from the list.'))
  }
  const supabase = await createClient()
  const { data: part } = await supabase
    .from('participants')
    .select('display_name')
    .eq('id', participantId)
    .maybeSingle()
  const { error } = await supabase.rpc('td_enter_guest', {
    p_tournament_id: tid,
    p_participant_id: participantId,
    p_bypass_requirements: true,
  })
  if (error) redirect(backUrl(tid, error.message))
  const ok = await pickAddedOk(supabase, tid, part?.display_name ?? 'Guest')
  revalidatePath(`/tournaments/${tid}`)
  revalidatePath(`/tournaments/${tid}/entries`)
  redirect(backUrl(tid, undefined, ok))
}

export async function tdAddAndEnterGuest(formData: FormData) {
  const tid = String(formData.get('tournament_id') ?? '')
  const name = String(formData.get('name') ?? '').trim()
  const email = String(formData.get('email') ?? '').trim()
  const dobRaw = String(formData.get('dob') ?? '').trim()
  if (!name) {
    redirect(backUrl(tid, 'Guest name is required.'))
  }
  const dob = dobRaw ? parseFlexibleDate(dobRaw) : null
  if (dobRaw && !dob) {
    redirect(backUrl(tid, 'Date of birth must be MM/DD/YYYY'))
  }
  const supabase = await createClient()
  const { data: newParticipantId, error: addErr } = await supabase.rpc(
    'td_add_guest_participant',
    {
      p_tournament_id: tid,
      p_name: name,
      p_email: email,
      p_dob: dob,
    },
  )
  if (addErr) redirect(backUrl(tid, addErr.message))
  const { error: enterErr } = await supabase.rpc('td_enter_guest', {
    p_tournament_id: tid,
    p_participant_id: newParticipantId as string,
    p_bypass_requirements: true,
  })
  if (enterErr) redirect(backUrl(tid, enterErr.message))
  const ok = await pickAddedOk(supabase, tid, name)
  revalidatePath(`/tournaments/${tid}`)
  revalidatePath(`/tournaments/${tid}/entries`)
  redirect(backUrl(tid, undefined, ok))
}

export async function tdAcceptTeamInvite(formData: FormData) {
  const tid = String(formData.get('tournament_id') ?? '')
  const teamId = String(formData.get('team_id') ?? '')
  if (!teamId) redirect(backUrl(tid, 'Missing team id.'))
  const supabase = await createClient()
  const { error } = await supabase.rpc('td_accept_team_invite', { p_team_id: teamId })
  if (error) redirect(backUrl(tid, error.message))
  revalidatePath(`/tournaments/${tid}`)
  redirect(backUrl(tid, undefined, 'team_accepted'))
}

export async function tdDeclineTeamInvite(formData: FormData) {
  const tid = String(formData.get('tournament_id') ?? '')
  const teamId = String(formData.get('team_id') ?? '')
  if (!teamId) redirect(backUrl(tid, 'Missing team id.'))
  const supabase = await createClient()
  const { error } = await supabase.rpc('td_decline_team_invite', { p_team_id: teamId })
  if (error) redirect(backUrl(tid, error.message))
  revalidatePath(`/tournaments/${tid}`)
  redirect(backUrl(tid, undefined, 'team_declined'))
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

export async function tdClearDraw(formData: FormData) {
  const tid = String(formData.get('tournament_id') ?? '')
  const supabase = await createClient()
  const { error } = await supabase.rpc('td_clear_draw', { p_tournament_id: tid })
  if (error) redirect(backUrl(tid, error.message))
  revalidatePath(`/tournaments/${tid}`)
  revalidatePath(`/tournaments/${tid}/draw`)
  redirect(backUrl(tid, undefined, 'cleared'))
}

export async function setSeedsVisibility(formData: FormData) {
  const tid = String(formData.get('tournament_id') ?? '')
  const show = formData.get('show_seeds_publicly') === 'on'
  const returnTo = formData.get('return_to') === 'manage' ? 'manage' : 'entries'
  const supabase = await createClient()
  const { error } = await supabase.rpc('td_set_show_seeds_publicly', {
    p_tournament_id: tid,
    p_show: show,
  })
  const ok = show ? 'seeds_shown' : 'seeds_hidden'
  const back =
    returnTo === 'manage'
      ? `/tournaments/${tid}/manage`
      : `/tournaments/${tid}/entries`
  if (error) {
    redirect(`${back}?error=${encodeURIComponent(error.message)}`)
  }
  revalidatePath(`/tournaments/${tid}`)
  revalidatePath(`/tournaments/${tid}/entries`)
  revalidatePath(`/tournaments/${tid}/manage`)
  redirect(`${back}?ok=${ok}`)
}

export async function saveSeeds(formData: FormData) {
  const tid = String(formData.get('tournament_id') ?? '')
  const seeds: { entry_id: string; seed: number | null }[] = []
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith('seed_')) continue
    const entryId = key.slice('seed_'.length)
    const raw = String(value).trim()
    if (raw === '') {
      seeds.push({ entry_id: entryId, seed: null })
      continue
    }
    const n = Number(raw)
    if (!Number.isInteger(n) || n < 1) {
      redirect(backUrl(tid, `seed "${raw}" must be a positive integer`))
    }
    seeds.push({ entry_id: entryId, seed: n })
  }
  const supabase = await createClient()
  const { error } = await supabase.rpc('td_set_entry_seeds', {
    p_tournament_id: tid,
    p_seeds: seeds,
  })
  if (error) redirect(backUrl(tid, error.message))
  revalidatePath(`/tournaments/${tid}`)
  revalidatePath(`/tournaments/${tid}/entries`)
  revalidatePath(`/tournaments/${tid}/draw`)
  redirect(backUrl(tid, undefined, 'seeded'))
}

export async function saveTeamHandicaps(formData: FormData) {
  const tid = String(formData.get('tournament_id') ?? '')
  const handicaps: { team_id: string; handicap: number | null }[] = []
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith('hcp_')) continue
    const teamId = key.slice('hcp_'.length)
    const raw = String(value).trim()
    if (raw === '') {
      handicaps.push({ team_id: teamId, handicap: null })
      continue
    }
    const n = Number(raw)
    if (!Number.isInteger(n) || n < -20 || n > 20) {
      redirect(backUrl(tid, `handicap "${raw}" must be an integer between -20 and 20`))
    }
    handicaps.push({ team_id: teamId, handicap: n })
  }
  const supabase = await createClient()
  const { error } = await supabase.rpc('td_set_team_handicaps', {
    p_tournament_id: tid,
    p_handicaps: handicaps,
  })
  if (error) redirect(backUrl(tid, error.message))
  revalidatePath(`/tournaments/${tid}`)
  revalidatePath(`/tournaments/${tid}/entries`)
  revalidatePath(`/tournaments/${tid}/draw`)
  redirect(backUrl(tid, undefined, 'handicaps_saved'))
}

export async function tdClearSeeds(formData: FormData) {
  const tid = String(formData.get('tournament_id') ?? '')
  const supabase = await createClient()
  const { error } = await supabase.rpc('td_clear_entry_seeds', {
    p_tournament_id: tid,
  })
  if (error) redirect(backUrl(tid, error.message))
  revalidatePath(`/tournaments/${tid}`)
  revalidatePath(`/tournaments/${tid}/entries`)
  revalidatePath(`/tournaments/${tid}/draw`)
  redirect(backUrl(tid, undefined, 'seeds_cleared'))
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
