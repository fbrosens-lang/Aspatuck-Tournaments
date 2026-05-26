'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

function str(v: FormDataEntryValue | null) {
  return v === null ? '' : String(v).trim()
}
function nullableTimestamp(v: FormDataEntryValue | null) {
  const s = str(v)
  if (s === '') return null
  return new Date(s).toISOString()
}

export async function createTournament(formData: FormData) {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('td_create_tournament', {
    p_name: str(formData.get('name')),
    p_start_date: str(formData.get('start_date')),
    p_end_date: str(formData.get('end_date')),
    p_registration_deadline: nullableTimestamp(formData.get('registration_deadline')),
    p_kind: str(formData.get('kind')) || 'singles',
    p_bracket_format: str(formData.get('bracket_format')) || 'single_elim',
    p_match_kind: str(formData.get('match_kind')) || 'best_of_3',
    p_final_set_format: str(formData.get('final_set_format')) || 'super_tb_10',
    p_sets_to_win: Number(formData.get('sets_to_win') ?? 2),
    p_games_per_set: Number(formData.get('games_per_set') ?? 6),
    p_tiebreak_at: Number(formData.get('tiebreak_at') ?? 6),
    p_requires_dob: formData.get('requires_dob') === 'on',
    p_registration_deadline_override: nullableTimestamp(formData.get('registration_deadline_override')),
    p_show_seeds_publicly: formData.get('show_seeds_publicly') === 'on',
  })
  if (error) {
    redirect(`/tournaments/new?error=${encodeURIComponent(error.message)}`)
  }
  redirect(`/tournaments/${data}/manage`)
}

export async function setRoundDeadline(formData: FormData) {
  const id = str(formData.get('tournament_id'))
  const round = Number(formData.get('round'))
  const deadline = nullableTimestamp(formData.get('deadline'))
  if (!id || !Number.isFinite(round)) {
    redirect(`/tournaments/${id}/manage?error=Invalid+round`)
  }
  const supabase = await createClient()
  const { error } = await supabase.rpc('td_set_round_deadline', {
    p_tournament_id: id,
    p_round: round,
    p_deadline: deadline,
  })
  if (error) {
    redirect(`/tournaments/${id}/manage?error=${encodeURIComponent(error.message)}`)
  }
  revalidatePath(`/tournaments/${id}/manage`)
  revalidatePath(`/tournaments/${id}`)
  redirect(`/tournaments/${id}/manage?ok=deadline`)
}

export async function grantTd(formData: FormData) {
  const id = str(formData.get('tournament_id'))
  const email = str(formData.get('email')).toLowerCase()
  if (!id || !email) {
    redirect(`/tournaments/${id}/manage?error=Email+required`)
  }
  const supabase = await createClient()
  const { data: profile, error: lookupErr } = await supabase
    .from('profiles')
    .select('id')
    .ilike('contact_email', email)
    .maybeSingle()
  if (lookupErr) {
    redirect(`/tournaments/${id}/manage?error=${encodeURIComponent(lookupErr.message)}`)
  }
  if (!profile) {
    redirect(
      `/tournaments/${id}/manage?error=${encodeURIComponent(`No account with email ${email}`)}`,
    )
  }
  const { error } = await supabase.rpc('admin_grant_tournament_director', {
    p_tournament_id: id,
    p_user_id: profile.id,
  })
  if (error) {
    redirect(`/tournaments/${id}/manage?error=${encodeURIComponent(error.message)}`)
  }
  revalidatePath(`/tournaments/${id}/manage`)
  redirect(`/tournaments/${id}/manage?ok=td_granted`)
}

export async function revokeTd(formData: FormData) {
  const id = str(formData.get('tournament_id'))
  const userId = str(formData.get('user_id'))
  if (!id || !userId) {
    redirect(`/tournaments/${id}/manage?error=Missing+user`)
  }
  const supabase = await createClient()
  const { error } = await supabase.rpc('admin_revoke_tournament_director', {
    p_tournament_id: id,
    p_user_id: userId,
  })
  if (error) {
    redirect(`/tournaments/${id}/manage?error=${encodeURIComponent(error.message)}`)
  }
  revalidatePath(`/tournaments/${id}/manage`)
  redirect(`/tournaments/${id}/manage?ok=td_revoked`)
}

export async function updateTournament(formData: FormData) {
  const id = str(formData.get('id'))
  const supabase = await createClient()
  const { error } = await supabase.rpc('td_update_tournament', {
    p_id: id,
    p_name: str(formData.get('name')),
    p_start_date: str(formData.get('start_date')),
    p_end_date: str(formData.get('end_date')),
    p_registration_deadline: nullableTimestamp(formData.get('registration_deadline')),
    p_status: str(formData.get('status')),
    p_kind: str(formData.get('kind')) || 'singles',
    p_bracket_format: str(formData.get('bracket_format')) || 'single_elim',
    p_match_kind: str(formData.get('match_kind')) || 'best_of_3',
    p_final_set_format: str(formData.get('final_set_format')) || 'super_tb_10',
    p_sets_to_win: Number(formData.get('sets_to_win') ?? 2),
    p_games_per_set: Number(formData.get('games_per_set') ?? 6),
    p_tiebreak_at: Number(formData.get('tiebreak_at') ?? 6),
    p_requires_dob: formData.get('requires_dob') === 'on',
    p_registration_deadline_override: nullableTimestamp(formData.get('registration_deadline_override')),
    p_draw_status: str(formData.get('draw_status')) || 'open',
    p_show_seeds_publicly: formData.get('show_seeds_publicly') === 'on',
  })
  if (error) {
    redirect(`/tournaments/${id}/manage?error=${encodeURIComponent(error.message)}`)
  }
  revalidatePath(`/tournaments/${id}`)
  revalidatePath(`/tournaments/${id}/manage`)
  redirect(`/tournaments/${id}/manage?ok=1`)
}
