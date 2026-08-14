import { notFound } from 'next/navigation'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { SessionScreen } from './SessionScreen'

export default async function SessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ paciente?: string }>
}) {
  const [{ id }, query] = await Promise.all([params, searchParams])
  const supabase = await getSupabaseServerClient()

  const { data: session } = await supabase
    .from('sessions')
    .select('id, patient_id, created_at, local_image_ref, ipd_px, yaw, pitch, roll')
    .eq('id', id)
    .maybeSingle()

  const patientId = session?.patient_id ?? query.paciente
  if (!patientId) notFound()

  const [{ data: patient }, { data: profile }, { data: presets }, { data: applications }] =
    await Promise.all([
      supabase.from('patients').select('id, full_name').eq('id', patientId).maybeSingle(),
      supabase.auth.getUser().then(async ({ data }) => {
        if (!data.user) return { data: null }
        return supabase
          .from('profiles')
          .select('full_name, council_type, council_number')
          .eq('id', data.user.id)
          .maybeSingle()
      }),
      supabase
        .from('region_presets')
        .select('id, region_id, technique, label, default_intensity, default_radius_ipd, notes')
        .order('label'),
      session
        ? supabase
            .from('applications')
            .select(
              'id, region_id, technique, point_u, point_v, anchor_landmark, anchor_offset_u, anchor_offset_v, intensity, radius_ipd',
            )
            .eq('session_id', session.id)
        : Promise.resolve({ data: [] }),
    ])

  if (!patient) notFound()

  return (
    <SessionScreen
      sessionId={id}
      patient={patient}
      existingSession={session ?? null}
      presets={presets ?? []}
      professional={profile ?? null}
      persistedApplications={applications ?? []}
    />
  )
}
