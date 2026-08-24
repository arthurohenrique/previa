'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import DeformCanvas from './DeformCanvas'
import LandmarkOverlay from './LandmarkOverlay'
import MaskOverlay from './MaskOverlay'
import RegionHighlight from './RegionHighlight'
import { classifyPoint, REGIONS, type RegionId } from '@/lib/anatomy'
import { canRedo, canUndo } from '@/lib/deform/history'
import {
  generateRealisticPreview,
  type GenerationProgress,
} from '@/lib/generative/client'
import { analyzeFace } from '@/lib/landmarker'
import { QUALITY_MESSAGES, type QualityIssue } from '@/lib/quality'
import { segmentPhoto } from '@/lib/segmentation/client'
import { FACE_CLASSES } from '@/lib/segmentation/mask'
import { selectEffectiveProfile, useSession } from '@/store/session'

type Status = 'analisando' | 'ok' | 'erro-tecnico' | QualityIssue

type SegStatus = 'aguardando' | 'baixando' | 'inferindo' | 'ok' | 'erro'

/** Grupos de classes exibíveis na máscara de debug. */
const MASK_GROUPS = [
  { key: 'labios', label: 'Lábios', classes: [FACE_CLASSES.u_lip, FACE_CLASSES.l_lip, FACE_CLASSES.mouth] },
  { key: 'pele', label: 'Pele', classes: [FACE_CLASSES.skin] },
  { key: 'olhos', label: 'Olhos', classes: [FACE_CLASSES.l_eye, FACE_CLASSES.r_eye] },
  { key: 'sobrancelhas', label: 'Sobrancelhas', classes: [FACE_CLASSES.l_brow, FACE_CLASSES.r_brow] },
  { key: 'nariz', label: 'Nariz', classes: [FACE_CLASSES.nose] },
  { key: 'cabelo', label: 'Cabelo', classes: [FACE_CLASSES.hair] },
] as const

