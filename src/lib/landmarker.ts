/**
 * FaceLandmarker do MediaPipe — carregamento sob demanda, assets 100% locais.
 *
 * WASM e pesos são servidos do próprio domínio (/public/models). Nenhuma
 * requisição sai para CDN: restrição inviolável do projeto.
 */

import {
  FaceLandmarker,
  FilesetResolver,
  type NormalizedLandmark,
} from '@mediapipe/tasks-vision'
import {
  estimateYawRatio,
  isFrontal,
  isSharp,
  laplacianVariance,
  SHARPNESS_MEASURE_WIDTH,
  toGrayscale,
  validateFaceCount,
  type QualityIssue,
} from './quality'

/** Índices de landmark usados na checagem de frontalidade. */
const NOSE_TIP = 1
const FACE_EDGE_LEFT = 234
const FACE_EDGE_RIGHT = 454

const WASM_PATH = '/models/wasm'
const MODEL_PATH = '/models/face_landmarker.task'

let loader: Promise<{ landmarker: FaceLandmarker; loadMs: number }> | null = null

/**
 * O WASM do MediaPipe escreve logs glog no stderr, que o navegador mapeia
 * para console.error/warn — o overlay do Next conta como erro real. Este
 * filtro rebaixa SÓ esse formato (INFO:/I0000/W0000…) para console.debug;
 * qualquer outro erro passa intacto.
 */
const GLOG_PATTERN = /^(INFO:\s|[IWE]\d{4}\s\d{2}:\d{2}:\d{2})/
let glogFilterInstalled = false

function installGlogFilter(): void {
  if (glogFilterInstalled) return
  glogFilterInstalled = true
  for (const level of ['error', 'warn'] as const) {
    const original = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
      if (typeof args[0] === 'string' && GLOG_PATTERN.test(args[0])) {
        console.debug(...args)
        return
      }
      original(...args)
    }
  }
}

/**
 * Singleton lazy: o modelo só é buscado quando a tela de simulação chama.
 * GPU primeiro; se o delegate falhar (WebGL restrito), refaz em CPU.
 */
function loadLandmarker(): Promise<{ landmarker: FaceLandmarker; loadMs: number }> {
  if (loader === null) {
    loader = (async () => {
      installGlogFilter()
      const start = performance.now()
      const fileset = await FilesetResolver.forVisionTasks(WASM_PATH)
      const options = (delegate: 'GPU' | 'CPU') =>
        ({
          baseOptions: { modelAssetPath: MODEL_PATH, delegate },
          runningMode: 'IMAGE',
          // 2 para conseguir DETECTAR múltiplos rostos e recusar a foto.
          numFaces: 2,
          outputFaceBlendshapes: false,
          outputFacialTransformationMatrixes: false,
        }) as const
      let landmarker: FaceLandmarker
      try {
        landmarker = await FaceLandmarker.createFromOptions(fileset, options('GPU'))
      } catch {
        landmarker = await FaceLandmarker.createFromOptions(fileset, options('CPU'))
      }
      return { landmarker, loadMs: performance.now() - start }
    })()
    // Falha de carregamento não pode envenenar a sessão: permite tentar de novo.
    loader.catch(() => {
      loader = null
    })
  }
  return loader
}

export interface FaceAnalysis {
  /** 478 landmarks normalizados do único rosto validado. */
  landmarks: NormalizedLandmark[]
  /** Tempo da inferência do FaceLandmarker, em ms. */
  inferenceMs: number
  /** Tempo de carga do WASM + modelo (0 quando já estava em memória), em ms. */
  modelLoadMs: number
  /** Variância do Laplaciano medida a 256px de largura. */
  sharpness: number
  /** Razão de simetria nariz-bordas (1.0 = frontal perfeito). */
  yawRatio: number
}

export type AnalysisResult =
  | { ok: true; analysis: FaceAnalysis }
  | { ok: false; issue: QualityIssue }

/** Nitidez medida em escala fixa para o limiar valer em qualquer foto. */
function measureSharpness(image: HTMLImageElement): number {
  const scale = SHARPNESS_MEASURE_WIDTH / image.naturalWidth
  const width = SHARPNESS_MEASURE_WIDTH
  const height = Math.max(3, Math.round(image.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return Number.POSITIVE_INFINITY
  context.drawImage(image, 0, 0, width, height)
  const { data } = context.getImageData(0, 0, width, height)
  return laplacianVariance(toGrayscale(data), width, height)
}

/**
 * Pipeline da Fase 2: carrega o modelo (se preciso), roda a inferência UMA
 * vez sobre a imagem e aplica as validações de qualidade.
 */
export async function analyzeFace(image: HTMLImageElement): Promise<AnalysisResult> {
  const { landmarker, loadMs } = await loadLandmarker()

  const inferenceStart = performance.now()
  const result = landmarker.detect(image)
  const inferenceMs = performance.now() - inferenceStart

  const countIssue = validateFaceCount(result.faceLandmarks.length)
  if (countIssue !== null) return { ok: false, issue: countIssue }

  const landmarks = result.faceLandmarks[0]
  const yawRatio = estimateYawRatio(
    landmarks[NOSE_TIP],
    landmarks[FACE_EDGE_LEFT],
    landmarks[FACE_EDGE_RIGHT],
  )
  if (!isFrontal(yawRatio)) return { ok: false, issue: 'rosto-de-perfil' }

  const sharpness = measureSharpness(image)
  if (!isSharp(sharpness)) return { ok: false, issue: 'sem-nitidez' }

  return {
    ok: true,
    analysis: { landmarks, inferenceMs, modelLoadMs: loadMs, sharpness, yawRatio },
  }
}
