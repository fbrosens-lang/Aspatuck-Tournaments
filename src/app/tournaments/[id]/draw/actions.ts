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

export async function setSeeds(formData: FormData) {
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
  revalidatePath(`/tournaments/${tid}/draw`)
  redirect(backUrl(tid, undefined, 'seeded'))
}

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
