'use client'

import { useEffect, useRef, useState } from 'react'
import { Application, Sprite, Texture } from 'pixi.js'
import type { RegionId } from '@/lib/anatomy'
import { estimateLight } from '@/lib/photometric/light'
import { lumaFromRgba, type LumaImage } from '@/lib/photometric/luma'
import type { ExecutionProfile } from '@/lib/profile'
import type { Point2 } from '@/lib/quality'
import type { LabelMap } from '@/lib/segmentation/mask'
import { composeFields, type DeformMap } from '@/lib/warp/compose'
import {
  buildRegionField,
  FIELD_MAX_SIDE,
  fieldDimensions,
  PHOTO_CHANNELS,
  type PhotometricInput,
  type RegionField,
} from '@/lib/warp/field'
import { WarpFilter } from '@/lib/warp/WarpFilter'
import type { FieldSnapshot } from '@/lib/export/render'

export interface CompareState {
  /** false = mostra o original (botão "Antes" pressionado). */
  showAfter: boolean
  /** uv 0..1 do divisor (esquerda = antes); null = sem divisor. */
  splitX: number | null
}

interface DeformCanvasProps {
  photo: Blob
  photoWidth: number
  photoHeight: number
  landmarks: readonly Point2[]
  /** Máscara de segmentação: confina as regiões interiores ao rosto. */
  segmentationMap: LabelMap
  deformations: DeformMap
  profile: ExecutionProfile
  /** Retângulo CSS (letterbox) onde a foto está desenhada. */
  rect: { left: number; top: number; width: number; height: number }
  /** FPS do ticker do Pixi, reportado ~2×/s para o painel de debug. */
  onFps?: (fps: number) => void
  /** Antes/depois: aplicado no shader, sem recompor o campo. */
  compare: CompareState
  /** Recebe uma função que extrai o frame atual (foto deformada) como canvas. */
  extractRef?: React.MutableRefObject<(() => HTMLCanvasElement | null) | null>
  /** Recebe uma função que copia o campo composto atual (para exportar em alta). */
  snapshotRef?: React.MutableRefObject<(() => FieldSnapshot | null) | null>
}

interface PixiState {
  app: Application
  filter: WarpFilter
  /** Luminância da foto na grade do campo (uma vez por foto). */
  luma: LumaImage
  /** Direção de luz estimada — calculada no primeiro campo (precisa da máscara). */
  photometric: PhotometricInput | null
  /** Campos por região na intensidade 1 (calculados uma vez, sob demanda). */
  fields: Map<RegionId, RegionField>
  /** Buffers reutilizados da soma ponderada. */
  composedDisp: Float32Array
  composedPhoto: Float32Array
}

/**
 * Renderiza a foto como Sprite com o WarpFilter (Pixi.js v8): cada mudança
 * de intensidade só recompõe o campo (O(células)) e reenvia duas texturas
 * pequenas — a GPU faz o warp e a fotometria por pixel.
 */
