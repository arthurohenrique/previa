/** Protocolo do worker de geração local (LCM img2img). */

export interface GenerateRequest {
  type: 'generate'
  /** Recorte CHW float32 em [-1,1], GENERATION_SIZE × GENERATION_SIZE. */
  image: Float32Array
  prompt: string
  negativePrompt: string
  /** 0..1 — quanto a difusão pode se afastar do guia geométrico. */
  strength: number
  steps: number
  seed: string
}

export type GenerationWorkerMessage =
  | { type: 'progress'; stage: 'baixando'; file: string; progress: number }
  | { type: 'progress'; stage: 'carregando' }
  | { type: 'progress'; stage: 'passo'; step: number; total: number }
  | { type: 'done'; image: ArrayBuffer; loadMs: number; inferenceMs: number }
  | { type: 'error'; message: string }

/** Resolução de trabalho da difusão (latente 64×64). */
export const GENERATION_SIZE = 512