type MaskGroupKey = (typeof MASK_GROUPS)[number]['key']

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
  const [maskGroup, setMaskGroup] = useState<MaskGroupKey>('labios')

  const stageRef = useRef<HTMLDivElement>(null)

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
  const deformations = useSession((s) => s.deformations)
  const deformHistory = useSession((s) => s.deformHistory)
  const previewDeformation = useSession((s) => s.previewDeformation)
  const commitDeformation = useSession((s) => s.commitDeformation)
  const undoDeformation = useSession((s) => s.undoDeformation)
  const redoDeformation = useSession((s) => s.redoDeformation)
  const resetDeformations = useSession((s) => s.resetDeformations)

  const [fps, setFps] = useState<number | null>(null)
  /** Durante o arrasto do slider o destaque some para o resultado aparecer. */
  const [adjusting, setAdjusting] = useState(false)

  // Prévia realista (Fase 5): geração local sob demanda.
  const capabilities = useSession((s) => s.capabilities)
  const extractRef = useRef<(() => HTMLCanvasElement | null) | null>(null)
  const [genStatus, setGenStatus] = useState<'idle' | 'rodando' | 'erro'>('idle')
  const [genLabel, setGenLabel] = useState('')
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
      console.error('[prévia realista]', error)
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

  // Fase 2.5: segmentação roda uma vez por foto/estratégia, após os landmarks.
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

  // Um único caminho de interação para mouse, toque e caneta (Pointer Events).
  const handlePointerDown = (event: React.PointerEvent<HTMLElement>) => {
    if (segmentation === null || analysis === null || rect === null) return
    const stage = stageRef.current
    if (stage === null) return
    const bounds = stage.getBoundingClientRect()
    const px = event.clientX - bounds.left - rect.left
    const py = event.clientY - bounds.top - rect.top
    if (px < 0 || py < 0 || px > rect.width || py > rect.height) {
      setActiveRegion(null)
      return
    }
    const uv = { x: px / rect.width, y: py / rect.height }
    setActiveRegion(classifyPoint(uv, segmentation.map, analysis.landmarks))
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
              onFps={setFps}
              extractRef={extractRef}
            />
          )}

        {showResult && resultUrl !== null && rect !== null && (
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
              alt="Prévia realista gerada localmente"
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

        {status === 'ok' && segmentation !== null && showMask && rect !== null && (
          <MaskOverlay
            map={segmentation.map}
            classIds={
              MASK_GROUPS.find((group) => group.key === maskGroup)?.classes ?? []
            }
            rect={rect}
          />
        )}

        {status === 'ok' && analysis !== null && showOverlay && rect !== null &&
          photoWidth !== null && photoHeight !== null && (
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
          <h1 className="text-2xl font-bold tracking-tight">Análise</h1>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">Fase 2 · debug</span>
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
            {activeRegion !== null ? (
              <div
                aria-live="polite"
                className="flex flex-col gap-2 rounded-xl border border-teal-700/40 bg-teal-700/5 px-4 py-3 dark:border-teal-400/40"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-base font-semibold">
                    {REGIONS[activeRegion].label}
                  </span>
                  <span className="text-sm text-zinc-600 dark:text-zinc-300">
                    {REGIONS[activeRegion].procedure}
                  </span>
                </div>
                <label className="block">
                  <span className="mb-1 flex items-center justify-between text-sm font-medium">
                    Intensidade
                    <span className="tabular-nums text-zinc-500 dark:text-zinc-400">
                      {Math.round((deformations[activeRegion] ?? 0) * 100)}%
                    </span>
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={Math.round((deformations[activeRegion] ?? 0) * 100)}
                    onChange={(e) => {
                      setShowResult(false) // resultado gerado ficou defasado
                      previewDeformation(activeRegion, Number(e.target.value) / 100)
                    }}
                    onPointerDown={() => setAdjusting(true)}
                    onPointerUp={() => {
                      setAdjusting(false)
                      commitDeformation()
                    }}
                    onKeyDown={() => setAdjusting(true)}
                    onKeyUp={() => {
                      setAdjusting(false)
                      commitDeformation()
                    }}
                    className="h-11 w-full accent-teal-700 dark:accent-teal-400"
                  />
                </label>
              </div>
            ) : (
              <p
                aria-live="polite"
                className="rounded-xl bg-zinc-100 px-4 py-3 text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300"
              >
                {segStatus === 'ok'
                  ? 'Toque em uma região do rosto (lábios, malar, mento…) para escolher o procedimento.'
                  : 'Preparando a máscara de regiões…'}
              </p>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={undoDeformation}
                disabled={!canUndo(deformHistory)}
                className="flex min-h-11 flex-1 items-center justify-center rounded-xl border border-zinc-300 px-3 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300"
              >
                Desfazer
              </button>
              <button
                type="button"
                onClick={redoDeformation}
                disabled={!canRedo(deformHistory)}
                className="flex min-h-11 flex-1 items-center justify-center rounded-xl border border-zinc-300 px-3 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300"
              >
                Refazer
              </button>
              <button
                type="button"
                onClick={resetDeformations}
                disabled={Object.values(deformations).every((v) => !v)}
                className="flex min-h-11 flex-1 items-center justify-center rounded-xl border border-zinc-300 px-3 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300"
              >
                Zerar
              </button>
            </div>

            <section aria-labelledby="previa-realista" className="flex flex-col gap-2">
              <h2
                id="previa-realista"
                className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
              >
                Prévia realista
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
                    className="flex min-h-11 items-center justify-center rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white transition hover:bg-teal-600 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-teal-400 dark:text-zinc-950 dark:hover:bg-teal-300"
                  >
                    {genStatus === 'rodando' ? genLabel : 'Gerar prévia realista'}
                  </button>
                  {genStatus === 'erro' && (
                    <p
                      role="alert"
                      className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
                    >
                      Falha na geração local. O ajuste determinístico continua
                      disponível.
                    </p>
                  )}
                  {resultUrl !== null && (
                    <button
                      type="button"
                      onClick={() => setShowResult((value) => !value)}
                      className={secondaryButton}
                    >
                      {showResult ? 'Ver ajuste de malha' : 'Ver prévia realista'}
                    </button>
                  )}
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Gerada neste aparelho, apenas na região ajustada — o resto
                    da foto permanece intocado. Ajustar o slider novamente
                    exige nova geração.
                  </p>
                </>
              )}
            </section>

            <dl className="flex flex-col gap-1 rounded-xl bg-zinc-100 p-3 text-sm dark:bg-zinc-900">
              <div className="flex justify-between">
                <dt className="text-zinc-500 dark:text-zinc-400">Carga do modelo</dt>
                <dd className="tabular-nums">
                  {analysis.modelLoadMs < 1
                    ? 'em memória'
                    : `${Math.round(analysis.modelLoadMs)} ms`}
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
                  onChange={(e) => setShowOverlay(e.target.checked)}
                  className="accent-teal-700 dark:accent-teal-400"
                />
                <span className="text-sm font-medium">Mostrar os 478 pontos</span>
              </label>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-zinc-300 px-4 dark:border-zinc-700">
                <input
                  type="checkbox"
                  checked={showIndices}
                  disabled={!showOverlay}
                  onChange={(e) => setShowIndices(e.target.checked)}
                  className="accent-teal-700 dark:accent-teal-400"
                />
                <span className="text-sm font-medium">Numerar os pontos</span>
              </label>
            </div>

            <section aria-labelledby="segmentacao" className="flex flex-col gap-2">
              <h2
                id="segmentacao"
                className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
              >
                Segmentação
              </h2>

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
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  Segmentando o rosto…
                </p>
              )}

              {segStatus === 'erro' && (
                <p
                  role="alert"
                  className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
                >
                  Falha na segmentação. A simulação seguirá com a máscara por
                  landmarks — troque a estratégia na configuração.
                </p>
              )}

              {segStatus === 'ok' && segmentation !== null && (
                <>
                  <dl className="flex flex-col gap-1 rounded-xl bg-zinc-100 p-3 text-sm dark:bg-zinc-900">
                    <div className="flex justify-between">
                      <dt className="text-zinc-500 dark:text-zinc-400">Backend</dt>
                      <dd>{segmentation.meta.backend}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-zinc-500 dark:text-zinc-400">Carga do modelo</dt>
                      <dd className="tabular-nums">
                        {segmentation.meta.modelLoadMs < 1
                          ? '—'
                          : `${Math.round(segmentation.meta.modelLoadMs)} ms`}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-zinc-500 dark:text-zinc-400">Inferência</dt>
                      <dd className="tabular-nums">
                        {Math.round(segmentation.meta.inferenceMs)} ms
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-zinc-500 dark:text-zinc-400">Pico de memória</dt>
                      <dd className="tabular-nums">
                        {segmentation.meta.memoryPeakMB === null
                          ? 'não exposto'
                          : `${Math.round(segmentation.meta.memoryPeakMB)} MB`}
                      </dd>
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
                      onChange={(e) => setShowMask(e.target.checked)}
                      className="accent-teal-700 dark:accent-teal-400"
                    />
                    <span className="text-sm font-medium">Mostrar máscara</span>
                  </label>

                  <label className="flex flex-col gap-1">
                    <span className="text-sm font-medium">Região destacada</span>
                    <select
                      value={maskGroup}
                      onChange={(e) => setMaskGroup(e.target.value as MaskGroupKey)}
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
