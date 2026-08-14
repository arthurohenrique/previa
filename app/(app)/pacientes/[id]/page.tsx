import { notFound } from 'next/navigation'
import { LargeTitleScreen } from '@/components/ui/LargeTitleScreen'
import { EmptyState, List, ListRow } from '@/components/ui/List'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { ConsentPanel } from './ConsentPanel'
import { StartSessionButton } from './StartSessionButton'

const dateFormat = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
})

export default async function PatientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await getSupabaseServerClient()

  const { data: patient } = await supabase
    .from('patients')
    .select('id, full_name, birth_year')
    .eq('id', id)
    .maybeSingle()

  if (!patient) notFound()

  const [{ data: consent }, { data: sessions }] = await Promise.all([
    supabase
      .from('consents')
      .select('id, granted_at, terms_version, revoked_at')
      .eq('patient_id', id)
      .is('revoked_at', null)
      .maybeSingle(),
    supabase
      .from('sessions')
      .select('id, created_at, ipd_px, yaw, pitch, roll')
      .eq('patient_id', id)
      .order('created_at', { ascending: false })
      .limit(50),
  ])

  const hasConsent = Boolean(consent)

  return (
    <LargeTitleScreen
      title={patient.full_name}
      actions={<StartSessionButton patientId={patient.id} disabled={!hasConsent} />}
    >
      <div className="flex flex-col gap-3 pb-4">
        <ConsentPanel
          patientId={patient.id}
          consent={consent ?? null}
          termsVersion={process.env.NEXT_PUBLIC_TERMS_VERSION ?? 'sem-versao'}
        />

        <section className="flex flex-col gap-1">
          <h2 className="text-title3 text-label">Prévias</h2>
          {(sessions?.length ?? 0) === 0 ? (
            <EmptyState message="Nenhuma prévia ainda. Fotografe o paciente para começar." />
          ) : (
            <List>
              {sessions?.map((session) => (
                <ListRow
                  key={session.id}
                  href={`/sessao/${session.id}?paciente=${patient.id}`}
                  title={dateFormat.format(new Date(session.created_at))}
                  detail={`DIP ${session.ipd_px.toFixed(0)} px · guinada ${session.yaw.toFixed(1)}°`}
                />
              ))}
            </List>
          )}
        </section>
      </div>
    </LargeTitleScreen>
  )
}
