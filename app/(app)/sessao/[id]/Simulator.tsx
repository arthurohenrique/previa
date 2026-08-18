'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { IconCompare, IconRedo, IconUndo } from '@/components/icons'
import { Button } from '@/components/ui/Button'
import { anchorIndexFor, type RegionInstance } from '@/lib/face/atlas'
import { clientPointToImage, hitTest, imagePointToClient } from '@/lib/face/hitTest'
import type { FaceGeometry, Point2 } from '@/lib/face/types'
import { buildFicha, deliverFicha } from '@/lib/export/ficha'
import { bitmapFromBlob } from '@/lib/image/prepare'
import { WarpPipeline } from '@/lib/warp/pipeline'
import type { ResolvedApplication } from '@/lib/warp/types'
import type { Technique } from '@/lib/supabase/types'
import {
  resolveApplications,
  resolvePoint,
  useSessionStore,
  useTemporalSession,
  type SessionApplication,
} from '@/store/useSessionStore'
import { CompareSheet } from './CompareSheet'
import { IntensityPanel } from './IntensityPanel'
import type { PresetRow } from './SessionScreen'

const TECHNIQUE_LABELS: Record<Technique, string> = {
  filler: 'Preenchedor',
  toxin: 'Toxina botulínica',
  biostimulator: 'Bioestimulador',
  rhinomodeling: 'Rinomodelação',
}

const TECHNIQUE_ORDER: readonly Technique[] = [
  'filler',
  'toxin',
  'biostimulator',
  'rhinomodeling',
]

const DEFAULT_INTENSITY = 0.45
const DEFAULT_RADIUS_IPD = 0.16

interface SimulatorProps {
  photoBlob: Blob
  geometry: FaceGeometry
  onRetake: () => void
  /**
   * Identificação do atendimento. Ausentes quando o simulador roda solto — em
   * teste, sem paciente e sem profissional. Aí a barra não mostra a pílula de
   * navegação e a ficha em PDF não é oferecida: uma ficha sem conselho e sem
   * número de registro é exatamente o que a marca d'água existe para impedir.
   */
  sessionId?: string
  patientName?: string
  professional?: {
    full_name: string
    council_type: string | null
    council_number: string | null
  } | null
  presets?: PresetRow[]
}

interface Size {
  width: number
  height: number
}