export default function DeformCanvas({
  photo,
  photoWidth,
  photoHeight,
  landmarks,
  segmentationMap,
  deformations,
  profile,
  rect,
  compare,
  onFps,
  extractRef,
  snapshotRef,
}: DeformCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [pixi, setPixi] = useState<PixiState | null>(null)

  // Monta a aplicação Pixi uma vez por foto/perfil.
  useEffect(() => {
    const container = containerRef.current
    if (container === null) return
    let cancelled = false
    let app: Application | null = null
    let warp: WarpFilter | null = null
    let bitmap: ImageBitmap | null = null

    void (async () => {
      const instance = new Application()
      await instance.init({
        width: photoWidth,
        height: photoHeight,
        backgroundAlpha: 0,
        antialias: false,
        resolution: 1,
        autoDensity: false,
      })
      bitmap = await createImageBitmap(photo)
      if (cancelled) {
        instance.destroy(true)
        bitmap.close()
        return
      }
      app = instance

      // Canvas intermediário: fonte de textura estável em todos os navegadores.
      const source = document.createElement('canvas')
      source.width = photoWidth
      source.height = photoHeight
      source.getContext('2d')?.drawImage(bitmap, 0, 0)
      const sprite = new Sprite(Texture.from(source))

      const { width, height } = fieldDimensions(photoWidth, photoHeight, FIELD_MAX_SIDE[profile])
      const filter = new WarpFilter(width, height, photoWidth, photoHeight)
      warp = filter
      sprite.filters = [filter]
      instance.stage.addChild(sprite)

      // Luminância na grade do campo, para a fotometria.
      const small = document.createElement('canvas')
      small.width = width
      small.height = height
      const smallContext = small.getContext('2d', { willReadFrequently: true })
      if (smallContext === null) throw new Error('Canvas 2D indisponível.')
      smallContext.drawImage(source, 0, 0, width, height)
      const luma = lumaFromRgba(smallContext.getImageData(0, 0, width, height).data, width, height)

      instance.canvas.style.position = 'absolute'
      instance.canvas.style.pointerEvents = 'none'
      container.appendChild(instance.canvas)

      setPixi({
        app: instance,
        filter,
        luma,
        photometric: null,
        fields: new Map(),
        composedDisp: new Float32Array(width * height * 2),
        composedPhoto: new Float32Array(width * height * PHOTO_CHANNELS),
      })
    })()

    return () => {
      cancelled = true
      setPixi(null)
      bitmap?.close()
      // Filtro primeiro: solta as texturas do campo antes de o renderer destruí-las.
      warp?.destroy()
      app?.destroy(true, { children: true, texture: true })
    }
  }, [photo, photoWidth, photoHeight, profile])

  // Posiciona o canvas exatamente sobre o retângulo da foto.
  useEffect(() => {
    if (pixi === null) return
    const style = pixi.app.canvas.style
    style.left = `${rect.left}px`
    style.top = `${rect.top}px`
    style.width = `${rect.width}px`
    style.height = `${rect.height}px`
  }, [pixi, rect])

  // Recompõe o campo quando as intensidades mudam.
  useEffect(() => {
    if (pixi === null) return
    for (const region of Object.keys(deformations) as RegionId[]) {
      if (pixi.fields.has(region)) continue
      if (pixi.photometric === null) {
        const start = performance.now()
        pixi.photometric = { luma: pixi.luma, light: estimateLight(pixi.luma, segmentationMap, landmarks) }
        performance.measure('warp:light', { start, end: performance.now() })
      }
      const start = performance.now()
      pixi.fields.set(
        region,
        buildRegionField(
          region,
          landmarks,
          segmentationMap,
          photoWidth,
          photoHeight,
          FIELD_MAX_SIDE[profile],
          pixi.photometric,
        ),
      )
      performance.measure(`warp:field:${region}`, { start, end: performance.now() })
    }

    const composeStart = performance.now()
    composeFields(pixi.fields, deformations, pixi.composedDisp, pixi.composedPhoto)
    const uploadStart = performance.now()
    pixi.filter.setField(pixi.composedDisp, pixi.composedPhoto)
    performance.measure('warp:compose', { start: composeStart, end: uploadStart })
    performance.measure('warp:upload', { start: uploadStart, end: performance.now() })
  }, [pixi, deformations, landmarks, segmentationMap, photoWidth, photoHeight, profile])

  // Antes/depois: só um uniform muda.
  useEffect(() => {
    if (pixi === null) return
    pixi.filter.setCompare(compare)
  }, [pixi, compare])

  // Cópia do campo composto para a exportação em alta.
  useEffect(() => {
    if (snapshotRef === undefined) return
    if (pixi === null) {
      snapshotRef.current = null
      return
    }
    snapshotRef.current = () => ({
      disp: pixi.composedDisp.slice(),
      photo: pixi.composedPhoto.slice(),
      fieldWidth: pixi.filter.fieldWidth,
      fieldHeight: pixi.filter.fieldHeight,
    })
    return () => {
      snapshotRef.current = null
    }
  }, [pixi, snapshotRef])

  // Medidor de FPS para o painel de debug.
  useEffect(() => {
    if (pixi === null || onFps === undefined) return
    const interval = setInterval(() => onFps(pixi.app.ticker.FPS), 500)
    return () => clearInterval(interval)
  }, [pixi, onFps])

  // Extração do frame deformado (exportação / prévia realista).
  useEffect(() => {
    if (extractRef === undefined) return
    if (pixi === null) {
      extractRef.current = null
      return
    }
    extractRef.current = () =>
      pixi.app.renderer.extract.canvas(pixi.app.stage) as HTMLCanvasElement
    return () => {
      extractRef.current = null
    }
  }, [pixi, extractRef])

  return <div ref={containerRef} className="pointer-events-none absolute inset-0" />
}
