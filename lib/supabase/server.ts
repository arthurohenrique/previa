import 'server-only'

import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { getSupabaseEnv } from './env'
import type { Database } from './types'

/**
 * Client de servidor ligado aos cookies da requisição. No Next 16 `cookies()` é
 * assíncrono.
 */
export async function getSupabaseServerClient() {
  const cookieStore = await cookies()

  const { url, key } = getSupabaseEnv()

  return createServerClient<Database>(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options)
          }
        } catch {
          // Server Component não pode escrever cookie. O refresh de sessão
          // acontece em proxy.ts; aqui o silêncio é o comportamento correto.
        }
      },
    },
  })
}

/** Perfil do usuário autenticado, ou `null`. */
export async function getCurrentProfile() {
  const supabase = await getSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const { data } = await supabase
    .from('profiles')
    .select('id, clinic_id, full_name, council_type, council_number, role, created_at')
    .eq('id', user.id)
    .maybeSingle()

  return data ?? null
}
