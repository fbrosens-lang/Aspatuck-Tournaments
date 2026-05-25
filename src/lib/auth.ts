import { createClient } from '@/lib/supabase/server'

export type Role = 'player' | 'tournament_director' | 'site_admin'

export type SessionContext = {
  userId: string | null
  role: Role | null
}

export async function getSession(): Promise<SessionContext> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { userId: null, role: null }
  const { data } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()
  return { userId: user.id, role: (data?.role as Role) ?? null }
}

export async function isTdOfTournament(tournamentId: string): Promise<boolean> {
  const { userId, role } = await getSession()
  if (!userId) return false
  if (role === 'site_admin') return true
  const supabase = await createClient()
  const { data } = await supabase
    .from('tournament_directors')
    .select('tournament_id')
    .eq('tournament_id', tournamentId)
    .eq('user_id', userId)
    .maybeSingle()
  return !!data
}
