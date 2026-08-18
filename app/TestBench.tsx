'use client'

import { useCallback, useEffect, useState } from 'react'
import { PhotoCapture, type CaptureProblem } from '@/app/(app)/sessao/[id]/PhotoCapture'
import { Simulator } from '@/app/(app)/sessao/[id]/Simulator'
import {
  getPhoto,
  getSession,
  listApplications,
  putPhoto,
  putSession,
  replaceApplications,
  type LocalApplication,
} from '@/lib/db/dexie'
import { getRegion, type RegionId, type Side } from '@/lib/face/atlas'
import { analyzePhoto, warmupLandmarker } from '@/lib/face/landmarker'
import type { FaceGeometry } from '@/lib/face/types'
import { bitmapFromBlob, preparePhoto, type PreparedPhoto } from '@/lib/image/prepare'
import { resolvePoint, useSessionStore, type SessionApplication } from '@/store/useSessionStore'

/**
 * Fotografar e simular, sem mais nada em volta.
 *
 * Uma prévia só, no aparelho, sempre a mesma: recarregar a página devolve a foto
 * e as aplicações de onde pararam. Fotografar de novo substitui.
 */
const SESSAO = '00000000-0000-4000-8000-000000000001'
const PACIENTE = '00000000-0000-4000-8000-0000000000ff'

type Phase = 'loading' | 'capture' | 'analyzing' | 'ready'

/** Reconstrói o lado a partir do landmark âncora guardado. */
function sideFor(regionId: RegionId, anchorLandmark: number): Side {
  const region = getRegion(regionId)
  if (!region.bilateral) return 'center'
  return anchorLandmark === region.anchorLeft ? 'left' : 'right'
}

