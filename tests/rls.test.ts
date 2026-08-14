import { createClient } from '@supabase/supabase-js'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Database } from '@/lib/supabase/types'

/**
 * Isolamento entre clínicas, contra um Supabase de verdade.
 *
 * Roda contra o ambiente local (`supabase start` + `pnpm db:reset`, que aplica
 * as migrations e o seed com as clínicas Aurora e Boreal). Sem as variáveis de
 * ambiente o bloco é pulado, porque um teste de RLS que não fala com o Postgres
 * não testa RLS — testa o cliente.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const configured = Boolean(url && anonKey)

const AURORA = { email: 'aurora@previa.test', password: 'previa-dev-2026' }
const BOREAL = { email: 'boreal@previa.test', password: 'previa-dev-2026' }

function client() {
  return createClient<Database>(url as string, anonKey as string, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

describe.skipIf(!configured)('RLS entre clínicas', () => {
  const aurora = configured ? client() : null
  const boreal = configured ? client() : null
  let auroraPatientId = ''

  beforeAll(async () => {
    if (!aurora || !boreal) return

    const first = await aurora.auth.signInWithPassword(AURORA)
    expect(first.error, 'o seed local precisa existir').toBeNull()

    const second = await boreal.auth.signInWithPassword(BOREAL)
    expect(second.error).toBeNull()

    const { data, error } = await aurora
      .from('patients')
      .insert({ full_name: 'Paciente da Aurora' })
      .select('id')
      .single()

    expect(error).toBeNull()
    auroraPatientId = data?.id ?? ''
  })

  it('a clínica B não lê paciente da clínica A', async () => {
    if (!boreal) return
    const { data, error } = await boreal.from('patients').select('id').eq('id', auroraPatientId)

    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('a clínica B não escreve na linha da clínica A', async () => {
    if (!boreal) return
    const { data } = await boreal
      .from('patients')
      .update({ full_name: 'Invadido' })
      .eq('id', auroraPatientId)
      .select('id')

    expect(data ?? []).toEqual([])
  })

  it('a clínica B não apaga a linha da clínica A', async () => {
    if (!boreal || !aurora) return
    await boreal.from('patients').delete().eq('id', auroraPatientId)

    const { data } = await aurora.from('patients').select('id').eq('id', auroraPatientId)
    expect(data).toHaveLength(1)
  })

  it('a clínica B não lê protocolos da clínica A', async () => {
    if (!boreal) return
    const { data } = await boreal.from('region_presets').select('id, clinic_id')
    expect(data ?? []).toEqual([])
  })

  it('ninguém atualiza nem apaga o audit_log', async () => {
    if (!aurora) return

    const { data: entries } = await aurora.from('audit_log').select('id').limit(1)
    const first = entries?.[0]
    expect(first, 'o gatilho de auditoria precisa ter registrado o insert').toBeDefined()
    if (!first) return

    const update = await aurora.from('audit_log').update({ entity: 'forjado' }).eq('id', first.id)
    expect(update.error).not.toBeNull()

    const remove = await aurora.from('audit_log').delete().eq('id', first.id)
    expect(remove.error).not.toBeNull()
  })

  it('o anônimo não lê nada', async () => {
    const anon = client()
    const { data, error } = await anon.from('patients').select('id')
    expect(data ?? []).toEqual([])
    if (error) expect(error).not.toBeNull()
  })
})
