'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export async function setUserRole(formData: FormData) {
  const userId = String(formData.get('user_id') ?? '')
  const role = String(formData.get('role') ?? '')
  if (!userId || !['player', 'tournament_director', 'site_admin'].includes(role)) {
    return
  }
  const supabase = await createClient()
  const { error } = await supabase.rpc('admin_set_user_role', {
    p_user_id: userId,
    p_role: role,
  })
  if (error) throw new Error(error.message)
  revalidatePath('/admin')
}
