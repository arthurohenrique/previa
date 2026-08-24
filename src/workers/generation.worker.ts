/**
 * Worker de geração local — LCM Dreamshaper v7 (ONNX) via diffusers.js.
 *
 * Contenção (emenda da restrição nº 3 do CLAUDE.md):
 *  - modelo servido do PRÓPRIO domínio (/models/generative), nada do Hub:
 *    setModelCacheDir('/models') faz o loader buscar por fetch local antes
 *    de qualquer fallback remoto — e todos os arquivos existem localmente;
 *  - o worker só vê o RECORTE da região (512×512), nunca a foto inteira;
 *  - WebGPU obrigatório: sem adapter, o worker responde erro e a UI mantém
 *    apenas o motor determinístico.
 */

import {
  DiffusionPipeline,
  setModelCacheDir,
  type ImagePipeline,
} from '@aislamov/diffusers.js'
import { env as ortEnv } from '@aislamov/onnxruntime-web64'
import {
  GENERATION_SIZE,
  type GenerateRequest,
  type GenerationWorkerMessage,
} from '@/lib/generative/types'

console.log('[gen-worker] boot')

// O EP webgpu do fork onnxruntime-web64 referencia `assert` global (builtin
// de Node) que não existe no browser — shim mínimo antes de qualquer init.
const globalScope = globalThis as unknown as Record<string, unknown>
if (typeof globalScope.assert !== 'function') {
  globalScope.assert = (condition: unknown, message?: string) => {
    if (!condition) throw new Error(message ?? 'Assertion failed')
  }
}

// Rejeições que escapam do fluxo (ex.: internas do ORT) ficam visíveis.
self.addEventListener('unhandledrejection', (event) => {
  const reason = (event as PromiseRejectionEvent).reason as unknown
  console.error(
    '[gen-worker] rejeição não tratada:',
    reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason),
  )
})

// Binários WASM do runtime servidos localmente — o override do pnpm troca o
// fork web64 pelo onnxruntime-web padrão, mesma versão dos arquivos em ort/.
ortEnv.wasm.wasmPaths = '/models/ort/'
setModelCacheDir('/models')
console.log('[gen-worker] env configurado')

const MODEL_PATH = 'generative'

const workerScope = self as unknown as {
  postMessage(message: GenerationWorkerMessage, transfer?: Transferable[]): void
  onmessage: ((event: MessageEvent<GenerateRequest>) => void) | null
}

function post(message: GenerationWorkerMessage, transfer: Transferable[] = []): void {
  workerScope.postMessage(message, transfer)
}

let loaded: { pipeline: ImagePipeline; loadMs: number } | null = null

async function loadPipeline() {
  if (loaded !== null) return loaded

  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown | null> } }).gpu
  const adapter = gpu ? await gpu.requestAdapter().catch(() => null) : null
  console.log('[gen-worker] adapter WebGPU:', adapter !== null)
  if (adapter === null) {
    throw new Error('WebGPU indisponível — a prévia realista exige GPU.')
  }

  // A UI não recebe progresso de fetch local — avisa que a carga começou.
  post({ type: 'progress', stage: 'carregando' })

  const start = performance.now()
  const pipeline = await DiffusionPipeline.fromPretrained(MODEL_PATH, {
    progressCallback: async (payload: import('@aislamov/diffusers.js').ProgressCallbackPayload) => {
      if (payload.status === 'Downloading' && payload.downloadStatus) {
        post({
          type: 'progress',
          stage: 'baixando',
          file: payload.downloadStatus.file,
          progress:
            payload.downloadStatus.size > 0
              ? payload.downloadStatus.downloaded / payload.downloadStatus.size
              : 0,
        })
      } else if (payload.status === 'Ready') {
        post({ type: 'progress', stage: 'carregando' })
      }
    },
  })
  console.log('[gen-worker] pipeline carregado em', Math.round(performance.now() - start), 'ms')
  loaded = { pipeline, loadMs: performance.now() - start }
  return loaded
}

async function generate(request: GenerateRequest): Promise<void> {
  console.log('[gen-worker] pedido recebido')
  const { pipeline, loadMs } = await loadPipeline()
  console.log('[gen-worker] iniciando difusão')

  const inferenceStart = performance.now()
  const images = await pipeline.run({
    prompt: request.prompt,
    negativePrompt: request.negativePrompt,
    width: GENERATION_SIZE,
    height: GENERATION_SIZE,
    numInferenceSteps: request.steps,
    guidanceScale: 1.2,
    seed: request.seed,
    img2imgFlag: true,
    inputImage: request.image,
    strength: request.strength,
    progressCallback: async (payload: import('@aislamov/diffusers.js').ProgressCallbackPayload) => {
      if (payload.unetTimestep !== undefined && payload.unetTotalSteps !== undefined) {
        post({
          type: 'progress',
          stage: 'passo',
          step: payload.unetTimestep,
          total: payload.unetTotalSteps,
        })
      }
    },
  })
  const inferenceMs = performance.now() - inferenceStart

  const first = images[0]
  if (first === undefined) throw new Error('A geração não retornou imagem.')

  const copy = new Float32Array(first.data) // buffer próprio, transferível
  post(
    { type: 'done', image: copy.buffer, loadMs, inferenceMs },
    [copy.buffer],
  )
}

workerScope.onmessage = (event: MessageEvent<GenerateRequest>) => {
  if (event.data.type !== 'generate') return
  void generate(event.data).catch((error: unknown) => {
    post({
      type: 'error',
      message: error instanceof Error ? error.message : 'Falha na geração local.',
    })
  })
}
