'use client'

import { useEffect, useRef, useState } from 'react'
import { Application, MeshSimple, Texture } from 'pixi.js'
import type { RegionId } from '@/lib/anatomy'
import { composeVertices, computeRegionField, type DeformMap } from '@/lib/deform/field'
import { buildGridMesh, MESH_COLUMNS, type DeformMesh } from '@/lib/deform/mesh'
import type { ExecutionProfile } from '@/lib/profile'
import type { Point2 } from '@/lib/quality'
import type { LabelMap } from '@/lib/segmentation/mask'

interface DeformCanvasProps {
  photo: Blob
  photoWidth: number
  photoHeight: number
  landmarks: readonly Point2[]
  /** Máscara de segmentação: confina a deformação ao rosto. */
  segmentationMap: LabelMap
  deformations: DeformMap
  profile: ExecutionProfile
  /** Retângulo CSS (letterbox) onde a foto está desenhada. */
  rect: { left: number; top: number; width: number; height: number }
  /** FPS do ticker do Pixi, reportado ~2×/s para o painel de debug. */
  onFps?: (fps: number) => void
}

interface PixiState {
  app: Application
  simpleMesh: MeshSimple
  mesh: DeformMesh
  fields: Map<RegionId, Float32Array>
}

/**
 * Renderiza a foto como malha triangular deformável (Pixi.js v8).
 * Os campos por região são pré-computados; cada mudança de intensidade só
 * recompõe o buffer de vértices (O(V)) — a GPU faz o resto.
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
  onFps,
}: DeformCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [pixi, setPixi] = useState<PixiState | null>(null)

  // Monta a aplicação Pixi uma vez por foto/perfil.
  useEffect(() => {
    const container = containerRef.current
    if (container === null) return
    let cancelled = false
    let app: Application | null = null
    let bitmap: ImageBitmap | null = null

    void (async () => {
      const instance = new Application()
      await instance.init({
        width: photoWidth,
        height: photoHeight,
        backgroundAlpha: 0,
        antialias: true,
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
      const texture = Texture.from(source)

      const mesh = buildGridMesh(photoWidth, photoHeight, MESH_COLUMNS[profile])
      const simpleMesh = new MeshSimple({
        texture,
        vertices: mesh.vertices.slice(),
        uvs: mesh.uvs.slice(),
        indices: mesh.indices.slice(),
      })
      simpleMesh.autoUpdate = true
      instance.stage.addChild(simpleMesh)

      instance.canvas.style.position = 'absolute'
      instance.canvas.style.pointerEvents = 'none'
      container.appendChild(instance.canvas)

      setPixi({ app: instance, simpleMesh, mesh, fields: new Map() })
    })()

    return () => {
      cancelled = true
      setPixi(null)
      bitmap?.close()
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

  // Recompõe os vértices quando as intensidades mudam.
  useEffect(() => {
    if (pixi === null) return
    for (const region of Object.keys(deformations) as RegionId[]) {
      if (!pixi.fields.has(region)) {
        pixi.fields.set(
          region,
          computeRegionField(pixi.mesh, landmarks, region, segmentationMap),
        )
      }
    }
    composeVertices(
      pixi.mesh.vertices,
      pixi.fields,
      deformations,
      pixi.simpleMesh.vertices as Float32Array,
    )
  }, [pixi, deformations, landmarks, segmentationMap])

  // Medidor de FPS para o painel de debug.
  useEffect(() => {
    if (pixi === null || onFps === undefined) return
    const interval = setInterval(() => onFps(pixi.app.ticker.FPS), 500)
    return () => clearInterval(interval)
  }, [pixi, onFps])

  return <div ref={containerRef} className="pointer-events-none absolute inset-0" />
}
