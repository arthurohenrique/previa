import { FaceLandmarker, FilesetResolver, type FaceLandmarkerResult } from '@mediapipe/tasks-vision'
import { assessQuality, type QualityReport } from './quality'
import { measureIpdPx, poseFromMatrix } from './scale'
import type { FaceGeometry, Landmark } from './types'

/**
 * O núcleo da análise, sem saber onde roda.
 *
 * O mesmo código serve o worker e a main thread, porque a detecção precisa dos
 * dois: o worker é o caminho normal (não trava a interface durante o load do
 * WASM), e a main thread é o plano B para os WebKits em que o worker não tem
 * nem `document` nem `OffscreenCanvas` — lá, qualquer canvas que o runtime do
 * MediaPipe tente criar explode, e só a main thread tem onde desenhar.
 *
 * A diferença entre os dois ambientes fica inteira em `acquireCanvas`.
 */

const WASM_PATH = '/mediapipe/wasm'
const MODEL_PATH = '/models/face_landmarker.task'

export type AnalyzeFailure =
  | { kind: 'no_face' }
  | { kind: 'multiple_faces' }
  | { kind: 'engine'; message: string }

export type AnalyzeResult =
  | { ok: true; geometry: FaceGeometry; quality: QualityReport; delegate: 'GPU' | 'CPU' }
  | { ok: false; failure: AnalyzeFailure }

/** Um canvas 2D onde quer que estejamos. `null` quando o ambiente não tem nenhum. */
function acquireCanvas(
  width: number,
  height: number,
): OffscreenCanvas | HTMLCanvasElement | null {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    return canvas
  }
  return null
}

/** Estado do engine, um por ambiente (o worker tem o dele, a main o dela). */
export interface EngineHolder {
  landmarker: FaceLandmarker | null
  delegate: 'GPU' | 'CPU'
}

export function createEngineHolder(): EngineHolder {
  return { landmarker: null, delegate: 'GPU' }
}

async function create(delegate: 'GPU' | 'CPU'): Promise<FaceLandmarker> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_PATH)
  // O canvas vai explícito quando o ambiente tem um. Sem isso, o runtime testa
  // OffscreenCanvas do jeito dele, reprova no WebKit e cai em
  // `document.createElement` — que num worker não existe.
  const canvas = acquireCanvas(1, 1) ?? undefined
  return FaceLandmarker.createFromOptions(fileset, {
    ...(canvas ? { canvas } : {}),
    baseOptions: { modelAssetPath: MODEL_PATH, delegate },
    runningMode: 'IMAGE',
    numFaces: 1,
    // A matriz é o que permite medir guinada, arfagem e rolagem sem estimar
    // pose por PnP na mão.
    outputFacialTransformationMatrixes: true,
    outputFaceBlendshapes: false,
  })
}

export async function ensureEngine(holder: EngineHolder): Promise<FaceLandmarker> {
  if (holder.landmarker) return holder.landmarker

  try {
    holder.landmarker = await create('GPU')
    holder.delegate = 'GPU'
  } catch {
    // Alguns iPads em modo de baixo consumo recusam o contexto WebGL. CPU é
    // mais lento, mas roda uma vez só — é melhor do que falhar.
    holder.landmarker = await create('CPU')
    holder.delegate = 'CPU'
  }

  return holder.landmarker
}

/**
 * Derruba o delegate GPU e refaz em CPU.
 *
 * Existe porque criar em GPU pode funcionar e só o `detect()` quebrar — o
 * fallback da criação nunca dispara nesse caso, e o erro apareceria na primeira
 * foto de todo aparelho afetado.
 */
async function recreateOnCpu(holder: EngineHolder): Promise<FaceLandmarker> {
  try {
    holder.landmarker?.close()
  } catch {
    // O estado interno pode já estar quebrado; fechar é cortesia.
  }
  holder.landmarker = await create('CPU')
  holder.delegate = 'CPU'
  return holder.landmarker
}

function toLandmarks(result: FaceLandmarkerResult): Landmark[] | null {
  const first = result.faceLandmarks[0]
  if (!first || first.length === 0) return null
  return first.map((point) => ({ x: point.x, y: point.y, z: point.z }))
}

/**
 * Detecta, mede a pose e a DIP, e avalia a qualidade. Fecha o bitmap ao final,
 * tenha dado certo ou não — quem chama não o reaproveita.
 */
export async function analyzeBitmap(
  holder: EngineHolder,
  bitmap: ImageBitmap,
): Promise<AnalyzeResult> {
  try {
    const engine = await ensureEngine(holder)

    const canvas = acquireCanvas(bitmap.width, bitmap.height)
    const context = canvas?.getContext('2d', { willReadFrequently: true }) as
      | OffscreenCanvasRenderingContext2D
      | CanvasRenderingContext2D
      | null
    if (!context) {
      return { ok: false, failure: { kind: 'engine', message: 'Canvas indisponível.' } }
    }
    context.drawImage(bitmap, 0, 0)

    let result: FaceLandmarkerResult
    try {
      result = engine.detect(bitmap)
    } catch (error) {
      if (holder.delegate === 'GPU') {
        result = (await recreateOnCpu(holder)).detect(bitmap)
      } else {
        throw error
      }
    }

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

    return { ok: true, geometry, quality, delegate: holder.delegate }
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
}
