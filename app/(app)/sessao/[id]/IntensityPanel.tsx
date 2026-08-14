'use client'

import { useId } from 'react'
import { Button } from '@/components/ui/Button'
import { clampFor } from '@/lib/warp/clamps'
import type { SessionApplication } from '@/store/useSessionStore'

interface IntensityPanelProps {
  application: SessionApplication
  regionLabel: string
  techniqueLabel: string
  onLiveIntensity: (value: number) => void
  onCommitIntensity: (value: number) => void
  onLiveRadius: (value: number) => void
  onCommitRadius: (value: number) => void
  onRemove: () => void
}

/**
 * Painel de ajuste da aplicação selecionada.
 *
 * `onInput` mexe direto no pipeline; `onChange` é que grava no store. Sem essa
 * separação, arrastar o controle dispara um `setState` por evento e o React
 * re-renderiza a 60 fps — é isso que derruba o framerate, não o WebGL.
 */
export function IntensityPanel({
  application,
  regionLabel,
  techniqueLabel,
  onLiveIntensity,
  onCommitIntensity,
  onLiveRadius,
  onCommitRadius,
  onRemove,
}: IntensityPanelProps) {
  const intensityId = useId()
  const radiusId = useId()
  const limits = clampFor(application.regionId, application.technique)

  const slider = 'h-(--touch-target) w-full touch-none bg-transparent accent-accent'

  return (
    <section
      aria-label={`Ajuste de ${regionLabel}`}
      className="material pointer-events-auto flex w-full max-w-45 flex-col gap-1 rounded-lg p-2 shadow-e1"
    >
      <header className="flex items-baseline justify-between gap-1">
        <h2 className="truncate text-headline text-label">{regionLabel}</h2>
        <span className="shrink-0 text-footnote text-label-secondary">{techniqueLabel}</span>
      </header>

      <div className="flex flex-col">
        <div className="flex items-baseline justify-between">
          <label htmlFor={intensityId} className="text-subhead text-label-secondary">
            Intensidade
          </label>
          <output htmlFor={intensityId} data-numeric className="text-subhead text-label">
            {Math.round(application.intensity * 100)}%
          </output>
        </div>
        <input
          key={`${application.id}-intensity`}
          id={intensityId}
          type="range"
          min={0}
          max={1}
          step={0.01}
          defaultValue={application.intensity}
          className={slider}
          onInput={(event) => onLiveIntensity(event.currentTarget.valueAsNumber)}
          onChange={(event) => onCommitIntensity(event.currentTarget.valueAsNumber)}
        />
      </div>

      <div className="flex flex-col">
        <div className="flex items-baseline justify-between">
          <label htmlFor={radiusId} className="text-subhead text-label-secondary">
            Área
          </label>
          {/* O raio é fração de DIP — a única unidade comparável entre fotos. */}
          <output htmlFor={radiusId} data-numeric className="text-subhead text-label">
            {application.radiusIpd.toFixed(2)} DIP
          </output>
        </div>
        <input
          key={`${application.id}-radius`}
          id={radiusId}
          type="range"
          min={limits.minRadiusIpd}
          max={limits.maxRadiusIpd}
          step={0.005}
          defaultValue={application.radiusIpd}
          className={slider}
          onInput={(event) => onLiveRadius(event.currentTarget.valueAsNumber)}
          onChange={(event) => onCommitRadius(event.currentTarget.valueAsNumber)}
        />
      </div>

      <Button variant="destructive" className="self-start px-0" onClick={onRemove}>
        Remover aplicação
      </Button>
    </section>
  )
}
