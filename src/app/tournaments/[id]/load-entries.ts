import { createClient } from '@/lib/supabase/server'
import type { MyEntryState } from '@/components/RegisterButton'

export type EntryRow = {
  id: string
  status: string
  seed: number | null
  participant_id: string | null
  team_id: string | null
  added_by_td_id: string | null
  display: string
}

export async function loadEntriesForTournament(tournamentId: string): Promise<EntryRow[]> {
  const supabase = await createClient()
  const { data: entries } = await supabase
    .from('entries')
    .select('id, status, seed, participant_id, team_id, added_by_td_id, created_at')
    .eq('tournament_id', tournamentId)
    .neq('status', 'withdrawn')
    .order('seed', { ascending: true, nullsFirst: false })
    .order('created_at')
  if (!entries) return []

  const participantIds = new Set<string>()
  const teamIds: string[] = []
  for (const e of entries) {
    if (e.participant_id) participantIds.add(e.participant_id)
    if (e.team_id) teamIds.push(e.team_id)
  }

  const { data: teams } = teamIds.length
    ? await supabase
        .from('teams')
        .select('id, captain_participant_id, partner_participant_id')
        .in('id', teamIds)
    : { data: [] }
  for (const t of teams ?? []) {
    participantIds.add(t.captain_participant_id)
    if (t.partner_participant_id) participantIds.add(t.partner_participant_id)
  }

  const { data: participants } = participantIds.size
    ? await supabase
        .from('participants')
        .select('id, display_name, kind')
        .in('id', Array.from(participantIds))
    : { data: [] }
  const partById = new Map((participants ?? []).map((p) => [p.id, p]))
  const teamById = new Map((teams ?? []).map((t) => [t.id, t]))

  return entries.map((e) => {
    let display = '—'
    if (e.participant_id) {
      display = partById.get(e.participant_id)?.display_name ?? '—'
    } else if (e.team_id) {
      const t = teamById.get(e.team_id)
      const cap = t ? partById.get(t.captain_participant_id)?.display_name ?? '?' : '?'
      const par = t?.partner_participant_id
        ? partById.get(t.partner_participant_id)?.display_name ?? '?'
        : '(unassigned)'
      display = `${cap} / ${par}`
    }
    return {
      id: e.id,
      status: e.status,
      seed: e.seed,
      participant_id: e.participant_id,
      team_id: e.team_id,
      added_by_td_id: e.added_by_td_id,
      display,
    }
  })
}

export async function loadMyEntryState(
  tournamentId: string,
  userId: string,
): Promise<MyEntryState> {
  const supabase = await createClient()

  const { data: participant } = await supabase
    .from('participants')
    .select('id')
    .eq('tournament_id', tournamentId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!participant) return { kind: 'none' }

  const { data: singlesEntry } = await supabase
    .from('entries')
    .select('id, status')
    .eq('tournament_id', tournamentId)
    .eq('participant_id', participant.id)
    .neq('status', 'withdrawn')
    .maybeSingle()
  if (singlesEntry) {
    return { kind: 'singles', entryId: singlesEntry.id, status: singlesEntry.status }
  }

  const { data: teams } = await supabase
    .from('teams')
    .select('id, captain_participant_id, partner_participant_id, invite_status')
    .eq('tournament_id', tournamentId)
    .or(`captain_participant_id.eq.${participant.id},partner_participant_id.eq.${participant.id}`)
  if (!teams || teams.length === 0) return { kind: 'none' }

  for (const team of teams) {
    const { data: entry } = await supabase
      .from('entries')
      .select('id, status')
      .eq('tournament_id', tournamentId)
      .eq('team_id', team.id)
      .neq('status', 'withdrawn')
      .maybeSingle()
    if (!entry) continue

    const role: 'captain' | 'partner' =
      team.captain_participant_id === participant.id ? 'captain' : 'partner'
    const otherId =
      role === 'captain' ? team.partner_participant_id : team.captain_participant_id
    let otherName: string | null = null
    if (otherId) {
      const { data: other } = await supabase
        .from('participants')
        .select('display_name')
        .eq('id', otherId)
        .maybeSingle()
      otherName = other?.display_name ?? null
    }
    return {
      kind: 'team',
      role,
      entryId: entry.id,
      entryStatus: entry.status,
      teamId: team.id,
      inviteStatus: team.invite_status as 'pending' | 'accepted' | 'declined',
      otherName,
    }
  }
  return { kind: 'none' }
}
