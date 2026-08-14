import type { Metadata } from 'next'
import { LargeTitleScreen } from '@/components/ui/LargeTitleScreen'
import { EmptyState, List, ListRow } from '@/components/ui/List'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { NewPatientButton } from './NewPatientButton'

export const metadata: Metadata = { title: 'Pacientes · Prévia' }

export default async function PatientsPage() {
  const supabase = await getSupabaseServerClient()
  const { data: patients } = await supabase
    .from('patients')
    .select('id, full_name, birth_year, created_at')
    .order('created_at', { ascending: false })
    .limit(200)

  const rows = patients ?? []

  return (
    <LargeTitleScreen title="Pacientes" actions={<NewPatientButton />}>
      {rows.length === 0 ? (
        <EmptyState message="Nenhum paciente cadastrado. Cadastre para começar." />
      ) : (
        <List>
          {rows.map((patient) => (
            <ListRow
              key={patient.id}
              href={`/pacientes/${patient.id}`}
              title={patient.full_name}
              detail={patient.birth_year ? `Nascimento ${patient.birth_year}` : undefined}
            />
          ))}
        </List>
      )}
    </LargeTitleScreen>
  )
}
