'use server'

import { z } from 'zod'
import { getSupabaseServerClient } from '@/lib/supabase/server'

/**
 * Sinalização do pareamento, lado do celular.
 *
 * Estas duas actions são chamadas por um aparelho **não autenticado**: quem
 * escaneia o QR não faz login. A autorização é a posse do identificador — 128
 * bits aleatórios, cinco minutos de validade, queimado quando a resposta chega.
 *
 * O celular não recebe acesso à tabela `pairings`: fala com duas funções
 * `security definer` que só respondem sobre a linha cujo id ele já conhece.
 * Política aberta na tabela deixaria qualquer anônimo listar todos os
 * pareamentos da instalação.
 *
 * Nem uma nem outra recebe imagem. A foto vai do celular ao computador pelo
 * canal de dados do WebRTC, e não encosta no servidor.
 */

const PairId = z.uuid()
const Sdp = z.string().min(32).max(65_536)

export type ClaimResult =
  | { ok: true; patientName: string; offer: string }
  | { ok: false; message: string }

export async function claim(pairId: string): Promise<ClaimResult> {
  if (!PairId.safeParse(pairId).success) {
    return { ok: false, message: 'Endereço inválido. Gere um novo QR no computador.' }
  }

  const supabase = await getSupabaseServerClient()
  const { data, error } = await supabase.rpc('pairing_claim', { p_id: pairId })

  const row = data?.[0]
  if (error || !row) {
    return { ok: false, message: 'Pareamento indisponível. Gere um novo QR no computador.' }
  }

  return { ok: true, patientName: row.patient_name, offer: row.offer }
}

export type AnswerResult = { ok: true } | { ok: false; message: string }

export async function answer(pairId: string, sdp: string): Promise<AnswerResult> {
  if (!PairId.safeParse(pairId).success || !Sdp.safeParse(sdp).success) {
    return { ok: false, message: 'Pareamento indisponível.' }
  }

  const supabase = await getSupabaseServerClient()
  const { error } = await supabase.rpc('pairing_answer', { p_id: pairId, p_answer: sdp })

  return error ? { ok: false, message: 'Pareamento indisponível.' } : { ok: true }
}
