/**
 * Fachada da segmentação: resolve a estratégia (config + perfil) e entrega
 * um LabelMap com métricas, seja pela IA no worker, seja pelos landmarks.
 */

import { rasterizeLandmarkMask } from './landmarkMask'
import type {
  SegmentationOutput,
  SegmentationProgress,
  SegmentationStrategy,
  WorkerMessage,
} from './types'
import type { ExecutionProfile } from '@/lib/profile'
import type { Point2 } from '@/lib/quality'

/**
 * PORTÃO DA FASE 2.5 (medido em 2026-08-23, desktop 8 cores + WebGPU):
 * SegFormer face-parsing q8 levou 20,6–21,3s de inferência e 11s de carga
 * (modelo de 89MB) — mais de 6× o limite de 3s definido para o perfil BAIXO,
 * medido no perfil ALTO. Resultado: 'auto' resolve para landmarks em todos os
 * perfis; a IA continua disponível por escolha manual na configuração.
 */
export function resolveStrategy(
  strategy: SegmentationStrategy,
  _profile: ExecutionProfile,
): 'ia' | 'landmarks' {
  if (strategy !== 'auto') return strategy
  return 'landmarks'
}

let worker: Worker | null = null

function getWorker(): Worker {
  if (worker === null) {
    worker = new Worker(
      new URL('../../workers/segmentation.worker.ts', import.meta.url),
      { type: 'module' },
    )
  }
  return worker
}

function segmentWithWorker(
  bitmap: ImageBitmap,
  onProgress: (progress: SegmentationProgress) => void,
): Promise<SegmentationOutput> {
  return new Promise((resolve, reject) => {
    const instance = getWorker()

    const handleMessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data
      if (message.type === 'progress') {
        onProgress(
          message.stage === 'download'
            ? { stage: 'download', progress: message.progress }
            : { stage: 'inferindo' },
        )
        return
      }
      cleanup()
      if (message.type === 'done') {
        resolve({
          map: {
            labels: new Uint8Array(message.labels),
            width: message.width,
            height: message.height,
          },
          meta: message.meta,
        })
      } else {
        reject(new Error(message.message))
      }
    }

    const handleError = (event: ErrorEvent) => {
      cleanup()
      reject(new Error(event.message || 'Worker de segmentação falhou.'))
    }

    const cleanup = () => {
      instance.removeEventListener('message', handleMessage)
      instance.removeEventListener('error', handleError)
    }

    instance.addEventListener('message', handleMessage)
    instance.addEventListener('error', handleError)
    instance.postMessage({ type: 'segment', bitmap }, [bitmap])
  })
}

export interface SegmentInput {
  photo: Blob
  photoWidth: number
  photoHeight: number
  landmarks: readonly Point2[]
  strategy: SegmentationStrategy
  profile: ExecutionProfile
  onProgress: (progress: SegmentationProgress) => void
}

export async function segmentPhoto(input: SegmentInput): Promise<SegmentationOutput> {
  const resolved = resolveStrategy(input.strategy, input.profile)

  if (resolved === 'landmarks') {
    const start = performance.now()
    const map = rasterizeLandmarkMask(input.landmarks, input.photoWidth, input.photoHeight)
    return {
      map,
      meta: {
        backend: 'landmarks',
        modelLoadMs: 0,
        inferenceMs: performance.now() - start,
        memoryPeakMB: null,
      },
    }
  }

  const bitmap = await createImageBitmap(input.photo)
  return segmentWithWorker(bitmap, input.onProgress)
}
