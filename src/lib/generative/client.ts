/**
 * Fachada da prévia realista: recorte da região ativa → img2img local no
 * worker → composição de volta SÓ dentro da máscara (pluma na borda).
 * O warp determinístico já aplicado é o guia geométrico da difusão.
 */

import type { RegionId } from '@/lib/anatomy'
import { buildShadingSource } from '@/lib/deform/shading'
import { boxBlurAlpha, type LabelMap } from '@/lib/segmentation/mask'
import type { Point2 } from '@/lib/quality'
import {
  alphaBBox,
  compositeCrop,
  rgbaToTensor,
  squareCrop,
  tensorToRgba,
} from './compose'
import {
  GENERATION_SIZE,
  type GenerateRequest,
  type GenerationWorkerMessage,
} from './types'

const PROMPT =
  'close-up photo of a face after subtle cosmetic filler, naturally fuller volume, ' +
  'smooth realistic skin texture, photorealistic, sharp, natural lighting'
const NEGATIVE_PROMPT =
  'deformed, disfigured, cartoon, painting, blurry, artifacts, oversaturated, extra teeth, text'

export type GenerationProgress =
  | { stage: 'preparando' }
  | { stage: 'carregando-modelo'; progress: number }
  | { stage: 'gerando'; step: number; total: number }
  | { stage: 'compondo' }

/**
 * O modelo não é versionado (2,2GB): dev baixa via script, produção serve
 * via rewrite para storage próprio. Antes de gerar, confirmamos que ele
 * está de fato acessível — sem isso o erro vira um 404 críptico no worker.
 */
export async function checkModelAvailable(): Promise<boolean> {
  try {
    const response = await fetch('/models/generative/model_index.json', {
      method: 'HEAD',
    })
    return (
      response.ok &&
      !(response.headers.get('content-type') ?? '').startsWith('text/html')
    )
  } catch {
    return false
  }
}

let worker: Worker | null = null

function getWorker(): Worker {
  if (worker === null) {
    worker = new Worker(
      new URL('../../workers/generation.worker.ts', import.meta.url),
      { type: 'module' },
    )
  }
  return worker
}

function runWorker(
  request: GenerateRequest,
  onProgress: (progress: GenerationProgress) => void,
): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const instance = getWorker()

    const handleMessage = (event: MessageEvent<GenerationWorkerMessage>) => {
      const message = event.data
      if (message.type === 'progress') {
        if (message.stage === 'baixando') {
          onProgress({ stage: 'carregando-modelo', progress: message.progress })
        } else if (message.stage === 'carregando') {
          onProgress({ stage: 'carregando-modelo', progress: 1 })
        } else {
          onProgress({ stage: 'gerando', step: message.step, total: message.total })
        }
        return
      }
      cleanup()
      if (message.type === 'done') {
        resolve(new Float32Array(message.image))
      } else {
        reject(new Error(message.message))
      }
    }

    const handleError = (event: ErrorEvent) => {
      cleanup()
      reject(new Error(event.message || 'Worker de geração falhou.'))
    }

    const cleanup = () => {
      instance.removeEventListener('message', handleMessage)
      instance.removeEventListener('error', handleError)
    }

    instance.addEventListener('message', handleMessage)
    instance.addEventListener('error', handleError)
    instance.postMessage(request, [request.image.buffer])
  })
}

export interface RealisticPreviewInput {
  /** Foto já deformada pelo motor determinístico (guia geométrico). */
  deformedCanvas: HTMLCanvasElement
  map: LabelMap
  landmarks: readonly Point2[]
  /** Regiões com intensidade > 0 e suas intensidades. */
  activeRegions: ReadonlyArray<{ region: RegionId; intensity: number }>
  onProgress: (progress: GenerationProgress) => void
}

