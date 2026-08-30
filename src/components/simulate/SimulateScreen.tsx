'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import DeformCanvas, { type CompareState } from './DeformCanvas'
import DiagnosticsPanel, { MASK_GROUPS, type MaskGroupKey, type SegStatus } from './DiagnosticsPanel'
import LandmarkOverlay from './LandmarkOverlay'
import MaskOverlay from './MaskOverlay'
import ProcedurePanel from './ProcedurePanel'
import RegionHighlight from './RegionHighlight'
import { classifyPoint } from '@/lib/anatomy'
import { buildComparisonPdf } from '@/lib/export/pdf'
import {
  decodeToCanvas,
  downloadBlob,
  exportFilename,
  exportSimulationPng,
  renderSimulation,
  withWatermark,
  type FieldSnapshot,
} from '@/lib/export/render'
import {
  generateRealisticPreview,
  type GenerationProgress,
} from '@/lib/generative/client'
import { analyzeFace } from '@/lib/landmarker'
import { procedureLines, regionToProcedure } from '@/lib/procedures'
import { QUALITY_MESSAGES, type QualityIssue } from '@/lib/quality'
import type { RegionId } from '@/lib/anatomy'
import { segmentPhoto } from '@/lib/segmentation/client'
import { selectEffectiveProfile, useSession } from '@/store/session'

type Status = 'analisando' | 'ok' | 'erro-tecnico' | QualityIssue

/**
 * Prévia generativa é EXPERIMENTAL e desligada por padrão: o pipeline nunca
 * operou em produção (bugs registrados em docs/plano-reconstrucao.md).
 */
const GENERATIVE_ENABLED = process.env.NEXT_PUBLIC_ENABLE_GENERATIVE === '1'

const secondaryButton =
  'flex min-h-11 items-center justify-center rounded-xl border border-zinc-300 px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:text-zinc-100'

interface ContentRect {
  left: number
  top: number
  width: number
  height: number
}

/** Retângulo do object-contain: onde a foto realmente aparece no palco. */
function containRect(
  stageWidth: number,
  stageHeight: number,
  imageWidth: number,
  imageHeight: number,
): ContentRect {
  const scale = Math.min(stageWidth / imageWidth, stageHeight / imageHeight)
  const width = imageWidth * scale
  const height = imageHeight * scale
  return {
    left: (stageWidth - width) / 2,
    top: (stageHeight - height) / 2,
    width,
    height,
  }
}

