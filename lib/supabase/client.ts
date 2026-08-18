'use client'

import { createBrowserClient } from '@supabase/ssr'
import { getSupabaseEnv } from './env'
import type { Database } from './types'

let cached: ReturnType<typeof createBrowserClient<Database>> | null = null

/**
 * Client de browser. Só trafega metadados — nenhuma chamada daqui carrega bytes
 * de imagem (D-01).
 */
export function getSupabaseBrowserClient() {
  if (cached) return cached

  const { url, key } = getSupabaseEnv()
  cached = createBrowserClient<Database>(url, key)
  return cached
}
