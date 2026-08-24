import type { LabelMap } from './mask'

/** Estratégias de segmentação alternáveis por configuração (portão da Fase 2.5). */
export type SegmentationStrategy = 'auto' | 'ia' | 'landmarks'

export type SegmentationBackend = 'webgpu' | 'wasm' | 'landmarks'

export interface SegmentationMeta {
  backend: SegmentationBackend
  /** Carga do modelo (0 quando já em memória ou estratégia por landmarks). */
  modelLoadMs: number
  inferenceMs: number
  /** Pico de heap JS durante a inferência, em MB (só Chromium expõe). */
  memoryPeakMB: number | null
}

export interface SegmentationOutput {
  map: LabelMap
  meta: SegmentationMeta
}

export type SegmentationProgress =
  | { stage: 'download'; progress: number }
  | { stage: 'inferindo' }

/** Mensagens main -> worker. */
export interface SegmentRequest {
  type: 'segment'
  bitmap: ImageBitmap
}

/** Mensagens worker -> main. */
export type WorkerMessage =
  | { type: 'progress'; stage: 'download'; progress: number }
  | { type: 'progress'; stage: 'inferindo' }
  | {
      type: 'done'
      labels: ArrayBuffer
      width: number
      height: number
      meta: SegmentationMeta
    }
  | { type: 'error'; message: string }
