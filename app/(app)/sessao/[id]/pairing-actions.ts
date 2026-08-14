'use server'

import { z } from 'zod'
import { getSupabaseServerClient } from '@/lib/supabase/server'

/**
 * Sinalização do pareamento, lado do computador.
 *
 * Estas actions movem descrições de sessão do WebRTC — texto — e nada mais. A
 * foto atravessa pelo canal de dados, direto entre os dois aparelhos, e não
 * passa por aqui nem por nenhuma outra rota (seção 9).
 */

const Sdp = z.string().min(32).max(65_536)

const OpenPairing = z.object({
  session_id: z.uuid(),
  patient_id: z.uuid(),
  offer: Sdp,
})

export type OpenPairingResult = { ok: true; id: string } | { ok: false; message: string }

export async function openPairing(input: unknown): Promise<OpenPairingResult> {
  const parsed = OpenPairing.safeParse(input)
  if (!parsed.success) return { ok: false, message: 'Não foi possível abrir o pareamento.' }

  const supabase = await getSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'Sessão expirada. Entre de novo.' }

  const { data, error } = await supabase
    .from('pairings')
    .insert({ ...parsed.data, created_by: user.id })
    .select('id')
    .single()

  if (error || !data) return { ok: false, message: 'Não foi possível abrir o pareamento.' }
  return { ok: true, id: data.id }
}

export type PairingPoll =
  | { state: 'waiting' }
  | { state: 'claimed' }
  | { state: 'answered'; answer: string }
  | { state: 'gone' }

export async function pollPairing(id: string): Promise<PairingPoll> {
  if (!z.uuid().safeParse(id).success) return { state: 'gone' }

  const supabase = await getSupabaseServerClient()
  const { data } = await supabase
    .from('pairings')
    .select('answer, claimed_at, expires_at')
    .eq('id', id)
    .maybeSingle()

  if (!data || Date.parse(data.expires_at) <= Date.now()) return { state: 'gone' }
  if (data.answer) return { state: 'answered', answer: data.answer }
  return data.claimed_at ? { state: 'claimed' } : { state: 'waiting' }
}

export async function closePairing(id: string): Promise<void> {
  if (!z.uuid().safeParse(id).success) return

  // O SDP carrega endereços da rede local da clínica. Terminado o pareamento,
  // não há motivo para a linha continuar existindo.
  const supabase = await getSupabaseServerClient()
  await supabase.from('pairings').delete().eq('id', id)
}