export function TestBench() {
  const [phase, setPhase] = useState<Phase>('loading')
  const [problem, setProblem] = useState<CaptureProblem | null>(null)
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null)

  // A geometria é congelada: detectada uma vez e nunca recalculada durante a
  // interação (D-06).
  const [geometry, setLocalGeometry] = useState<FaceGeometry | null>(null)

  const setGeometry = useSessionStore((state) => state.setGeometry)
  const hydrate = useSessionStore((state) => state.hydrate)
  const applications = useSessionStore((state) => state.applications)
  const reset = useSessionStore((state) => state.reset)

  // Aquecimento: o modelo carrega enquanto o profissional posiciona o paciente.
  useEffect(() => {
    void warmupLandmarker()
    return () => {
      reset()
    }
  }, [reset])

  useEffect(() => {
    let cancelled = false

    void (async () => {
      const local = await getSession(SESSAO)
      if (cancelled) return
      if (!local) {
        setPhase('capture')
        return
      }

      const [photo, stored] = await Promise.all([
        getPhoto(local.localImageRef),
        listApplications(SESSAO),
      ])
      if (cancelled) return
      if (!photo) {
        setPhase('capture')
        return
      }

      setLocalGeometry(local.geometry)
      setGeometry(local.geometry)
      setPhotoBlob(photo.blob)

      if (stored.length > 0) {
        hydrate(
          stored.map(
            (row) =>
              ({
                id: row.id,
                regionId: row.regionId,
                side: sideFor(row.regionId, row.anchorLandmark),
                regionKey: row.side === 'center' ? row.regionId : `${row.regionId}:${row.side}`,
                technique: row.technique,
                anchorLandmark: row.anchorLandmark,
                anchorOffsetU: row.anchorOffsetU,
                anchorOffsetV: row.anchorOffsetV,
                intensity: row.intensity,
                radiusIpd: row.radiusIpd,
                createdAt: row.createdAt,
              }) satisfies SessionApplication,
          ),
        )
      }

      setPhase('ready')
    })()

    return () => {
      cancelled = true
    }
  }, [setGeometry, hydrate])

  /**
   * Do JPEG limpo até a prévia pronta.
   *
   * A validação de qualidade continua bloqueante mesmo em teste: sem ela o
   * "depois" mente por ângulo em vez de mostrar o procedimento, e um teste que
   * mede a coisa errada é pior do que nenhum.
   */
  const analyzePrepared = useCallback(
    async (prepared: PreparedPhoto) => {
      setPhase('analyzing')
      setProblem(null)

      try {
        // Dois bitmaps do mesmo blob: um é transferido para o worker e fechado
        // lá; o outro fica para a textura do Pixi.
        const forAnalysis = await bitmapFromBlob(prepared.blob)
        const result = await analyzePhoto(forAnalysis)

        if (!result.ok) {
          setProblem({
            kind: 'message',
            message:
              result.failure.kind === 'no_face'
                ? 'Nenhum rosto na foto. Enquadre o rosto e refaça.'
                : result.failure.kind === 'multiple_faces'
                  ? 'Mais de um rosto na foto. Deixe só o paciente no enquadramento.'
                  : 'A detecção falhou. Refaça a foto.',
          })
          setPhase('capture')
          return
        }

        if (!result.quality.ok) {
          setProblem({ kind: 'quality', issues: result.quality.issues })
          setPhase('capture')
          return
        }

        const localImageRef = crypto.randomUUID()

        await putPhoto({
          id: localImageRef,
          sessionId: SESSAO,
          blob: prepared.blob,
          width: prepared.width,
          height: prepared.height,
          createdAt: Date.now(),
        })
        await putSession({
          id: SESSAO,
          patientId: PACIENTE,
          localImageRef,
          geometry: result.geometry,
          createdAt: Date.now(),
          syncedAt: null,
        })

        // Foto nova: marcação feita sobre outra foto não vale mais.
        await replaceApplications(SESSAO, [])
        reset()

        setLocalGeometry(result.geometry)
        setGeometry(result.geometry)
        setPhotoBlob(prepared.blob)
        setPhase('ready')
      } catch (error) {
        setProblem({
          kind: 'message',
          message:
            error instanceof Error && error.message
              ? error.message
              : 'Não foi possível preparar a foto. Refaça.',
        })
        setPhase('capture')
      }
    },
    [reset, setGeometry],
  )

  const handleFile = useCallback(
    async (file: File) => {
      setPhase('analyzing')
      setProblem(null)
      try {
        await analyzePrepared(await preparePhoto(file))
      } catch {
        setProblem({ kind: 'message', message: 'Não foi possível preparar a foto. Refaça.' })
        setPhase('capture')
      }
    },
    [analyzePrepared],
  )

  // Persistência local, com folga para o dedo terminar o gesto.
  useEffect(() => {
    if (phase !== 'ready' || !geometry) return

    const handle = setTimeout(() => {
      const rows: LocalApplication[] = []

      for (const application of applications) {
        const point = resolvePoint(application, geometry)
        if (!point) continue

        rows.push({
          id: application.id,
          sessionId: SESSAO,
          regionId: application.regionId,
          side: application.side,
          technique: application.technique,
          pointU: point.x,
          pointV: point.y,
          anchorLandmark: application.anchorLandmark,
          anchorOffsetU: application.anchorOffsetU,
          anchorOffsetV: application.anchorOffsetV,
          intensity: application.intensity,
          radiusIpd: application.radiusIpd,
          createdAt: application.createdAt,
          syncedAt: null,
        })
      }

      void replaceApplications(SESSAO, rows)
    }, 700)

    return () => clearTimeout(handle)
  }, [applications, geometry, phase])

  return (
    // Escuro fixo (E-01): julgar volume e tom de pele contra fundo claro engana
    // o olho.
    <div data-appearance="dark" className="h-dvh w-dvw overflow-hidden bg-background text-label">
      {phase === 'ready' && photoBlob && geometry ? (
        <Simulator
          photoBlob={photoBlob}
          geometry={geometry}
          onRetake={() => {
            setPhotoBlob(null)
            setPhase('capture')
          }}
        />
      ) : (
        <PhotoCapture
          busy={phase === 'analyzing' || phase === 'loading'}
          analyzing={phase === 'analyzing'}
          problem={problem}
          onFile={(file) => void handleFile(file)}
        />
      )}
    </div>
  )
}
