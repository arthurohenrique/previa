'use client'

import * as Comlink from 'comlink'
import { analyzeBitmap, createEngineHolder, type AnalyzeResult } from './analysis'
import type { LandmarkerApi } from './landmarker.worker'

/**
 * Fachada da detecção na main thread.
 *
 * O caminho normal é o worker: o load do WASM e a inferência não travam a
 * interface. Mas há WebKits — o do Playwright hoje, Safaris mais velhos ontem —
 * em que o worker não tem `OffscreenCanvas` nem `document`, e o runtime do
 * MediaPipe não tem onde desenhar. Nesses, a análise refaz na main thread, que
 * sempre tem canvas. Custa alguns quadros de interface durante a detecção — e
 * detecção acontece uma vez por foto, não durante a interação (D-06).
 *
 * O worker é único e vive enquanto a aba viver: recriar custa o carregamento do
 * WASM e do modelo, e a clínica sente isso entre um paciente e o próximo.
 */

let worker: Worker | null = null
let api: Comlink.Remote<LandmarkerApi> | null = null

/** Engine da main thread, criado só se o worker falhar. */
const mainHolder = createEngineHolder()

/** Depois que o worker falha uma vez, as próximas fotos nem tentam por lá. */
let workerBroken = false

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
    if (!workerBroken) await ensureWorker().warmup()
  } catch {
    // Aquecimento é otimização, não requisito.
  }
}

/**
 * Detecta o rosto e avalia a qualidade da foto.
 *
 * Recebe o blob, não um bitmap: cada tentativa — worker e, se preciso, main
 * thread — consome o próprio bitmap, e um bitmap transferido para o worker não
 * volta.
 */
export async function analyzePhoto(blob: Blob): Promise<AnalyzeResult> {
  if (!workerBroken) {
    try {
      const bitmap = await createImageBitmap(blob)
      const result = await ensureWorker().analyze(Comlink.transfer(bitmap, [bitmap]))
      if (result.ok || result.failure.kind !== 'engine') return result
      workerBroken = true
    } catch {
      // O worker nem respondeu. O fallback abaixo decide se a foto é analisável.
      workerBroken = true
    }
  }

  return analyzeBitmap(mainHolder, await createImageBitmap(blob))
}

export function disposeLandmarker(): void {
  void api?.dispose()
  worker?.terminate()
  worker = null
  api = null
  mainHolder.landmarker?.close()
  mainHolder.landmarker = null
  workerBroken = false
}

export type { AnalyzeResult }
