'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getSupabaseServerClient } from '@/lib/supabase/server'

// Nenhuma action aqui recebe ou devolve imagem. Metadados apenas (D-01).

const NewPatient = z.object({
  full_name: z.string().trim().min(2).max(200),
  birth_year: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? Number(v) : null))
    .refine((v) => v === null || (Number.isInteger(v) && v >= 1900 && v <= 2200), {
      message: 'Ano de nascimento inválido.',
    }),
})

export type ActionResult = { ok: true } | { ok: false; message: string }

export async function createPatient(formData: FormData): Promise<ActionResult> {
  const parsed = NewPatient.safeParse({
    full_name: formData.get('full_name'),
    birth_year: formData.get('birth_year') ?? undefined,
  })

  if (!parsed.success) {
    return { ok: false, message: 'Confira o nome e o ano de nascimento.' }
  }

  const supabase = await getSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'Sessão expirada. Entre de novo.' }

  const { error } = await supabase.from('patients').insert({
    full_name: parsed.data.full_name,
    birth_year: parsed.data.birth_year,
    created_by: user.id,
  })

  if (error) return { ok: false, message: 'Não foi possível cadastrar. Tente de novo.' }

  revalidatePath('/pacientes')
  return { ok: true }
}
