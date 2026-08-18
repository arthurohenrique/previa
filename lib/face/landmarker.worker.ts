/// <reference lib="webworker" />

import * as Comlink from 'comlink'
import {
  analyzeBitmap,
  createEngineHolder,
  ensureEngine,
  type AnalyzeResult,
} from './analysis'

/**
 * Detecção fora da main thread.
 *
 * Roda uma vez por foto e devolve os 478 landmarks, o ângulo da cabeça, a DIP e
 * o laudo de qualidade. Nada aqui volta a rodar durante a interação (D-06).
 *
 * O núcleo mora em `analysis.ts`, compartilhado com o fallback de main thread:
 * em WebKit sem `OffscreenCanvas` de worker, este arquivo devolve uma falha de
 * engine e `landmarker.ts` refaz a análise na main thread.
 *
 * O modelo e o runtime WASM vêm da própria origem, nunca de CDN (D-09).
 */

const holder = createEngineHolder()

const api = {
  /** Aquece o modelo antes de a foto existir, para a detecção não pagar o load. */
  async warmup(): Promise<'GPU' | 'CPU'> {
    await ensureEngine(holder)
    return holder.delegate
  },

  async analyze(bitmap: ImageBitmap): Promise<AnalyzeResult> {
    const result = await analyzeBitmap(holder, bitmap)
    if (!result.ok && result.failure.kind === 'engine') {
      // O stack fica no console do navegador: é o único lugar onde dá para ver
      // onde o runtime quebrou dentro do worker.
      console.error('[previa] detecção no worker falhou:', result.failure.message)
    }
    return result
  },

  dispose(): void {
    holder.landmarker?.close()
    holder.landmarker = null
  },
}

export type LandmarkerApi = typeof api
export type { AnalyzeResult }

Comlink.expose(api)
