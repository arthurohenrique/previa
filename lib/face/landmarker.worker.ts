/// <reference lib="webworker" />

import * as Comlink from 'comlink'
import { FaceLandmarker, FilesetResolver, type FaceLandmarkerResult } from '@mediapipe/tasks-vision'
import { assessQuality, type QualityReport } from './quality'
import { measureIpdPx, poseFromMatrix } from './scale'
import type { FaceGeometry, Landmark } from './types'

/**
 * Detecção fora da main thread.
 *
 * Roda uma vez por foto e devolve os 478 landmarks, o ângulo da cabeça, a DIP e
 * o laudo de qualidade. Nada aqui volta a rodar durante a interação (D-06).
 *
 * O modelo e o runtime WASM vêm da própria origem, nunca de CDN (D-09).
 */

const WASM_PATH = '/mediapipe/wasm'
const MODEL_PATH = '/models/face_landmarker.task'

let landmarker: FaceLandmarker | null = null
let delegateInUse: 'GPU' | 'CPU' = 'GPU'

async function create(delegate: 'GPU' | 'CPU'): Promise<FaceLandmarker> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_PATH)
  return FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_PATH, delegate },
    runningMode: 'IMAGE',
    numFaces: 1,
    // A matriz é o que permite medir guinada, arfagem e rolagem sem estimar
    // pose por PnP na mão.
    outputFacialTransformationMatrixes: true,
    outputFaceBlendshapes: false,
  })
}

async function ensureLandmarker(): Promise<FaceLandmarker> {
  if (landmarker) return landmarker

  try {
    landmarker = await create('GPU')
    delegateInUse = 'GPU'
  } catch {
    // Alguns iPads em modo de baixo consumo recusam o contexto WebGL do
    // worker. CPU é mais lento, mas roda uma vez só — é melhor do que falhar.
    landmarker = await create('CPU')
    delegateInUse = 'CPU'
  }

  return landmarker
}

export type AnalyzeFailure =
  | { kind: 'no_face' }
  | { kind: 'multiple_faces' }
  | { kind: 'engine'; message: string }

export type AnalyzeResult =
  | { ok: true; geometry: FaceGeometry; quality: QualityReport; delegate: 'GPU' | 'CPU' }
  | { ok: false; failure: AnalyzeFailure }

function toLandmarks(result: FaceLandmarkerResult): Landmark[] | null {
  const first = result.faceLandmarks[0]
  if (!first || first.length === 0) return null
  return first.map((point) => ({ x: point.x, y: point.y, z: point.z }))
}

const api = {
  /** Aquece o modelo antes de a foto existir, para a detecção não pagar o load. */
  async warmup(): Promise<'GPU' | 'CPU'> {
    await ensureLandmarker()
    return delegateInUse
  },

  async analyze(bitmap: ImageBitmap): Promise<AnalyzeResult> {
    try {
      const engine = await ensureLandmarker()

      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) {
        return { ok: false, failure: { kind: 'engine', message: 'Canvas indisponível.' } }
      }
      context.drawImage(bitmap, 0, 0)

      const result = engine.detect(bitmap)
      const landmarks = toLandmarks(result)

      if (!landmarks) return { ok: false, failure: { kind: 'no_face' } }
      if (result.faceLandmarks.length > 1) {
        return { ok: false, failure: { kind: 'multiple_faces' } }
      }

      const matrix = result.facialTransformationMatrixes[0]?.data
      if (!matrix) {
        return {
          ok: false,
          failure: { kind: 'engine', message: 'Matriz de transformação ausente.' },
        }
      }

      const pose = poseFromMatrix(Array.from(matrix))
      const ipdPx = measureIpdPx(landmarks, bitmap.width, bitmap.height)
      const imageData = context.getImageData(0, 0, bitmap.width, bitmap.height)
      const quality = assessQuality(imageData, landmarks, pose, ipdPx)

      const geometry: FaceGeometry = {
        landmarks,
        pose,
        ipdPx,
        width: bitmap.width,
        height: bitmap.height,
      }

      return { ok: true, geometry, quality, delegate: delegateInUse }
    } catch (error) {
      return {
        ok: false,
        failure: {
          kind: 'engine',
          message: error instanceof Error ? error.message : 'Falha na detecção.',
        },
      }
    } finally {
      bitmap.close()
    }
  },

  dispose(): void {
    landmarker?.close()
    landmarker = null
  },
}

export type LandmarkerApi = typeof api

Comlink.expose(api)
