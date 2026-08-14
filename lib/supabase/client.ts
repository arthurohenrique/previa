'use client'

import { createBrowserClient } from '@supabase/ssr'
import type { Database } from './types'

let cached: ReturnType<typeof createBrowserClient<Database>> | null = null

/**
 * Client de browser. Só trafega metadados — nenhuma chamada daqui carrega bytes
 * de imagem (D-01).
 */
export function getSupabaseBrowserClient() {
  if (cached) return cached

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY precisam estar definidas.',
    )
  }

  cached = createBrowserClient<Database>(url, anonKey)
  return cached
}
