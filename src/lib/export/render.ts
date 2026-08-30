/**
 * Exportação em alta: a foto ORIGINAL sanitizada (≤ 4096px) passa pelo
 * mesmo WarpFilter e pelo MESMO campo composto da tela — o campo é
 * normalizado pela foto, então serve a qualquer resolução. Tudo offscreen,
 * em memória; nada sai do dispositivo.
 */

import { Application, Sprite, Texture } from 'pixi.js'
import { WarpFilter } from '@/lib/warp/WarpFilter'
import { drawWatermark, footerText } from './watermark'

/** Maior lado renderizado — teto seguro de textura em GPUs móveis. */
export const EXPORT_MAX_SIDE = 4096

export interface FieldSnapshot {
  disp: Float32Array
  photo: Float32Array
  fieldWidth: number
  fieldHeight: number
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: 'image/png' | 'image/jpeg',
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('toBlob falhou.'))),
      type,
      quality,
    )
  })
}

/** Decodifica o blob num canvas 2D, limitado a EXPORT_MAX_SIDE. */
export async function decodeToCanvas(photo: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(photo)
  try {
    const scale = Math.min(1, EXPORT_MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('Canvas 2D indisponível.')
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return canvas
  } finally {
    bitmap.close()
  }
}

/**
 * Renderer offscreen único para exportações: criar/destruir um contexto a
 * cada exportação é lento e, ao destruir, o Pixi avisa de texturas do pool
 * ainda ligadas ao sistema de filtros. Reutilizado e redimensionado.
 */
let exportApp: Promise<Application> | null = null

function getExportApp(): Promise<Application> {
  if (exportApp === null) {
    exportApp = (async () => {
      const app = new Application()
      await app.init({
        width: 2,
        height: 2,
        backgroundAlpha: 0,
        antialias: false,
        resolution: 1,
        autoDensity: false,
        autoStart: false,
      })
      return app
    })()
    exportApp.catch(() => {
      exportApp = null
    })
  }
  return exportApp
}

/** Renderiza a simulação sobre a foto original, offscreen, na resolução dela. */
export async function renderSimulation(
  original: Blob,
  snapshot: FieldSnapshot,
): Promise<HTMLCanvasElement> {
  const source = await decodeToCanvas(original)
  const app = await getExportApp()
  app.renderer.resize(source.width, source.height)
  const sprite = new Sprite(Texture.from(source))
  const filter = new WarpFilter(snapshot.fieldWidth, snapshot.fieldHeight, source.width, source.height)
  try {
    filter.setField(snapshot.disp, snapshot.photo)
    sprite.filters = [filter]
    app.stage.addChild(sprite)
    app.render()
    const extracted = app.renderer.extract.canvas(app.stage) as HTMLCanvasElement
    // Cópia para um canvas próprio: o extraído pode ser reciclado pelo renderer.
    const output = document.createElement('canvas')
    output.width = source.width
    output.height = source.height
    output.getContext('2d')?.drawImage(extracted, 0, 0)
    return output
  } finally {
    // Filtro solto e destruído ANTES da textura da foto: a ordem evita
    // recurso destruído ainda ligado a um shader.
    sprite.filters = []
    app.stage.removeChild(sprite)
    filter.destroy()
    sprite.destroy({ texture: true, textureSource: true })
  }
}

/** Canvas com a marca d'água e o rodapé desenhados. */
export function withWatermark(canvas: HTMLCanvasElement, date = new Date()): HTMLCanvasElement {
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('Canvas 2D indisponível.')
  drawWatermark(context, canvas.width, canvas.height, footerText(date))
  return canvas
}

/** PNG em alta da simulação, já com a marca d'água obrigatória. */
export async function exportSimulationPng(
  original: Blob,
  snapshot: FieldSnapshot,
): Promise<Blob> {
  const after = withWatermark(await renderSimulation(original, snapshot))
  return canvasToBlob(after, 'image/png')
}

/** Dispara o download de um blob no navegador (o arquivo não sai do aparelho). */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

/** Nome de arquivo com data/hora, sem dados do paciente. */
export function exportFilename(extension: 'png' | 'pdf', date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`
  return `previa-simulacao-${stamp}.${extension}`
}
