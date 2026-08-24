/**
 * Web Worker de segmentação facial (Transformers.js + SegFormer face-parsing).
 *
 * Tudo local: modelo em /models/face-parsing, runtime ONNX em /models/ort.
 * `allowRemoteModels = false` garante que nenhuma requisição vai ao Hub.
 * WebGPU quando o adapter existe; senão WASM. A imagem roda UMA vez.
 */

import {
  env,
  pipeline,
  RawImage,
  type ImageSegmentationPipeline,
  type ProgressInfo,
} from '@huggingface/transformers'
import { FACE_CLASSES, type FaceClassName } from '@/lib/segmentation/mask'
import type {
  SegmentationBackend,
  SegmentRequest,
  WorkerMessage,
} from '@/lib/segmentation/types'

env.allowRemoteModels = false
env.allowLocalModels = true
env.localModelPath = '/models/'
if (env.backends.onnx?.wasm) {
  env.backends.onnx.wasm.wasmPaths = '/models/ort/'
}

const MODEL_ID = 'face-parsing'

interface PerformanceWithMemory extends Performance {
  memory?: { usedJSHeapSize: number }
}

// O tsconfig usa lib "dom" (o resto do app precisa); aqui o escopo real é o
// de DedicatedWorker, então tipamos só a superfície usada.
const workerScope = self as unknown as {
  postMessage(message: WorkerMessage, transfer?: Transferable[]): void
  onmessage: ((event: MessageEvent<SegmentRequest>) => void) | null
}

function post(message: WorkerMessage, transfer: Transferable[] = []): void {
  workerScope.postMessage(message, transfer)
}

let loaded: { segmenter: ImageSegmentationPipeline; backend: SegmentationBackend; loadMs: number } | null = null

async function loadPipeline() {
  if (loaded !== null) return loaded

  const start = performance.now()
  const onProgress = (info: ProgressInfo): void => {
    if (info.status === 'progress') {
      post({ type: 'progress', stage: 'download', progress: info.progress / 100 })
    }
  }

  const hasWebGpu =
    'gpu' in navigator &&
    (await (navigator as Navigator & { gpu: { requestAdapter(): Promise<unknown | null> } }).gpu
      .requestAdapter()
      .catch(() => null)) !== null

  let segmenter: ImageSegmentationPipeline
  let backend: SegmentationBackend
  if (hasWebGpu) {
    try {
      segmenter = await pipeline('image-segmentation', MODEL_ID, {
        device: 'webgpu',
        dtype: 'q8',
        progress_callback: onProgress,
      })
      backend = 'webgpu'
    } catch {
      segmenter = await pipeline('image-segmentation', MODEL_ID, {
        device: 'wasm',
        dtype: 'q8',
        progress_callback: onProgress,
      })
      backend = 'wasm'
    }
  } else {
    segmenter = await pipeline('image-segmentation', MODEL_ID, {
      device: 'wasm',
      dtype: 'q8',
      progress_callback: onProgress,
    })
    backend = 'wasm'
  }

  loaded = { segmenter, backend, loadMs: performance.now() - start }
  return loaded
}

async function segment(bitmap: ImageBitmap): Promise<void> {
  const { segmenter, backend, loadMs } = await loadPipeline()
  post({ type: 'progress', stage: 'inferindo' })

  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('OffscreenCanvas 2D indisponível no worker.')
  context.drawImage(bitmap, 0, 0)
  const { data, width, height } = context.getImageData(0, 0, bitmap.width, bitmap.height)
  bitmap.close()
  const image = new RawImage(new Uint8ClampedArray(data), width, height, 4)

  // Pico de memória amostrado durante a inferência (Chromium expõe; resto não).
  const perf = performance as PerformanceWithMemory
  let memoryPeak = perf.memory?.usedJSHeapSize ?? null
  const sampler = setInterval(() => {
    const used = perf.memory?.usedJSHeapSize
    if (used !== undefined && (memoryPeak === null || used > memoryPeak)) {
      memoryPeak = used
    }
  }, 50)

  const inferenceStart = performance.now()
  let results
  try {
    results = await segmenter(image)
  } finally {
    clearInterval(sampler)
  }
  const inferenceMs = performance.now() - inferenceStart

  // O pipeline devolve uma máscara binária por classe; compomos o labelmap.
  const first = results[0]?.mask
  if (first === undefined) throw new Error('Segmentação não retornou máscaras.')
  const labels = new Uint8Array(first.width * first.height)
  for (const { label, mask } of results) {
    const classId = FACE_CLASSES[label as FaceClassName]
    if (classId === undefined || classId === FACE_CLASSES.background) continue
    const maskData = mask.data
    for (let i = 0; i < labels.length; i++) {
      if (maskData[i] !== 0) labels[i] = classId
    }
  }

  post(
    {
      type: 'done',
      labels: labels.buffer,
      width: first.width,
      height: first.height,
      meta: {
        backend,
        modelLoadMs: loadMs,
        inferenceMs,
        memoryPeakMB: memoryPeak === null ? null : memoryPeak / (1024 * 1024),
      },
    },
    [labels.buffer],
  )
}

workerScope.onmessage = (event: MessageEvent<SegmentRequest>) => {
  if (event.data.type !== 'segment') return
  void segment(event.data.bitmap).catch((error: unknown) => {
    post({
      type: 'error',
      message: error instanceof Error ? error.message : 'Falha na segmentação.',
    })
  })
}
