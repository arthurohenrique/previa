'use client'

import { canRedo, canUndo } from '@/lib/deform/history'
import {
  PROCEDURE_ORDER,
  PROCEDURES,
  procedureIntensity,
  procedureVolumeLabel,
} from '@/lib/procedures'
import { useSession } from '@/store/session'

const secondaryButton =
  'flex min-h-11 items-center justify-center rounded-xl border border-zinc-300 px-3 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:text-zinc-100'

interface ProcedurePanelProps {
  /** Máscara pronta: sem ela o toque no rosto ainda não classifica. */
  ready: boolean
  /** O slider está sendo arrastado (o destaque da região some no palco). */
  onAdjustingChange: (adjusting: boolean) => void
  /** Qualquer ajuste invalida um resultado generativo já gerado. */
  onDeformationChange?: () => void
  holdBefore: boolean
  onHoldBefore: (hold: boolean) => void
  splitMode: boolean
  onToggleSplit: () => void
  exporting: 'png' | 'pdf' | null
  exportError: string | null
  canExport: boolean
  onExport: (kind: 'png' | 'pdf') => void
}

/** Painel de produto: procedimentos, intensidade, comparar e exportar. */
export default function ProcedurePanel({
  ready,
  onAdjustingChange,
  onDeformationChange,
  holdBefore,
  onHoldBefore,
  splitMode,
  onToggleSplit,
  exporting,
  exportError,
  canExport,
  onExport,
}: ProcedurePanelProps) {
  const deformations = useSession((s) => s.deformations)
  const deformHistory = useSession((s) => s.deformHistory)
  const activeProcedure = useSession((s) => s.activeProcedure)
  const setActiveProcedure = useSession((s) => s.setActiveProcedure)
  const previewProcedure = useSession((s) => s.previewProcedure)
  const commitDeformation = useSession((s) => s.commitDeformation)
  const undoDeformation = useSession((s) => s.undoDeformation)
  const redoDeformation = useSession((s) => s.redoDeformation)
  const resetDeformations = useSession((s) => s.resetDeformations)

  const nothingApplied = Object.values(deformations).every((value) => !value)
  const intensity = activeProcedure === null ? 0 : procedureIntensity(activeProcedure, deformations)

  return (
    <>
      <section aria-labelledby="procedimentos" className="flex flex-col gap-2">
        <h2
          id="procedimentos"
          className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
        >
          Procedimentos
        </h2>
        <div role="radiogroup" aria-label="Procedimento" className="flex flex-wrap gap-2">
          {PROCEDURE_ORDER.map((id) => {
            const applied = procedureIntensity(id, deformations) > 0
            const active = activeProcedure === id
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setActiveProcedure(active ? null : id)}
                className={`flex min-h-11 items-center gap-1.5 rounded-xl border px-3 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 ${
                  active
                    ? 'border-teal-700 bg-teal-700/10 text-teal-900 dark:border-teal-400 dark:text-teal-200'
                    : 'border-zinc-300 text-zinc-700 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-300'
                }`}
              >
                {PROCEDURES[id].label}
                {applied && (
                  <span aria-label="ajustado" className="h-1.5 w-1.5 rounded-full bg-teal-600 dark:bg-teal-400" />
                )}
              </button>
            )
          })}
        </div>

        {activeProcedure !== null ? (
          <div
            aria-live="polite"
            className="flex flex-col gap-2 rounded-xl border border-teal-700/40 bg-teal-700/5 px-4 py-3 dark:border-teal-400/40"
          >
            <span className="text-sm text-zinc-600 dark:text-zinc-300">
              {PROCEDURES[activeProcedure].description}
            </span>
            <label className="block">
              <span className="mb-1 flex items-center justify-between text-sm font-medium">
                Intensidade
                <span className="tabular-nums text-zinc-500 dark:text-zinc-400">
                  {Math.round(intensity * 100)}% ·{' '}
                  {procedureVolumeLabel(activeProcedure, intensity)}
                </span>
              </span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(intensity * 100)}
                onChange={(event) => {
                  onDeformationChange?.()
                  previewProcedure(activeProcedure, Number(event.target.value) / 100)
                }}
                onPointerDown={() => onAdjustingChange(true)}
                onPointerUp={() => {
                  onAdjustingChange(false)
                  commitDeformation()
                }}
                onKeyDown={() => onAdjustingChange(true)}
                onKeyUp={() => {
                  onAdjustingChange(false)
                  commitDeformation()
                }}
                className="h-11 w-full accent-teal-700 dark:accent-teal-400"
              />
              <span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">
                Volume estimado, ilustrativo — não substitui a avaliação clínica.
              </span>
            </label>
          </div>
        ) : (
          <p
            aria-live="polite"
            className="rounded-xl bg-zinc-100 px-4 py-3 text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300"
          >
            {ready
              ? 'Toque em uma região do rosto ou escolha um procedimento acima.'
              : 'Preparando a máscara de regiões…'}
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={undoDeformation}
            disabled={!canUndo(deformHistory)}
            className={`${secondaryButton} flex-1`}
          >
            Desfazer
          </button>
          <button
            type="button"
            onClick={redoDeformation}
            disabled={!canRedo(deformHistory)}
            className={`${secondaryButton} flex-1`}
          >
            Refazer
          </button>
          <button
            type="button"
            onClick={resetDeformations}
            disabled={nothingApplied}
            className={`${secondaryButton} flex-1`}
          >
            Zerar
          </button>
        </div>
      </section>

      <section aria-labelledby="comparar" className="flex flex-col gap-2">
        <h2
          id="comparar"
          className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
        >
          Comparar e exportar
        </h2>
        <div className="flex gap-2">
          <button
            type="button"
            onPointerDown={() => onHoldBefore(true)}
            onPointerUp={() => onHoldBefore(false)}
            onPointerLeave={() => onHoldBefore(false)}
            onPointerCancel={() => onHoldBefore(false)}
            onKeyDown={(event) => {
              if (event.key === ' ' || event.key === 'Enter') onHoldBefore(true)
            }}
            onKeyUp={() => onHoldBefore(false)}
            disabled={nothingApplied}
            className={`${secondaryButton} flex-1 select-none touch-none`}
            aria-pressed={holdBefore}
          >
            {holdBefore ? 'Mostrando o antes' : 'Segurar: antes'}
          </button>
          <button
            type="button"
            onClick={onToggleSplit}
            disabled={nothingApplied}
            className={`${secondaryButton} flex-1`}
            aria-pressed={splitMode}
          >
            {splitMode ? 'Fechar divisor' : 'Dividir'}
          </button>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onExport('png')}
            disabled={exporting !== null || !canExport}
            className={`${secondaryButton} flex-1`}
          >
            {exporting === 'png' ? 'Gerando PNG…' : 'Exportar PNG'}
          </button>
          <button
            type="button"
            onClick={() => onExport('pdf')}
            disabled={exporting !== null || !canExport}
            className={`${secondaryButton} flex-1`}
          >
            {exporting === 'pdf' ? 'Gerando PDF…' : 'Exportar PDF'}
          </button>
        </div>
        {exportError !== null && (
          <p
            role="alert"
            className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
          >
            {exportError}
          </p>
        )}
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          A exportação usa a foto em alta resolução, leva a marca d&apos;água
          &quot;Simulação ilustrativa&quot; e fica só neste aparelho.
        </p>
      </section>
    </>
  )
}
