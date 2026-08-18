'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { getRegion, type RegionId, type Side } from '@/lib/face/atlas'
import { newId } from '@/lib/id'
import { analyzePhoto, warmupLandmarker } from '@/lib/face/landmarker'
import type { FaceGeometry } from '@/lib/face/types'
import { preparePhoto, type PreparedPhoto } from '@/lib/image/prepare'
import {
  getPhoto,
  getSession,
  putPhoto,
  putSession,
  replaceApplications,
  type LocalApplication,
} from '@/lib/db/dexie'
import type { Technique } from '@/lib/supabase/types'
import { resolvePoint, useSessionStore, type SessionApplication } from '@/store/useSessionStore'
import { PhotoCapture, type CaptureProblem } from './PhotoCapture'
import { RemoteCaptureSheet } from './RemoteCaptureSheet'
import { Simulator } from './Simulator'
import { createSession, syncApplications } from './actions'

export interface PresetRow {
  id: string
  region_id: string
  technique: Technique
  label: string
  default_intensity: number
  default_radius_ipd: number
  notes: string | null
}

interface SessionScreenProps {
  sessionId: string
  patient: { id: string; full_name: string }
  existingSession: {
    id: string
    local_image_ref: string
    ipd_px: number
    yaw: number
    pitch: number
    roll: number
    created_at: string
  } | null
  presets: PresetRow[]
  professional: { full_name: string; council_type: string | null; council_number: string | null } | null
  persistedApplications: Array<{
    id: string
    region_id: string
    technique: Technique
    point_u: number
    point_v: number
    anchor_landmark: number
    anchor_offset_u: number
    anchor_offset_v: number
    intensity: number
    radius_ipd: number
  }>
}

type Phase = 'loading' | 'capture' | 'analyzing' | 'ready'

/** Reconstrói o lado a partir do landmark âncora gravado no banco. */
function sideFor(regionId: RegionId, anchorLandmark: number): Side {
  const region = getRegion(regionId)
  if (!region.bilateral) return 'center'
  return anchorLandmark === region.anchorLeft ? 'left' : 'right'
}

