'use client'

import * as Comlink from 'comlink'
import type { AnalyzeResult, LandmarkerApi } from './landmarker.worker'

/**
 * Fachada da detecção na main thread.
 *
 * O worker é único e vive enquanto a aba viver: recriar custa o carregamento do
 * WASM e do modelo, e a clínica sente isso entre um paciente e o próximo.
 */

let worker: Worker | null = null
let api: Comlink.Remote<LandmarkerApi> | null = null

function ensureWorker(): Comlink.Remote<LandmarkerApi> {
  if (api) return api

  worker = new Worker(new URL('./landmarker.worker.ts', import.meta.url), {
    type: 'module',
    name: 'previa-landmarker',
  })
  api = Comlink.wrap<LandmarkerApi>(worker)
  return api
}

/** Carrega o modelo antes de a foto existir. Ignora falha: o analyze retenta. */
export async function warmupLandmarker(): Promise<void> {
  try {
    await ensureWorker().warmup()
  } catch {
    // Aquecimento é otimização, não requisito.
  }
}

/**
 * Detecta o rosto e avalia a qualidade da foto. O `ImageBitmap` é transferido,
 * não copiado — e é fechado do outro lado.
 */
export async function analyzePhoto(bitmap: ImageBitmap): Promise<AnalyzeResult> {
  return ensureWorker().analyze(Comlink.transfer(bitmap, [bitmap]))
}

export function disposeLandmarker(): void {
  void api?.dispose()
  worker?.terminate()
  worker = null
  api = null
}

export type { AnalyzeResult }