export default function SimulateScreen() {
  const router = useRouter()
  const [status, setStatus] = useState<Status>('analisando')
  const [showOverlay, setShowOverlay] = useState(false)
  const [showIndices, setShowIndices] = useState(false)
  const [rect, setRect] = useState<ContentRect | null>(null)

  const [segStatus, setSegStatus] = useState<SegStatus>('aguardando')
  const [downloadProgress, setDownloadProgress] = useState(0)
  const [showMask, setShowMask] = useState(false)
  const [maskGroup, setMaskGroup] = useState<MaskGroupKey>(MASK_GROUPS[0].key)

  const stageRef = useRef<HTMLDivElement>(null)

  const originalPhoto = useSession((s) => s.originalPhoto)
  const workingPhoto = useSession((s) => s.workingPhoto)
  const workingPhotoUrl = useSession((s) => s.workingPhotoUrl)
  const photoWidth = useSession((s) => s.photoWidth)
  const photoHeight = useSession((s) => s.photoHeight)
  const analysis = useSession((s) => s.analysis)
  const setAnalysis = useSession((s) => s.setAnalysis)
  const segmentation = useSession((s) => s.segmentation)
  const setSegmentation = useSession((s) => s.setSegmentation)
  const segmentationStrategy = useSession((s) => s.segmentationStrategy)
  const effectiveProfile = useSession(selectEffectiveProfile)
  const activeRegion = useSession((s) => s.activeRegion)
  const setActiveRegion = useSession((s) => s.setActiveRegion)
  const setActiveProcedure = useSession((s) => s.setActiveProcedure)
  const showDiagnostics = useSession((s) => s.showDiagnostics)
  const deformations = useSession((s) => s.deformations)

  const [fps, setFps] = useState<number | null>(null)
  /** Durante o arrasto do slider o destaque some para o resultado aparecer. */
  const [adjusting, setAdjusting] = useState(false)

  // Antes/depois: "Antes" segurado e divisor arrastável (Fase D).
  const [holdBefore, setHoldBefore] = useState(false)
  const [splitMode, setSplitMode] = useState(false)
  const [splitX, setSplitX] = useState(0.5)
  const compare: CompareState = useMemo(
    () => ({ showAfter: !holdBefore, splitX: splitMode ? splitX : null }),
    [holdBefore, splitMode, splitX],
  )
  const snapshotRef = useRef<(() => FieldSnapshot | null) | null>(null)
  const [exporting, setExporting] = useState<'png' | 'pdf' | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)

  const handleExport = async (kind: 'png' | 'pdf') => {
    const snapshot = snapshotRef.current?.()
    if (originalPhoto === null || snapshot === null || snapshot === undefined) return
    setExporting(kind)
    setExportError(null)
    try {
      if (kind === 'png') {
        downloadBlob(await exportSimulationPng(originalPhoto, snapshot), exportFilename('png'))
      } else {
        const [before, after] = await Promise.all([
          decodeToCanvas(originalPhoto),
          renderSimulation(originalPhoto, snapshot),
        ])
        const pdf = buildComparisonPdf({
          before,
          after: withWatermark(after),
          procedures: procedureLines(deformations),
        })
        downloadBlob(pdf, exportFilename('pdf'))
      }
    } catch (error) {
      console.error('[exportação]', error)
      setExportError('Não foi possível exportar. Tente novamente.')
    } finally {
      setExporting(null)
    }
  }

  const handleDividerPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const handleDividerPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    const stage = stageRef.current
    if (stage === null || rect === null) return
    const bounds = stage.getBoundingClientRect()
    const px = event.clientX - bounds.left - rect.left
    setSplitX(Math.min(0.98, Math.max(0.02, px / rect.width)))
  }

  // Prévia generativa experimental (atrás de flag): geração local sob demanda.
  const capabilities = useSession((s) => s.capabilities)
  const extractRef = useRef<(() => HTMLCanvasElement | null) | null>(null)
  const [genStatus, setGenStatus] = useState<'idle' | 'rodando' | 'erro'>('idle')
  const [genLabel, setGenLabel] = useState('')
  const [genError, setGenError] = useState<string | null>(null)
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [showResult, setShowResult] = useState(false)

  const describeProgress = (progress: GenerationProgress): string => {
    switch (progress.stage) {
      case 'preparando':
        return 'Preparando o recorte…'
      case 'carregando-modelo':
        return `Carregando o modelo… ${Math.round(progress.progress * 100)}%`
      case 'gerando':
        return `Gerando (passo ${progress.step}/${progress.total})…`
      case 'compondo':
        return 'Compondo o resultado…'
    }
  }

  const handleGenerate = async () => {
    if (analysis === null || segmentation === null) return
    const extract = extractRef.current
    const deformedCanvas = extract?.()
    if (deformedCanvas === null || deformedCanvas === undefined) return
    const activeRegions = (Object.keys(deformations) as RegionId[])
      .map((region) => ({ region, intensity: deformations[region] ?? 0 }))
      .filter((entry) => entry.intensity > 0)
    if (activeRegions.length === 0) return

    setGenStatus('rodando')
    setGenLabel('Preparando…')
    try {
      const result = await generateRealisticPreview({
        deformedCanvas,
        map: segmentation.map,
        landmarks: analysis.landmarks,
        activeRegions,
        onProgress: (progress) => setGenLabel(describeProgress(progress)),
      })
      const blob = await new Promise<Blob>((resolve, reject) =>
        result.toBlob(
          (value) => (value ? resolve(value) : reject(new Error('toBlob falhou'))),
          'image/jpeg',
          0.95,
        ),
      )
      if (resultUrl) URL.revokeObjectURL(resultUrl)
      setResultUrl(URL.createObjectURL(blob))
      setShowResult(true)
      setGenStatus('idle')
    } catch (error) {
      console.error('[prévia generativa]', error)
      setGenError(error instanceof Error ? error.message : null)
      setGenStatus('erro')
    }
  }

  // Sem foto na sessão não há o que simular.
  useEffect(() => {
    if (workingPhotoUrl === null) router.replace('/')
  }, [workingPhotoUrl, router])

  // A IA roda UMA vez por foto: análise existente no store é reaproveitada.
  useEffect(() => {
    if (workingPhotoUrl === null) return
    if (analysis !== null) {
      setStatus('ok')
      return
    }
    let cancelled = false
    void (async () => {
      setStatus('analisando')
      try {
        const image = new Image()
        image.src = workingPhotoUrl
        await image.decode()
        const result = await analyzeFace(image)
        if (cancelled) return
        if (result.ok) {
          setAnalysis(result.analysis)
          setStatus('ok')
        } else {
          setStatus(result.issue)
        }
      } catch {
        if (!cancelled) setStatus('erro-tecnico')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [workingPhotoUrl, analysis, setAnalysis])

  // Segmentação roda uma vez por foto/estratégia, após os landmarks.
  useEffect(() => {
    if (status !== 'ok' || analysis === null || workingPhoto === null) return
    if (photoWidth === null || photoHeight === null) return
    if (segmentation !== null) {
      setSegStatus('ok')
      return
    }
    let cancelled = false
    setSegStatus('baixando')
    setDownloadProgress(0)
    void segmentPhoto({
      photo: workingPhoto,
      photoWidth,
      photoHeight,
      landmarks: analysis.landmarks,
      strategy: segmentationStrategy,
      profile: effectiveProfile,
      onProgress: (progress) => {
        if (cancelled) return
        if (progress.stage === 'download') {
          setSegStatus('baixando')
          setDownloadProgress(progress.progress)
        } else {
          setSegStatus('inferindo')
        }
      },
    })
      .then((output) => {
        if (cancelled) return
        setSegmentation(output)
        setSegStatus('ok')
      })
      .catch((error: unknown) => {
        console.error('[segmentação]', error)
        if (!cancelled) setSegStatus('erro')
      })
    return () => {
      cancelled = true
    }
  }, [
    status,
    analysis,
    workingPhoto,
    photoWidth,
    photoHeight,
    segmentation,
    segmentationStrategy,
    effectiveProfile,
    setSegmentation,
  ])

  // Acompanha o retângulo real da foto (letterbox do object-contain).
  useEffect(() => {
    const stage = stageRef.current
    if (!stage || photoWidth === null || photoHeight === null) return
    const update = () =>
      setRect(
        containRect(stage.clientWidth, stage.clientHeight, photoWidth, photoHeight),
      )
    update()
    const observer = new ResizeObserver(update)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [photoWidth, photoHeight])

  // Um único caminho de interação para mouse, toque e caneta (Pointer Events):
  // o toque escolhe a região e, com ela, o procedimento do painel.
  const handlePointerDown = (event: React.PointerEvent<HTMLElement>) => {
    if (segmentation === null || analysis === null || rect === null) return
    const stage = stageRef.current
    if (stage === null) return
    const bounds = stage.getBoundingClientRect()
    const px = event.clientX - bounds.left - rect.left
    const py = event.clientY - bounds.top - rect.top
    if (px < 0 || py < 0 || px > rect.width || py > rect.height) {
      setActiveRegion(null)
      setActiveProcedure(null)
      return
    }
    const uv = { x: px / rect.width, y: py / rect.height }
    const region = classifyPoint(uv, segmentation.map, analysis.landmarks)
    setActiveRegion(region)
    setActiveProcedure(region === null ? null : regionToProcedure(region))
  }

  if (workingPhotoUrl === null) return null

  const issueMessage =
    status !== 'analisando' && status !== 'ok' && status !== 'erro-tecnico'
      ? QUALITY_MESSAGES[status]
      : null

  return (
    <main className="flex h-dvh flex-col sm:flex-row">
      <section
        ref={stageRef}
        onPointerDown={handlePointerDown}
        className="relative min-h-0 flex-1 touch-manipulation bg-zinc-100 dark:bg-zinc-900"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- object URL local */}
        <img
          src={workingPhotoUrl}
          alt="Foto do paciente em análise"
          className="h-full w-full object-contain"
        />

        {status === 'ok' && analysis !== null && workingPhoto !== null &&
          segmentation !== null && rect !== null &&
          photoWidth !== null && photoHeight !== null && (
            <DeformCanvas
              photo={workingPhoto}
              photoWidth={photoWidth}
              photoHeight={photoHeight}
              landmarks={analysis.landmarks}
              segmentationMap={segmentation.map}
              deformations={deformations}
              profile={effectiveProfile}
              rect={rect}
              compare={compare}
              onFps={setFps}
              extractRef={extractRef}
              snapshotRef={snapshotRef}
            />
          )}

        {splitMode && rect !== null && status === 'ok' && (
          <div
            role="slider"
            aria-label="Divisor antes/depois"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(splitX * 100)}
            onPointerDown={handleDividerPointerDown}
            onPointerMove={handleDividerPointerMove}
            className="absolute z-10 flex w-11 -translate-x-1/2 cursor-col-resize touch-none items-center justify-center"
            style={{ left: rect.left + rect.width * splitX, top: rect.top, height: rect.height }}
          >
            <div className="h-full w-0.5 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.4)]" />
            <div className="absolute top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-zinc-300 bg-white text-xs font-bold text-zinc-700 shadow">
              ⇔
            </div>
            <span className="absolute left-0 top-2 -translate-x-full rounded-md bg-zinc-950/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-100">
              Antes
            </span>
            <span className="absolute right-0 top-2 translate-x-full rounded-md bg-zinc-950/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-100">
              Depois
            </span>
          </div>
        )}

        {GENERATIVE_ENABLED && showResult && resultUrl !== null && rect !== null && (
          <div
            className="pointer-events-none absolute"
            style={{
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- object URL local */}
            <img
              src={resultUrl}
              alt="Prévia gerada localmente (experimental)"
              className="h-full w-full"
            />
            <span className="absolute bottom-2 right-2 rounded-md bg-zinc-950/70 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-100">
              Simulação ilustrativa
            </span>
          </div>
        )}

        {status === 'ok' && segmentation !== null && analysis !== null &&
          activeRegion !== null && rect !== null && !adjusting && !showResult && (
            <RegionHighlight
              region={activeRegion}
              map={segmentation.map}
              landmarks={analysis.landmarks}
              rect={rect}
            />
          )}

        {status === 'ok' && segmentation !== null && showDiagnostics && showMask &&
          rect !== null && (
            <MaskOverlay
              map={segmentation.map}
              classIds={
                MASK_GROUPS.find((group) => group.key === maskGroup)?.classes ?? []
              }
              rect={rect}
            />
          )}

        {status === 'ok' && analysis !== null && showDiagnostics && showOverlay &&
          rect !== null && photoWidth !== null && photoHeight !== null && (
            <LandmarkOverlay
              landmarks={analysis.landmarks}
              width={photoWidth}
              height={photoHeight}
              showIndices={showIndices}
              rect={rect}
            />
          )}

        {status === 'analisando' && (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/50">
            <p className="rounded-xl bg-zinc-900 px-4 py-3 text-sm font-medium text-zinc-100">
              Carregando o modelo e analisando o rosto…
            </p>
          </div>
        )}
      </section>

      {/* max-h no celular: o palco (canvas) nunca cede mais que ~45% da tela. */}
      <aside className="flex max-h-[45dvh] shrink-0 flex-col gap-4 overflow-y-auto border-t border-zinc-200 bg-white p-4 pb-safe sm:max-h-none sm:w-80 sm:border-l sm:border-t-0 sm:p-6 dark:border-zinc-800 dark:bg-zinc-950">
        <header className="flex items-baseline justify-between">
          <h1 className="text-2xl font-bold tracking-tight">Simulação</h1>
          <Link
            href="/config"
            className="text-xs text-zinc-500 underline-offset-2 hover:underline dark:text-zinc-400"
          >
            Configuração
          </Link>
        </header>

        {issueMessage !== null && (
          <div
            role="alert"
            className="flex flex-col gap-1 rounded-xl border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
          >
            <strong>{issueMessage.title}</strong>
            <span>{issueMessage.hint}</span>
          </div>
        )}

        {status === 'erro-tecnico' && (
          <p
            role="alert"
            className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
          >
            Falha ao carregar o modelo de análise. Recarregue a página e tente
            novamente.
          </p>
        )}

        {status === 'ok' && analysis !== null && (
          <>
            <ProcedurePanel
              ready={segStatus === 'ok'}
              onAdjustingChange={setAdjusting}
              onDeformationChange={GENERATIVE_ENABLED ? () => setShowResult(false) : undefined}
              holdBefore={holdBefore}
              onHoldBefore={setHoldBefore}
              splitMode={splitMode}
              onToggleSplit={() => setSplitMode((value) => !value)}
              exporting={exporting}
              exportError={exportError}
              canExport={originalPhoto !== null}
              onExport={(kind) => void handleExport(kind)}
            />

            {GENERATIVE_ENABLED && (
              <section aria-labelledby="previa-generativa" className="flex flex-col gap-2">
                <h2
                  id="previa-generativa"
                  className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
                >
                  Prévia generativa (experimental)
                </h2>
                {capabilities?.webgpu !== true ? (
                  <p className="rounded-xl bg-zinc-100 px-3 py-2 text-xs text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                    Indisponível neste aparelho (exige WebGPU). O ajuste
                    determinístico acima continua valendo.
                  </p>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => void handleGenerate()}
                      disabled={
                        genStatus === 'rodando' ||
                        Object.values(deformations).every((v) => !v)
                      }
                      className={secondaryButton}
                    >
                      {genStatus === 'rodando' ? genLabel : 'Gerar prévia (difusão local)'}
                    </button>
                    {genStatus === 'erro' && (
                      <p
                        role="alert"
                        className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
                      >
                        {genError ??
                          'Falha na geração local. O ajuste determinístico continua disponível.'}
                      </p>
                    )}
                    {resultUrl !== null && (
                      <button
                        type="button"
                        onClick={() => setShowResult((value) => !value)}
                        className={secondaryButton}
                      >
                        {showResult ? 'Ver ajuste determinístico' : 'Ver prévia gerada'}
                      </button>
                    )}
                  </>
                )}
              </section>
            )}

            {showDiagnostics && (
              <DiagnosticsPanel
                analysis={analysis}
                fps={fps}
                segStatus={segStatus}
                downloadProgress={downloadProgress}
                segmentation={segmentation}
                showOverlay={showOverlay}
                onShowOverlay={setShowOverlay}
                showIndices={showIndices}
                onShowIndices={setShowIndices}
                showMask={showMask}
                onShowMask={setShowMask}
                maskGroup={maskGroup}
                onMaskGroup={setMaskGroup}
              />
            )}
          </>
        )}

        <div className="mt-auto flex flex-col gap-2">
          <Link href="/" className={secondaryButton}>
            {issueMessage !== null ? 'Voltar e refazer a foto' : 'Trocar foto'}
          </Link>
        </div>
      </aside>
    </main>
  )
}
