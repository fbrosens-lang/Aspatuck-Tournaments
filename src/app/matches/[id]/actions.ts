'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

type SetPayload = {
  set_number: number
  games_a: number
  games_b: number
  tiebreak_a: number | null
  tiebreak_b: number | null
}

function parseSets(formData: FormData): SetPayload[] {
  const sets: SetPayload[] = []
  for (let i = 1; i <= 5; i++) {
    const a = String(formData.get(`set_${i}_a`) ?? '').trim()
    const b = String(formData.get(`set_${i}_b`) ?? '').trim()
    if (a === '' && b === '') continue
    const ga = Number(a)
    const gb = Number(b)
    if (!Number.isFinite(ga) || !Number.isFinite(gb)) continue
    const ta = String(formData.get(`set_${i}_ta`) ?? '').trim()
    const tb = String(formData.get(`set_${i}_tb`) ?? '').trim()
    sets.push({
      set_number: i,
      games_a: ga,
      games_b: gb,
      tiebreak_a: ta === '' ? null : Number(ta),
      tiebreak_b: tb === '' ? null : Number(tb),
    })
  }
  return sets
}

export async function reportScore(formData: FormData) {
  const matchId = String(formData.get('match_id') ?? '')
  const winner = String(formData.get('winner_entry_id') ?? '')
  const sets = parseSets(formData)
  const supabase = await createClient()
  const { error } = await supabase.rpc('report_match_score', {
    p_match_id: matchId,
    p_sets: sets,
    p_winner_entry_id: winner,
  })
  if (error) {
    redirect(`/matches/${matchId}?error=${encodeURIComponent(error.message)}`)
  }
  revalidatePath(`/matches/${matchId}`)
  redirect(`/matches/${matchId}?ok=reported`)
}

export async function overrideScore(formData: FormData) {
  const matchId = String(formData.get('match_id') ?? '')
  const winner = String(formData.get('winner_entry_id') ?? '')
  const sets = parseSets(formData)
  const supabase = await createClient()
  const { error } = await supabase.rpc('override_match_score', {
    p_match_id: matchId,
    p_sets: sets,
    p_winner_entry_id: winner,
  })
  if (error) {
    redirect(`/matches/${matchId}?error=${encodeURIComponent(error.message)}`)
  }
  revalidatePath(`/matches/${matchId}`)
  redirect(`/matches/${matchId}?ok=overridden`)
}