export function Simulator({
  photoBlob,
  geometry,
  onRetake,
  sessionId,
  patientName,
  professional = null,
  presets = [],
}: SimulatorProps) {
  const stageRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const pipelineRef = useRef<WarpPipeline | null>(null)
  const generationRef = useRef(0)

  const applications = useSessionStore((state) => state.applications)
  const regionInstances = useSessionStore((state) => state.regionInstances)
  const selectedId = useSessionStore((state) => state.selectedId)
  const activeTechnique = useSessionStore((state) => state.activeTechnique)
  const notice = useSessionStore((state) => state.notice)
  const addApplication = useSessionStore((state) => state.addApplication)
  const setActiveTechnique = useSessionStore((state) => state.setActiveTechnique)
  const select = useSessionStore((state) => state.select)
  const setIntensity = useSessionStore((state) => state.setIntensity)
  const setRadius = useSessionStore((state) => state.setRadius)
  const moveApplication = useSessionStore((state) => state.moveApplication)
  const removeApplication = useSessionStore((state) => state.removeApplication)
  const clearNotice = useSessionStore((state) => state.clearNotice)

  const { undo, redo, canUndo, canRedo } = useTemporalSession()

  // Tamanho do palco em CSS pixels. Os chips e os marcadores são DOM, então
  // precisam do mesmo retângulo que o `object-fit: contain` do canvas usa.
  const [stageSize, setStageSize] = useState<Size>({ width: 0, height: 0 })
  const [ready, setReady] = useState(false)
  // Nomes das regiões desligados por padrão: o conteúdo é o rosto, e o chrome
  // recua. Ligado, é uma consulta de segundos, não um estado de trabalho.
  const [showLabels, setShowLabels] = useState(false)
  const [compareOpen, setCompareOpen] = useState(false)
  const [beforeBlob, setBeforeBlob] = useState<Blob | null>(null)
  const [afterBlob, setAfterBlob] = useState<Blob | null>(null)
  const [exporting, setExporting] = useState(false)

  // -------------------------------------------------------------------------
  // Pipeline
  // -------------------------------------------------------------------------

  // Recriar o pipeline é recursivo (a restauração de contexto chama de volta),
  // então a referência viva fica num ref em vez de na própria closure.
  const remountRef = useRef<() => void>(() => {})

  const mountPipeline = useCallback(async () => {
    const stage = stageRef.current
    if (!stage) return

    const generation = ++generationRef.current
    pipelineRef.current?.destroy()
    pipelineRef.current = null
    setReady(false)

    const bitmap = await bitmapFromBlob(photoBlob)
    if (generation !== generationRef.current) {
      bitmap.close()
      return
    }

    const pipeline = await WarpPipeline.create({
      container: stage,
      photo: bitmap,
      ipdPx: geometry.ipdPx,
      regionInstances,
      onContextRestored: () => {
        // O Safari devolve o contexto vazio: as texturas e os programas foram
        // embora. Recriar o pipeline é mais barato e mais seguro do que tentar
        // adivinhar o que sobreviveu — e a sessão não se perde.
        remountRef.current()
      },
    })

    if (generation !== generationRef.current) {
      pipeline.destroy()
      return
    }

    pipelineRef.current = pipeline
    pipeline.setApplications(
      resolveApplications(useSessionStore.getState().applications, geometry),
    )
    const bounds = stage.getBoundingClientRect()
    setStageSize({ width: bounds.width, height: bounds.height })
    setReady(true)
  }, [geometry, photoBlob, regionInstances])

  useEffect(() => {
    remountRef.current = () => {
      void mountPipeline()
    }
    void mountPipeline()

    return () => {
      generationRef.current += 1
      pipelineRef.current?.destroy()
      pipelineRef.current = null
    }
  }, [mountPipeline])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) {
        setStageSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        })
      }
      pipelineRef.current?.resize()
    })
    observer.observe(stage)
    return () => observer.disconnect()
  }, [])

  /**
   * Empurra o conjunto atual para a GPU, com uma sobreposição opcional viva.
   *
   * Lê o store direto em vez de depender do valor do render: durante o arrasto
   * não há render, e o valor capturado pela closure estaria velho.
   */
  const push = useCallback(
    (override?: (application: ResolvedApplication) => ResolvedApplication) => {
      const pipeline = pipelineRef.current
      if (!pipeline) return
      const resolved = resolveApplications(useSessionStore.getState().applications, geometry)
      pipeline.setApplications(override ? resolved.map(override) : resolved)
    },
    [geometry],
  )

  useEffect(() => {
    if (!ready) return
    push()
  }, [applications, push, ready])

  useEffect(() => {
    if (!notice) return
    const handle = setTimeout(clearNotice, 3200)
    return () => clearTimeout(handle)
  }, [notice, clearNotice])

  // -------------------------------------------------------------------------
  // Toque
  // -------------------------------------------------------------------------

  const presetFor = useCallback(
    (regionId: string, technique: Technique) =>
      presets.find((preset) => preset.region_id === regionId && preset.technique === technique) ??
      null,
    [presets],
  )

  const addAt = useCallback(
    (instance: RegionInstance, point: Point2) => {
      const preset = presetFor(instance.region.id, activeTechnique)
      addApplication({
        instance,
        point,
        technique: activeTechnique,
        intensity: preset?.default_intensity ?? DEFAULT_INTENSITY,
        radiusIpd: preset?.default_radius_ipd ?? DEFAULT_RADIUS_IPD,
      })
    },
    [activeTechnique, addApplication, presetFor],
  )

  const handleStagePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const overlay = overlayRef.current
      if (!overlay) return

      const bounds = overlay.getBoundingClientRect()
      const point = clientPointToImage(
        event.clientX,
        event.clientY,
        bounds,
        geometry.width,
        geometry.height,
      )
      if (!point) return

      const hit = hitTest(point, regionInstances)
      if (!hit) {
        select(null)
        return
      }
      addAt(hit.instance, point)
    },
    [addAt, geometry.height, geometry.width, regionInstances, select],
  )

  /** Arrasto do marcador: sem `setState` por movimento. */
  const startMarkerDrag = useCallback(
    (application: SessionApplication, event: React.PointerEvent<HTMLButtonElement>) => {
      event.stopPropagation()
      const overlay = overlayRef.current
      const pipeline = pipelineRef.current
      if (!overlay || !pipeline) return

      const marker = event.currentTarget
      marker.setPointerCapture(event.pointerId)
      pipeline.setDragging(true)
      select(application.id)

      let latest: Point2 | null = null

      const onMove = (moveEvent: PointerEvent) => {
        const bounds = overlay.getBoundingClientRect()
        const point = clientPointToImage(
          moveEvent.clientX,
          moveEvent.clientY,
          bounds,
          geometry.width,
          geometry.height,
        )
        if (!point) return
        latest = point

        const position = imagePointToClient(point, bounds, geometry.width, geometry.height)
        marker.style.transform = `translate(${position.x}px, ${position.y}px) translate(-50%, -50%)`

        push((resolved) =>
          resolved.id === application.id ? { ...resolved, u: point.x, v: point.y } : resolved,
        )
      }

      const onUp = () => {
        marker.removeEventListener('pointermove', onMove)
        marker.removeEventListener('pointerup', onUp)
        marker.removeEventListener('pointercancel', onUp)
        pipeline.setDragging(false)
        if (latest) moveApplication(application.id, latest)
      }

      marker.addEventListener('pointermove', onMove)
      marker.addEventListener('pointerup', onUp)
      marker.addEventListener('pointercancel', onUp)
    },
    [geometry.height, geometry.width, moveApplication, push, select],
  )

  // -------------------------------------------------------------------------
  // Antes/depois e ficha
  // -------------------------------------------------------------------------

  const openCompare = useCallback(async () => {
    const pipeline = pipelineRef.current
    if (!pipeline) return
    setCompareOpen(true)
    setBeforeBlob(photoBlob)
    setAfterBlob(await pipeline.snapshot())
  }, [photoBlob])

  const exportFicha = useCallback(async () => {
    if (!afterBlob) return
    setExporting(true)
    try {
      const regions = [
        ...new Set(
          useSessionStore.getState().applications.map(
            (application) =>
              `${regionInstances.find((instance) => instance.key === application.regionKey)?.region
                .label ?? application.regionId}`,
          ),
        ),
      ]

      const pdf = await buildFicha({
        patientName: patientName ?? "Paciente",
        professionalName: professional?.full_name ?? 'Profissional não identificado',
        council:
          professional?.council_type && professional.council_number
            ? `${professional.council_type} ${professional.council_number}`
            : null,
        before: photoBlob,
        after: afterBlob,
        at: new Date(),
        regions,
      })

      await deliverFicha(pdf, `previa-${(sessionId ?? "sessao").slice(0, 8)}.pdf`)
    } finally {
      setExporting(false)
    }
  }, [afterBlob, patientName, photoBlob, professional, regionInstances, sessionId])

  // -------------------------------------------------------------------------
  // Derivados de render
  // -------------------------------------------------------------------------

  const selected = useMemo(
    () => applications.find((application) => application.id === selectedId) ?? null,
    [applications, selectedId],
  )

  const stageRect = useMemo(
    () => new DOMRect(0, 0, stageSize.width, stageSize.height),
    [stageSize.height, stageSize.width],
  )

  /**
   * Pontos das regiões disponíveis.
   *
   * Só as regiões que aceitam a técnica ativa. Desenhar as outras apagadas
   * enchia o rosto de rótulo inútil — e o rosto é o conteúdo.
   *
   * O ponto fica no landmark de ancoragem da região, não no centróide do
   * polígono. Em região alongada como a linha mandibular, o centro do fecho
   * convexo cai no meio da bochecha: longe da mandíbula e por cima do ponto de
   * outra região.
   */
  const chips = useMemo(() => {
    if (stageSize.width === 0) return []

    return regionInstances
      .filter((instance) => instance.region.techniques.includes(activeTechnique))
      .map((instance) => {
        const anchor = geometry.landmarks[anchorIndexFor(instance.region, instance.side)]
        const point = anchor ? { x: anchor.x, y: anchor.y } : instance.centroid
        return {
          instance,
          point,
          position: imagePointToClient(point, stageRect, geometry.width, geometry.height),
        }
      })
  }, [
    activeTechnique,
    geometry.height,
    geometry.landmarks,
    geometry.width,
    regionInstances,
    stageRect,
    stageSize.width,
  ])

  const markers = useMemo(() => {
    if (stageSize.width === 0) return []
    return applications.flatMap((application) => {
      const point = resolvePoint(application, geometry)
      if (!point) return []
      return [
        {
          application,
          position: imagePointToClient(point, stageRect, geometry.width, geometry.height),
        },
      ]
    })
  }, [applications, geometry, stageRect, stageSize.width])

  return (
    // Retrato empilha, paisagem põe a barra ao lado. Nos dois casos a foto fica
    // num retângulo só dela: nenhum controle passa por cima do rosto (D-21).
    <div className="flex h-full w-full flex-col overflow-hidden bg-background landscape:flex-row">
      {/* O palco. Foto, anéis de região e marcadores — mais nada. */}
      <div className="relative min-h-0 min-w-0 flex-1">
        {/* Canvas do Pixi. O toque é tratado na camada de cima. */}
        <div ref={stageRef} className="absolute inset-0" />

        {/* Camada de interação e marcadores. */}
        <div
          ref={overlayRef}
          className="absolute inset-0 touch-none"
          onPointerDown={handleStagePointerDown}
        >
          {/* Posição e animação vivem em elementos separados de propósito: a
              cascata anima `transform`, e uma animação com `fill-mode: both`
              vence o estilo inline na cascata do CSS — o `transform: none` do
              último quadro apagaria a posição e empilharia todos os pontos no
              canto da tela. */}
          {chips.map(({ instance, point, position }) => (
            <span
              key={instance.key}
              className="absolute top-0 left-0"
              style={{
                transform: `translate(${position.x}px, ${position.y}px) translate(-50%, -50%)`,
              }}
            >
              <button
                type="button"
                aria-label={`${instance.region.label}${
                  instance.side === 'center'
                    ? ''
                    : instance.side === 'left'
                      ? ', lado esquerdo'
                      : ', lado direito'
                }. Aplicar ${TECHNIQUE_LABELS[activeTechnique].toLowerCase()}.`}
                // A cascata sobe: mento primeiro, testa por último.
                style={{ '--cascade-index': instance.region.cascadeOrder } as React.CSSProperties}
                className="previa-cascade flex touch-44 items-center justify-center"
                onPointerDown={(event) => {
                  event.stopPropagation()
                  addAt(instance, point)
                }}
              >
                {/* Anel, não cápsula com rótulo. Quinze rótulos sobre um rosto de
                    poucas centenas de pixels cobrem o rosto. O nome vive no
                    aria-label, aparece na barra ao selecionar, e todos aparecem
                    de uma vez em "Nomes". */}
                <span
                  aria-hidden="true"
                  className="block size-1.5 rounded-capsule border-2 border-label opacity-70"
                />
                {showLabels ? (
                  <span className="material pointer-events-none absolute top-full rounded-capsule px-1 text-caption whitespace-nowrap text-label">
                    {instance.region.label}
                  </span>
                ) : null}
              </button>
            </span>
          ))}

          {markers.map(({ application, position }) => (
            <button
              key={application.id}
              type="button"
              aria-label={`Aplicação em ${application.regionId}, intensidade ${Math.round(
                application.intensity * 100,
              )} por cento`}
              aria-pressed={application.id === selectedId}
              style={{
                transform: `translate(${position.x}px, ${position.y}px) translate(-50%, -50%)`,
              }}
              className="absolute top-0 left-0 flex touch-44 items-center justify-center rounded-capsule"
              onPointerDown={(event) => startMarkerDrag(application, event)}
            >
              {/* O marcador aparece no dedo antes de o warp calcular: ele é DOM
                  e entra no mesmo commit do React, enquanto o campo só é
                  reconstruído no frame seguinte. Latência percebida é o produto. */}
              <span
                className={[
                  'block size-1.5 rounded-capsule',
                  application.id === selectedId
                    ? 'bg-accent ring-2 ring-label'
                    : 'bg-label opacity-80',
                ].join(' ')}
              />
            </button>
          ))}
        </div>
      </div>

      {/* A barra de controles. Superfície opaca de verdade, não vidro: ela não
          cobre mais a foto, então não precisa deixar ver através. */}
      <aside
        aria-label="Controles"
        className="flex shrink-0 flex-col gap-1 bg-elevated p-1 safe-b safe-x landscape:h-full landscape:w-34 landscape:safe-t"
      >
        {/* Uma linha só quando cabe, duas quando não cabe. Em paisagem a coluna
            é estreita e isto vira pilha sozinho, sem variante de orientação. */}
        <div className="flex flex-wrap items-center justify-end gap-0.5">
          {patientName ? (
            <Link
              href="/pacientes"
              className="mr-auto flex min-w-0 touch-44 items-center gap-0.5 px-1 text-subhead"
            >
              <span className="shrink-0 text-accent">Pacientes</span>
              <span className="truncate text-label">{patientName}</span>
            </Link>
          ) : null}

          <div className="mr-auto flex items-center gap-0.5 rounded-capsule bg-fill-secondary px-0.5">
          <button
            type="button"
            aria-pressed={showLabels}
            onClick={() => setShowLabels((visible) => !visible)}
            className={[
              'flex touch-44 items-center justify-center rounded-capsule px-1 text-subhead',
              showLabels ? 'text-accent' : 'text-label-secondary',
            ].join(' ')}
          >
            Nomes
          </button>
          <button
            type="button"
            aria-label="Desfazer"
            disabled={!canUndo}
            onClick={undo}
            className="flex touch-44 items-center justify-center text-label disabled:opacity-30"
          >
            <IconUndo />
          </button>
          <button
            type="button"
            aria-label="Refazer"
            disabled={!canRedo}
            onClick={redo}
            className="flex touch-44 items-center justify-center text-label disabled:opacity-30"
          >
            <IconRedo />
          </button>
          <button
            type="button"
            aria-label="Antes e depois"
            onClick={() => void openCompare()}
            className="flex touch-44 items-center justify-center text-label"
          >
            <IconCompare />
          </button>
          </div>

          <Button variant="plain" className="shrink-0 px-1" onClick={onRetake}>
            Refazer foto
          </Button>
        </div>

        <div
          role="radiogroup"
          aria-label="Técnica"
          className="flex flex-wrap items-center gap-0.5 rounded-lg bg-fill-secondary p-0.5"
        >
          {TECHNIQUE_ORDER.map((technique) => (
            <button
              key={technique}
              type="button"
              role="radio"
              aria-checked={technique === activeTechnique}
              onClick={() => setActiveTechnique(technique)}
              className={[
                'flex grow basis-15 touch-44 items-center justify-center rounded-capsule px-1 text-center text-subhead',
                technique === activeTechnique ? 'bg-accent text-accent-on' : 'text-label-secondary',
              ].join(' ')}
            >
              {TECHNIQUE_LABELS[technique]}
            </button>
          ))}
        </div>

        {/* Linha de recado sempre presente, mesmo vazia: se ela aparecesse e
            sumisse, a barra mudaria de altura em retrato, e a foto inteira
            mudaria de tamanho no meio do trabalho. */}
        <p role="status" aria-live="polite" className="min-h-2.5 text-subhead text-label-secondary">
          {notice}
        </p>

        {/* Mesma razão, mesma solução: o espaço do ajuste fica reservado, então
            selecionar e desmarcar não mexe no tamanho da foto. */}
        <div className="min-h-14 landscape:min-h-11">
          {selected ? (
            <IntensityPanel
              application={selected}
              regionLabel={
                regionInstances.find((instance) => instance.key === selected.regionKey)?.region
                  .label ?? selected.regionId
              }
              techniqueLabel={TECHNIQUE_LABELS[selected.technique]}
              onLiveIntensity={(value) =>
                push((resolved) =>
                  resolved.id === selected.id ? { ...resolved, intensity: value } : resolved,
                )
              }
              onCommitIntensity={(value) => setIntensity(selected.id, value)}
              onLiveRadius={(value) =>
                push((resolved) =>
                  resolved.id === selected.id ? { ...resolved, radiusIpd: value } : resolved,
                )
              }
              onCommitRadius={(value) => setRadius(selected.id, value)}
              onRemove={() => removeApplication(selected.id)}
            />
          ) : (
            <p className="text-subhead text-label-secondary">
              Toque numa região do rosto para aplicar{' '}
              {TECHNIQUE_LABELS[activeTechnique].toLowerCase()}. Toque num ponto já aplicado para
              ajustar aqui.
            </p>
          )}
        </div>
      </aside>

      <CompareSheet
        open={compareOpen}
        onClose={() => setCompareOpen(false)}
        before={beforeBlob}
        after={afterBlob}
        exporting={exporting}
        onExport={professional ? () => void exportFicha() : undefined}
      />
    </div>
  )
}
