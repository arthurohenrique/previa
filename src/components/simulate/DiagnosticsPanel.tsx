'use client'

import type { FaceAnalysis } from '@/lib/landmarker'
import { FACE_CLASSES } from '@/lib/segmentation/mask'
import type { SegmentationOutput } from '@/lib/segmentation/types'

/** Grupos de classes exibíveis na máscara de debug. */
export const MASK_GROUPS = [
  { key: 'labios', label: 'Lábios', classes: [FACE_CLASSES.u_lip, FACE_CLASSES.l_lip, FACE_CLASSES.mouth] },
  { key: 'pele', label: 'Pele', classes: [FACE_CLASSES.skin] },
  { key: 'olhos', label: 'Olhos', classes: [FACE_CLASSES.l_eye, FACE_CLASSES.r_eye] },
  { key: 'sobrancelhas', label: 'Sobrancelhas', classes: [FACE_CLASSES.l_brow, FACE_CLASSES.r_brow] },
  { key: 'nariz', label: 'Nariz', classes: [FACE_CLASSES.nose] },
  { key: 'cabelo', label: 'Cabelo', classes: [FACE_CLASSES.hair] },
] as const

export type MaskGroupKey = (typeof MASK_GROUPS)[number]['key']

export type SegStatus = 'aguardando' | 'baixando' | 'inferindo' | 'ok' | 'erro'

interface DiagnosticsPanelProps {
  analysis: FaceAnalysis
  fps: number | null
  segStatus: SegStatus
  downloadProgress: number
  segmentation: SegmentationOutput | null
  showOverlay: boolean
  onShowOverlay: (show: boolean) => void
  showIndices: boolean
  onShowIndices: (show: boolean) => void
  showMask: boolean
  onShowMask: (show: boolean) => void
  maskGroup: MaskGroupKey
  onMaskGroup: (group: MaskGroupKey) => void
}

/**
 * Painel de diagnóstico (métricas, landmarks, máscara) — só aparece com o
 * toggle em /config. UI de engenharia, não de produto.
 */
export default function DiagnosticsPanel({
  analysis,
  fps,
  segStatus,
  downloadProgress,
  segmentation,
  showOverlay,
  onShowOverlay,
  showIndices,
  onShowIndices,
  showMask,
  onShowMask,
  maskGroup,
  onMaskGroup,
}: DiagnosticsPanelProps) {
  return (
    <section aria-labelledby="diagnostico" className="flex flex-col gap-3">
      <h2
        id="diagnostico"
        className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
      >
        Diagnóstico
      </h2>

      <dl className="flex flex-col gap-1 rounded-xl bg-zinc-100 p-3 text-sm dark:bg-zinc-900">
        <div className="flex justify-between">
          <dt className="text-zinc-500 dark:text-zinc-400">Carga do modelo</dt>
          <dd className="tabular-nums">
            {analysis.modelLoadMs < 1 ? 'em memória' : `${Math.round(analysis.modelLoadMs)} ms`}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-zinc-500 dark:text-zinc-400">Inferência</dt>
          <dd className="tabular-nums">{Math.round(analysis.inferenceMs)} ms</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-zinc-500 dark:text-zinc-400">Landmarks</dt>
          <dd className="tabular-nums">{analysis.landmarks.length}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-zinc-500 dark:text-zinc-400">Nitidez (var. Laplaciano)</dt>
          <dd className="tabular-nums">{analysis.sharpness.toFixed(1)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-zinc-500 dark:text-zinc-400">Simetria (yaw)</dt>
          <dd className="tabular-nums">{analysis.yawRatio.toFixed(2)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-zinc-500 dark:text-zinc-400">FPS (render)</dt>
          <dd className="tabular-nums">{fps === null ? '—' : Math.round(fps)}</dd>
        </div>
      </dl>

      <div className="flex flex-col gap-2">
        <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-zinc-300 px-4 dark:border-zinc-700">
          <input
            type="checkbox"
            checked={showOverlay}
            onChange={(e) => onShowOverlay(e.target.checked)}
            className="accent-teal-700 dark:accent-teal-400"
          />
          <span className="text-sm font-medium">Mostrar os 478 pontos</span>
        </label>
        <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-zinc-300 px-4 dark:border-zinc-700">
          <input
            type="checkbox"
            checked={showIndices}
            disabled={!showOverlay}
            onChange={(e) => onShowIndices(e.target.checked)}
            className="accent-teal-700 dark:accent-teal-400"
          />
          <span className="text-sm font-medium">Numerar os pontos</span>
        </label>
      </div>

      {segStatus === 'baixando' && (
        <div className="flex flex-col gap-1">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Baixando o modelo… {Math.round(downloadProgress * 100)}%
          </p>
          <div
            role="progressbar"
            aria-valuenow={Math.round(downloadProgress * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
          >
            <div
              className="h-full bg-teal-600 transition-[width] dark:bg-teal-400"
              style={{ width: `${downloadProgress * 100}%` }}
            />
          </div>
        </div>
      )}

      {segStatus === 'inferindo' && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Segmentando o rosto…</p>
      )}

      {segStatus === 'erro' && (
        <p
          role="alert"
          className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
        >
          Falha na segmentação. A simulação seguirá com a máscara por landmarks —
          troque a estratégia na configuração.
        </p>
      )}

      {segStatus === 'ok' && segmentation !== null && (
        <>
          <dl className="flex flex-col gap-1 rounded-xl bg-zinc-100 p-3 text-sm dark:bg-zinc-900">
            <div className="flex justify-between">
              <dt className="text-zinc-500 dark:text-zinc-400">Backend da máscara</dt>
              <dd>{segmentation.meta.backend}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-500 dark:text-zinc-400">Inferência</dt>
              <dd className="tabular-nums">{Math.round(segmentation.meta.inferenceMs)} ms</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-500 dark:text-zinc-400">Máscara</dt>
              <dd className="tabular-nums">
                {segmentation.map.width} × {segmentation.map.height}
              </dd>
            </div>
          </dl>

          <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-zinc-300 px-4 dark:border-zinc-700">
            <input
              type="checkbox"
              checked={showMask}
              onChange={(e) => onShowMask(e.target.checked)}
              className="accent-teal-700 dark:accent-teal-400"
            />
            <span className="text-sm font-medium">Mostrar máscara</span>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Região destacada</span>
            <select
              value={maskGroup}
              onChange={(e) => onMaskGroup(e.target.value as MaskGroupKey)}
              disabled={!showMask}
              className="min-h-11 rounded-xl border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            >
              {MASK_GROUPS.map((group) => (
                <option key={group.key} value={group.key}>
                  {group.label}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
    </section>
  )
}
