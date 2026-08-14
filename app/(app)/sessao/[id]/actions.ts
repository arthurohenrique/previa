'use server'

import { z } from 'zod'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import type { ActionResult } from '../../pacientes/actions'

// ATENÇÃO: nenhuma action deste arquivo recebe ou devolve imagem.
// `local_image_ref` é um UUID que só faz sentido dentro do IndexedDB do tablet
// que capturou a foto (D-01, D-02). Se você se pegar adicionando um campo de
// blob, base64 ou multipart aqui, pare: violou a seção 2 da especificação.

const TECHNIQUES = ['filler', 'toxin', 'biostimulator', 'rhinomodeling'] as const

const CreateSession = z.object({
  id: z.uuid(),
  patient_id: z.uuid(),
  local_image_ref: z.uuid(),
  ipd_px: z.number().positive().finite(),
  yaw: z.number().min(-90).max(90),
  pitch: z.number().min(-90).max(90),
  roll: z.number().min(-90).max(90),
})

export async function createSession(input: unknown): Promise<ActionResult> {
  const parsed = CreateSession.safeParse(input)
  if (!parsed.success) return { ok: false, message: 'Dados da captura inválidos.' }

  const supabase = await getSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'Sessão expirada. Entre de novo.' }

  const { error } = await supabase.from('sessions').insert({
    ...parsed.data,
    professional_id: user.id,
  })

  if (error) {
    // A política de RLS exige consentimento vigente para a sessão existir.
    return {
      ok: false,
      message: 'Não foi possível registrar a prévia. Confira o consentimento do paciente.',
    }
  }

  return { ok: true }
}

const ApplicationInput = z.object({
  id: z.uuid(),
  region_id: z.string().regex(/^[a-z][a-z0-9_]{2,40}$/),
  technique: z.enum(TECHNIQUES),
  point_u: z.number().min(0).max(1),
  point_v: z.number().min(0).max(1),
  anchor_landmark: z.number().int().min(0).max(477),
  anchor_offset_u: z.number().min(-2).max(2),
  anchor_offset_v: z.number().min(-2).max(2),
  intensity: z.number().min(0).max(1),
  radius_ipd: z.number().gt(0).max(1),
})

const SyncApplications = z.object({
  session_id: z.uuid(),
  applications: z.array(ApplicationInput).max(64),
})

/**
 * Espelha as aplicações da sessão no Supabase.
 *
 * Substitui o conjunto inteiro em vez de aplicar um delta: a verdade é o estado
 * local, o histórico de undo/redo já vive no store, e sincronizar delta criaria
 * uma segunda linha do tempo que pode divergir da primeira.
 */
export async function syncApplications(input: unknown): Promise<ActionResult> {
  const parsed = SyncApplications.safeParse(input)
  if (!parsed.success) return { ok: false, message: 'Aplicações inválidas.' }

  const supabase = await getSupabaseServerClient()
  const { session_id, applications } = parsed.data

  const { error: deleteError } = await supabase
    .from('applications')
    .delete()
    .eq('session_id', session_id)
  if (deleteError) return { ok: false, message: 'Não foi possível sincronizar.' }

  if (applications.length === 0) return { ok: true }

  const { error: insertError } = await supabase
    .from('applications')
    .insert(applications.map((application) => ({ ...application, session_id })))

  if (insertError) return { ok: false, message: 'Não foi possível sincronizar.' }
  return { ok: true }
}
