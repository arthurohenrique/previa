'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import type { ActionResult } from '../pacientes/actions'

// Protocolo, produto e dose são cadastrados pelo profissional. O código nunca
// preenche, calcula nem sugere dose (D-03).

const NewPreset = z.object({
  region_id: z.string().regex(/^[a-z][a-z0-9_]{2,40}$/),
  technique: z.enum(['filler', 'toxin', 'biostimulator', 'rhinomodeling']),
  label: z.string().trim().min(2).max(120),
  default_intensity: z.coerce.number().min(0).max(1),
  default_radius_ipd: z.coerce.number().gt(0).max(1),
  notes: z.string().trim().max(4000).optional(),
})

export async function createPreset(formData: FormData): Promise<ActionResult> {
  const parsed = NewPreset.safeParse({
    region_id: formData.get('region_id'),
    technique: formData.get('technique'),
    label: formData.get('label'),
    default_intensity: formData.get('default_intensity'),
    default_radius_ipd: formData.get('default_radius_ipd'),
    notes: formData.get('notes') ?? undefined,
  })

  if (!parsed.success) return { ok: false, message: 'Confira os campos do protocolo.' }

  const supabase = await getSupabaseServerClient()
  const { error } = await supabase.from('region_presets').insert({
    region_id: parsed.data.region_id,
    technique: parsed.data.technique,
    label: parsed.data.label,
    default_intensity: parsed.data.default_intensity,
    default_radius_ipd: parsed.data.default_radius_ipd,
    notes: parsed.data.notes ?? null,
  })

  if (error) return { ok: false, message: 'Não foi possível salvar o protocolo.' }

  revalidatePath('/presets')
  return { ok: true }
}

export async function deletePreset(id: string): Promise<ActionResult> {
  if (!z.uuid().safeParse(id).success) return { ok: false, message: 'Registro inválido.' }

  const supabase = await getSupabaseServerClient()
  const { error } = await supabase.from('region_presets').delete().eq('id', id)
  if (error) return { ok: false, message: 'Não foi possível remover.' }

  revalidatePath('/presets')
  return { ok: true }
}
