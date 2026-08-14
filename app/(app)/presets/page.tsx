import type { Metadata } from 'next'
import { LargeTitleScreen } from '@/components/ui/LargeTitleScreen'
import { EmptyState, List, ListRow } from '@/components/ui/List'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { NewPresetButton } from './NewPresetButton'

export const metadata: Metadata = { title: 'Protocolos · Prévia' }

const TECHNIQUE_LABELS: Record<string, string> = {
  filler: 'Preenchedor',
  toxin: 'Toxina botulínica',
  biostimulator: 'Bioestimulador',
  rhinomodeling: 'Rinomodelação',
}

export default async function PresetsPage() {
  const supabase = await getSupabaseServerClient()

  const [{ data: presets }, { data: regions }] = await Promise.all([
    supabase
      .from('region_presets')
      .select('id, region_id, technique, label, default_intensity, default_radius_ipd, notes')
      .order('label'),
    supabase.from('regions').select('id, label, sort_order').order('sort_order'),
  ])

  const regionLabels = new Map((regions ?? []).map((region) => [region.id, region.label]))
  const rows = presets ?? []

  return (
    <LargeTitleScreen
      title="Protocolos"
      actions={<NewPresetButton regions={regions ?? []} />}
    >
      <div className="flex flex-col gap-2 pb-4">
        <p className="max-w-90 text-body text-label-secondary">
          O protocolo é da clínica. Registre aqui produto, diluição e dose — o Prévia simula
          volume, não prescreve.
        </p>

        {rows.length === 0 ? (
          <EmptyState message="Nenhum protocolo cadastrado. Cadastre para agilizar a marcação." />
        ) : (
          <List>
            {rows.map((preset) => (
              <ListRow
                key={preset.id}
                title={preset.label}
                detail={`${regionLabels.get(preset.region_id) ?? preset.region_id} · ${
                  TECHNIQUE_LABELS[preset.technique] ?? preset.technique
                } · ${Math.round(preset.default_intensity * 100)}% · ${preset.default_radius_ipd.toFixed(2)} DIP`}
              />
            ))}
          </List>
        )}
      </div>
    </LargeTitleScreen>
  )
}