export function SessionScreen(props: SessionScreenProps) {
  const { sessionId, patient, existingSession, presets, professional, persistedApplications } = props

  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('loading')
  const [problem, setProblem] = useState<CaptureProblem | null>(null)
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null)
  const [remoteOpen, setRemoteOpen] = useState(false)

  // A geometria é congelada: detectada uma vez e nunca recalculada durante a
  // interação (D-06). Ela é escrita uma única vez por foto e daí em diante é uma
  // referência estável, que o simulador recebe como prop.
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

  // Reabertura: a foto e a geometria vivem no IndexedDB do dispositivo.
  useEffect(() => {
    let cancelled = false

    void (async () => {
      const local = await getSession(sessionId)
      if (cancelled) return

      if (!local) {
        setPhase('capture')
        return
      }

      const photo = await getPhoto(local.localImageRef)
      if (cancelled) return

      if (!photo) {
        // Sessão criada em outro tablet: os metadados existem, a imagem não.
        setPhase('capture')
        return
      }

      setLocalGeometry(local.geometry)
      setGeometry(local.geometry)
      setPhotoBlob(photo.blob)

      if (persistedApplications.length > 0) {
        hydrate(
          persistedApplications.map((row) => {
            const regionId = row.region_id as RegionId
            const side = sideFor(regionId, row.anchor_landmark)
            return {
              id: row.id,
              regionId,
              side,
              regionKey: side === 'center' ? regionId : `${regionId}:${side}`,
              technique: row.technique,
              anchorLandmark: row.anchor_landmark,
              anchorOffsetU: row.anchor_offset_u,
              anchorOffsetV: row.anchor_offset_v,
              intensity: row.intensity,
              radiusIpd: row.radius_ipd,
              createdAt: Date.parse(local.createdAt ? String(local.createdAt) : '') || Date.now(),
            } satisfies SessionApplication
          }),
        )
      }

      setPhase('ready')
    })()

    return () => {
      cancelled = true
    }
  }, [sessionId, persistedApplications, setGeometry, hydrate])

  /**
   * Do JPEG limpo até a sessão pronta.
   *
   * O mesmo caminho serve à foto tirada aqui e à que chegou do celular: a
   * validação de qualidade é do produto, não do aparelho, e uma foto que chegou
   * de fora é justamente a que mais precisa passar por ela.
   */
  const analyzePrepared = useCallback(
    async (prepared: PreparedPhoto) => {
      setPhase('analyzing')
      setProblem(null)

      try {
        const result = await analyzePhoto(prepared.blob)

        if (!result.ok) {
          setProblem(
            result.failure.kind === 'no_face'
              ? { kind: 'message', message: 'Nenhum rosto na foto. Enquadre o rosto e refaça.' }
              : result.failure.kind === 'multiple_faces'
                ? {
                    kind: 'message',
                    message: 'Mais de um rosto na foto. Deixe só o paciente no enquadramento.',
                  }
                : { kind: 'message', message: 'A detecção falhou. Refaça a foto.' },
          )
          setPhase('capture')
          return
        }

        if (!result.quality.ok) {
          setProblem({ kind: 'quality', issues: result.quality.issues })
          setPhase('capture')
          return
        }

        const localImageRef = existingSession?.local_image_ref ?? newId()

        await putPhoto({
          id: localImageRef,
          sessionId,
          blob: prepared.blob,
          width: prepared.width,
          height: prepared.height,
          createdAt: Date.now(),
        })
        await putSession({
          id: sessionId,
          patientId: patient.id,
          localImageRef,
          geometry: result.geometry,
          createdAt: Date.now(),
          syncedAt: null,
        })

        if (!existingSession) {
          const created = await createSession({
            id: sessionId,
            patient_id: patient.id,
            local_image_ref: localImageRef,
            ipd_px: result.geometry.ipdPx,
            yaw: result.geometry.pose.yaw,
            pitch: result.geometry.pose.pitch,
            roll: result.geometry.pose.roll,
          })

          if (!created.ok) {
            setProblem({ kind: 'message', message: created.message })
            setPhase('capture')
            return
          }
          router.refresh()
        }

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
    [existingSession, patient.id, router, sessionId, setGeometry],
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

  /**
   * Foto vinda do celular pelo canal de dados.
   *
   * Ela já chega preparada — o celular converteu HEIC, reduziu para 2048 px e
   * apagou o EXIF antes de enviar, que é onde mora o GPS. Aqui ela entra no
   * mesmo funil de qualidade da foto local.
   */
  const handleRemotePhoto = useCallback(
    (photo: { blob: Blob; width: number; height: number }) => {
      setRemoteOpen(false)
      void analyzePrepared(photo)
    },
    [analyzePrepared],
  )

  // Espelho local + metadados. O local é a verdade; o Supabase é a cópia
  // auditável, e nenhum dos dois carrega imagem.
  useEffect(() => {
    if (phase !== 'ready' || !geometry) return

    const handle = setTimeout(() => {
      const rows: LocalApplication[] = []
      const remote: Array<Record<string, unknown>> = []

      for (const application of applications) {
        const point = resolvePoint(application, geometry)
        if (!point) continue

        rows.push({
          id: application.id,
          sessionId,
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

        remote.push({
          id: application.id,
          region_id: application.regionId,
          technique: application.technique,
          point_u: Math.min(1, Math.max(0, point.x)),
          point_v: Math.min(1, Math.max(0, point.y)),
          anchor_landmark: application.anchorLandmark,
          anchor_offset_u: application.anchorOffsetU,
          anchor_offset_v: application.anchorOffsetV,
          intensity: application.intensity,
          radius_ipd: application.radiusIpd,
        })
      }

      void replaceApplications(sessionId, rows)
      void syncApplications({ session_id: sessionId, applications: remote })
    }, 700)

    return () => clearTimeout(handle)
  }, [applications, geometry, phase, sessionId])

  return (
    // E-01: a tela do simulador é escuro fixo, independente da preferência do
    // sistema. Julgar volume e tom de pele contra fundo claro engana o olho.
    <div data-appearance="dark" className="h-full w-full bg-background text-label">
      {phase === 'ready' && photoBlob && geometry ? (
        <Simulator
          sessionId={sessionId}
          patientName={patient.full_name}
          photoBlob={photoBlob}
          geometry={geometry}
          presets={presets}
          professional={professional}
          onRetake={() => {
            setPhotoBlob(null)
            setPhase('capture')
          }}
        />
      ) : (
        <>
          <PhotoCapture
            patientName={patient.full_name}
            busy={phase === 'analyzing' || phase === 'loading'}
            analyzing={phase === 'analyzing'}
            problem={problem}
            onFile={(file) => void handleFile(file)}
            onUsePhone={() => setRemoteOpen(true)}
          />
          <RemoteCaptureSheet
            open={remoteOpen}
            sessionId={sessionId}
            patientId={patient.id}
            onClose={() => setRemoteOpen(false)}
            onPhoto={handleRemotePhoto}
          />
        </>
      )}
    </div>
  )
}