/** Gera a prévia realista e devolve um canvas na resolução da foto. */
export async function generateRealisticPreview(
  input: RealisticPreviewInput,
): Promise<HTMLCanvasElement> {
  input.onProgress({ stage: 'preparando' })

  if (!(await checkModelAvailable())) {
    throw new Error(
      'O modelo generativo não está instalado neste ambiente. Em desenvolvimento, rode scripts/download-generative-model.ps1; em produção, configure GENERATIVE_MODELS_URL (ver README).',
    )
  }

  const { width, height } = input.deformedCanvas

  // União das máscaras das regiões ativas (na resolução do labelmap).
  const union = new Uint8ClampedArray(input.map.width * input.map.height)
  let intensityMax = 0
  for (const { region, intensity } of input.activeRegions) {
    if (intensity <= 0) continue
    intensityMax = Math.max(intensityMax, intensity)
    const source = buildShadingSource(region, input.landmarks, input.map)
    for (let i = 0; i < union.length; i++) {
      const alpha = source.pixels[i * 4 + 3]
      if (alpha > union[i]) union[i] = alpha
    }
  }

  const bboxMap = alphaBBox(union, input.map.width, input.map.height)
  if (bboxMap === null) throw new Error('Nenhuma região ativa para gerar.')

  // Escala labelmap → foto e recorte quadrado com contexto.
  const scaleX = width / input.map.width
  const scaleY = height / input.map.height
  const crop = squareCrop(
    {
      x0: Math.floor(bboxMap.x0 * scaleX),
      y0: Math.floor(bboxMap.y0 * scaleY),
      x1: Math.ceil(bboxMap.x1 * scaleX),
      y1: Math.ceil(bboxMap.y1 * scaleY),
    },
    width,
    height,
  )

  // Recorte → 512×512 → tensor CHW [-1,1].
  const cropCanvas = document.createElement('canvas')
  cropCanvas.width = GENERATION_SIZE
  cropCanvas.height = GENERATION_SIZE
  const cropContext = cropCanvas.getContext('2d')
  if (cropContext === null) throw new Error('Canvas 2D indisponível.')
  cropContext.drawImage(
    input.deformedCanvas,
    crop.x, crop.y, crop.size, crop.size,
    0, 0, GENERATION_SIZE, GENERATION_SIZE,
  )
  const cropPixels = cropContext.getImageData(0, 0, GENERATION_SIZE, GENERATION_SIZE).data
  const tensor = rgbaToTensor(new Uint8ClampedArray(cropPixels), GENERATION_SIZE)

  // Força proporcional à intensidade: pouco filler = pouca liberdade.
  const strength = 0.3 + 0.25 * intensityMax

  const output = await runWorker(
    {
      type: 'generate',
      image: tensor,
      prompt: PROMPT,
      negativePrompt: NEGATIVE_PROMPT,
      strength,
      steps: 6,
      seed: '1234',
    },
    input.onProgress,
  )

  input.onProgress({ stage: 'compondo' })

  // Máscara em pluma na resolução da geração, via canvas de reamostragem.
  const maskCanvas = document.createElement('canvas')
  maskCanvas.width = GENERATION_SIZE
  maskCanvas.height = GENERATION_SIZE
  const maskContext = maskCanvas.getContext('2d')
  if (maskContext === null) throw new Error('Canvas 2D indisponível.')
  const unionCanvas = document.createElement('canvas')
  unionCanvas.width = input.map.width
  unionCanvas.height = input.map.height
  const unionContext = unionCanvas.getContext('2d')
  if (unionContext === null) throw new Error('Canvas 2D indisponível.')
  const unionImage = unionContext.createImageData(input.map.width, input.map.height)
  for (let i = 0; i < union.length; i++) {
    unionImage.data[i * 4] = 255
    unionImage.data[i * 4 + 1] = 255
    unionImage.data[i * 4 + 2] = 255
    unionImage.data[i * 4 + 3] = union[i]
  }
  unionContext.putImageData(unionImage, 0, 0)
  maskContext.drawImage(
    unionCanvas,
    crop.x / scaleX, crop.y / scaleY, crop.size / scaleX, crop.size / scaleY,
    0, 0, GENERATION_SIZE, GENERATION_SIZE,
  )
  const maskAlphaRgba = maskContext.getImageData(0, 0, GENERATION_SIZE, GENERATION_SIZE).data
  const maskAlpha = new Uint8ClampedArray(GENERATION_SIZE * GENERATION_SIZE)
  for (let i = 0; i < maskAlpha.length; i++) maskAlpha[i] = maskAlphaRgba[i * 4 + 3]
  const feathered = boxBlurAlpha(maskAlpha, GENERATION_SIZE, GENERATION_SIZE, 6)

  // Resultado 512 → resolução do recorte na foto.
  const generatedRgba = tensorToRgba(output, GENERATION_SIZE)
  const generated512 = document.createElement('canvas')
  generated512.width = GENERATION_SIZE
  generated512.height = GENERATION_SIZE
  const generated512Context = generated512.getContext('2d')
  if (generated512Context === null) throw new Error('Canvas 2D indisponível.')
  generated512Context.putImageData(
    new ImageData(new Uint8ClampedArray(generatedRgba), GENERATION_SIZE, GENERATION_SIZE),
    0,
    0,
  )

  const cropScaleCanvas = document.createElement('canvas')
  cropScaleCanvas.width = crop.size
  cropScaleCanvas.height = crop.size
  const cropScaleContext = cropScaleCanvas.getContext('2d')
  if (cropScaleContext === null) throw new Error('Canvas 2D indisponível.')
  cropScaleContext.drawImage(generated512, 0, 0, crop.size, crop.size)
  const generatedCrop = cropScaleContext.getImageData(0, 0, crop.size, crop.size).data

  const featherCanvas = document.createElement('canvas')
  featherCanvas.width = crop.size
  featherCanvas.height = crop.size
  const featherContext = featherCanvas.getContext('2d')
  if (featherContext === null) throw new Error('Canvas 2D indisponível.')
  const featherImage = featherContext.createImageData(GENERATION_SIZE, GENERATION_SIZE)
  for (let i = 0; i < feathered.length; i++) {
    featherImage.data[i * 4] = 255
    featherImage.data[i * 4 + 1] = 255
    featherImage.data[i * 4 + 2] = 255
    featherImage.data[i * 4 + 3] = feathered[i]
  }
  const feather512 = document.createElement('canvas')
  feather512.width = GENERATION_SIZE
  feather512.height = GENERATION_SIZE
  feather512.getContext('2d')?.putImageData(featherImage, 0, 0)
  featherContext.drawImage(feather512, 0, 0, crop.size, crop.size)
  const featherCropRgba = featherContext.getImageData(0, 0, crop.size, crop.size).data
  const featherCrop = new Uint8ClampedArray(crop.size * crop.size)
  for (let i = 0; i < featherCrop.length; i++) featherCrop[i] = featherCropRgba[i * 4 + 3]

  // Composição final sobre a foto deformada.
  const result = document.createElement('canvas')
  result.width = width
  result.height = height
  const resultContext = result.getContext('2d')
  if (resultContext === null) throw new Error('Canvas 2D indisponível.')
  resultContext.drawImage(input.deformedCanvas, 0, 0)
  const resultImage = resultContext.getImageData(0, 0, width, height)
  compositeCrop(
    new Uint8ClampedArray(resultImage.data.buffer) as Uint8ClampedArray,
    width,
    new Uint8ClampedArray(generatedCrop),
    featherCrop,
    crop,
  )
  resultContext.putImageData(resultImage, 0, 0)
  return result
}
