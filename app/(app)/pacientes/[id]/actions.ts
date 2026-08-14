'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import type { ActionResult } from '../actions'

// Nada aqui carrega imagem. `local_image_ref` é um UUID que aponta para o
// IndexedDB do próprio tablet (D-02).

const SignatureSvg = z
  .string()
  .min(32)
  .max(262_144)
  .refine((v) => v.trimStart().startsWith('<svg'), { message: 'Assinatura inválida.' })
  // A assinatura é desenhada pelo dedo ou pelo Pencil e serializada como
  // polilinha. Script embutido não tem o que fazer num traço.
  .refine((v) => !/<script|javascript:|on[a-z]+\s*=/i.test(v), {
    message: 'Assinatura inválida.',
  })

const GrantConsent = z.object({
  patient_id: z.uuid(),
  signature_svg: SignatureSvg,
  terms_version: z.string().trim().min(1).max(64),
})

export async function grantConsent(input: unknown): Promise<ActionResult> {
  const parsed = GrantConsent.safeParse(input)
  if (!parsed.success) return { ok: false, message: 'Assine no quadro para registrar.' }

  const supabase = await getSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'Sessão expirada. Entre de novo.' }

  const { error } = await supabase.from('consents').insert({
    patient_id: parsed.data.patient_id,
    professional_id: user.id,
    purpose: 'simulation',
    signature_svg: parsed.data.signature_svg,
    terms_version: parsed.data.terms_version,
  })

  if (error) return { ok: false, message: 'Não foi possível registrar o consentimento.' }

  revalidatePath(`/pacientes/${parsed.data.patient_id}`)
  return { ok: true }
}

export async function revokeConsent(consentId: string, patientId: string): Promise<ActionResult> {
  if (!z.uuid().safeParse(consentId).success) return { ok: false, message: 'Registro inválido.' }

  const supabase = await getSupabaseServerClient()
  const { error } = await supabase
    .from('consents')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', consentId)

  if (error) return { ok: false, message: 'Não foi possível revogar.' }

  revalidatePath(`/pacientes/${patientId}`)
  return { ok: true }
}
