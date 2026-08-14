import type { RegionInstance } from './atlas'
import type { Point2 } from './types'

/**
 * Toque → região.
 *
 * Dois caminhos, ambos obrigatórios: os chips do atlas (DOM, alvo de 44pt) e o
 * toque livre com snap. Este arquivo cobre o segundo.
 */

/** Point-in-polygon por lançamento de raio. Funciona para qualquer polígono simples. */
export function pointInPolygon(point: Point2, polygon: readonly Point2[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i] as Point2
    const b = polygon[j] as Point2
    const intersects =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    if (intersects) inside = !inside
  }
  return inside
}

export function distanceSquared(a: Point2, b: Point2): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

export interface HitResult {
  instance: RegionInstance
  /** `true` quando o toque caiu dentro do polígono; `false` quando houve snap. */
  exact: boolean
}

/** Distância do ponto até a aresta mais próxima do polígono. Zero se dentro. */
export function distanceToPolygon(point: Point2, polygon: readonly Point2[]): number {
  if (polygon.length === 0) return Number.POSITIVE_INFINITY
  if (pointInPolygon(point, polygon)) return 0

  let best = Number.POSITIVE_INFINITY
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j] as Point2
    const b = polygon[i] as Point2
    const dx = b.x - a.x
    const dy = b.y - a.y
    const lengthSquared = dx * dx + dy * dy
    const t =
      lengthSquared > 0
        ? Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared))
        : 0
    const distance = Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy))
    if (distance < best) best = distance
  }
  return best
}

/**
 * Resolve um toque para uma região.
 *
 * Primeiro tenta o polígono. Se nenhum acertar, cai na região de centróide mais
 * próximo.
 *
 * O corte é pela distância até a **borda** da região, não até o centróide. Com
 * centróide, uma região grande como a linha mandibular nunca aceitaria um toque
 * rente à borda — a distância até o centro dela já passa de qualquer limite
 * razoável — enquanto uma região pequena aceitaria toques longe demais.
 */
export function hitTest(
  point: Point2,
  instances: readonly RegionInstance[],
  maxSnapDistance = 0.06,
): HitResult | null {
  let best: RegionInstance | null = null
  let bestArea = Number.POSITIVE_INFINITY

  for (const instance of instances) {
    if (!pointInPolygon(point, instance.polygon)) continue
    // Regiões se sobrepõem (glabela dentro da frontal, por exemplo). Vence a
    // menor: é a mais específica, e é a que o profissional quis tocar.
    const area = polygonArea(instance.polygon)
    if (area < bestArea) {
      bestArea = area
      best = instance
    }
  }

  if (best) return { instance: best, exact: true }

  let nearest: RegionInstance | null = null
  let nearestDistance = Number.POSITIVE_INFINITY
  for (const instance of instances) {
    const distance = distanceSquared(point, instance.centroid)
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearest = instance
    }
  }

  if (!nearest) return null
  if (distanceToPolygon(point, nearest.polygon) > maxSnapDistance) return null
  return { instance: nearest, exact: false }
}

export function polygonArea(polygon: readonly Point2[]): number {
  let area = 0
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i] as Point2
    const b = polygon[j] as Point2
    area += (b.x + a.x) * (b.y - a.y)
  }
  return Math.abs(area / 2)
}

/**
 * Converte a coordenada de um Pointer Event para o espaço normalizado da foto,
 * descontando a letterbox do `object-fit: contain`.
 *
 * É aqui que a maioria dos simuladores erra: usar direto o retângulo do elemento
 * ignora as barras que o `contain` deixa nas laterais ou em cima, e desloca o
 * ponto em dezenas de pixels. O erro cresce quanto mais a proporção da foto
 * difere da do container — exatamente o caso do iPad em paisagem.
 */
export function clientPointToImage(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  imageWidth: number,
  imageHeight: number,
): Point2 | null {
  if (rect.width <= 0 || rect.height <= 0 || imageWidth <= 0 || imageHeight <= 0) return null

  const scale = Math.min(rect.width / imageWidth, rect.height / imageHeight)
  const drawnWidth = imageWidth * scale
  const drawnHeight = imageHeight * scale
  const offsetX = (rect.width - drawnWidth) / 2
  const offsetY = (rect.height - drawnHeight) / 2

  const x = (clientX - rect.left - offsetX) / drawnWidth
  const y = (clientY - rect.top - offsetY) / drawnHeight

  if (x < 0 || x > 1 || y < 0 || y > 1) return null
  return { x, y }
}

/** Caminho inverso: ponto normalizado da foto → pixel dentro do container. */
export function imagePointToClient(
  point: Point2,
  rect: DOMRect,
  imageWidth: number,
  imageHeight: number,
): { x: number; y: number } {
  const scale = Math.min(rect.width / imageWidth, rect.height / imageHeight)
  const drawnWidth = imageWidth * scale
  const drawnHeight = imageHeight * scale
  const offsetX = (rect.width - drawnWidth) / 2
  const offsetY = (rect.height - drawnHeight) / 2

  return {
    x: offsetX + point.x * drawnWidth,
    y: offsetY + point.y * drawnHeight,
  }
}
