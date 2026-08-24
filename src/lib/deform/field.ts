/**
 * Campo de deformação por região — modelo anatômico (revisão da Fase 4).
 *
 * Por que não expansão radial: empurrar pixels ao redor de um ponto desloca
 * pele, barba e fundo juntos e o resultado lê-se como distorção. Aqui cada
 * região deforma como o procedimento real:
 *
 *  - LÁBIOS (eversão): o lábio escala a partir da LINHA DA BOCA — a linha e
 *    os dentes ficam parados e o vermelhão avança para fora. O peso vem do
 *    alpha da própria classe na máscara (borda borrada = transição suave).
 *  - MALAR/MENTO/SULCO/OLHEIRA (lift/projeção): translação dominante numa
 *    elipse ancorada nos landmarks — a região sobe/projeta, não "incha".
 *  - CONFINAMENTO: tudo é multiplicado pelo alpha do ROSTO na segmentação —
 *    fundo, cabelo e roupa nunca se movem.
 *
 * Garantias mantidas: teto de deslocamento por região (anti-caricato),
 * atenuação C¹ sem quina, íris e dentes pinados, moldura da imagem fixa.
 */

import { centroid, interocularDistance } from '@/lib/anatomy'
import type { RegionId } from '@/lib/anatomy'
import type { Point2 } from '@/lib/quality'
import { FACE_CLASSES, smoothClassAlpha, type LabelMap } from '@/lib/segmentation/mask'
import { isBorderVertex, type DeformMesh } from './mesh'

/** Intensidades por região (0..1). */
export type DeformMap = Partial<Record<RegionId, number>>

interface LineScaleParams {
  kind: 'line-scale'
  /** Classes da máscara que definem ONDE a região existe. */
  maskClasses: readonly number[]
  /** Landmarks cuja média define a linha-eixo (fica imóvel). */
  axisIndices: readonly number[]
  /** Crescimento vertical na intensidade 1 (fração da distância ao eixo). */
  verticalGain: number
  /** Alargamento horizontal a partir do centro do eixo. */
  horizontalGain: number
  maxDeltaFactor: number
}

interface TranslateParams {
  kind: 'translate'
  centerIndices: readonly number[]
  /** Semieixo horizontal da elipse de influência (× interocular). */
  radiusFactor: number
  /** ry = rx × aspect. */
  aspect: number
  /** Direção do lift (normalizada internamente; y− sobe). */
  direction: Point2
  maxDeltaFactor: number
}

type RegionDeformParams = LineScaleParams | TranslateParams

const MOUTH_AXIS = [13, 14] // linha interna da boca
const CHIN_ANCHOR = [152, 175, 199]

export const REGION_DEFORM: Record<RegionId, RegionDeformParams> = {
  'labio-superior': {
    kind: 'line-scale',
    maskClasses: [FACE_CLASSES.u_lip],
    axisIndices: MOUTH_AXIS,
    verticalGain: 0.9,
    horizontalGain: 0.12,
    maxDeltaFactor: 0.14,
  },
  'labio-inferior': {
    kind: 'line-scale',
    maskClasses: [FACE_CLASSES.l_lip],
    axisIndices: MOUTH_AXIS,
    verticalGain: 1.0,
    horizontalGain: 0.1,
    maxDeltaFactor: 0.14,
  },
  filtro: {
    kind: 'translate',
    centerIndices: [97, 2, 326, 267, 0, 37],
    radiusFactor: 0.18,
    aspect: 0.9,
    direction: { x: 0, y: -1 },
    maxDeltaFactor: 0.04,
  },
  'malar-direito': {
    kind: 'translate',
    centerIndices: [50, 116, 117, 118],
    radiusFactor: 0.5,
    aspect: 0.75,
    direction: { x: -0.25, y: -1 },
    maxDeltaFactor: 0.13,
  },
  'malar-esquerdo': {
    kind: 'translate',
    centerIndices: [280, 345, 346, 347],
    radiusFactor: 0.5,
    aspect: 0.75,
    direction: { x: 0.25, y: -1 },
    maxDeltaFactor: 0.13,
  },
  mento: {
    kind: 'translate',
    centerIndices: CHIN_ANCHOR,
    radiusFactor: 0.45,
    aspect: 0.8,
    direction: { x: 0, y: 1 },
    maxDeltaFactor: 0.16,
  },
  'sulco-nasogeniano-direito': {
    kind: 'translate',
    centerIndices: [129, 203, 206],
    radiusFactor: 0.28,
    aspect: 1.3,
    direction: { x: 0.5, y: -0.35 },
    maxDeltaFactor: 0.06,
  },
  'sulco-nasogeniano-esquerdo': {
    kind: 'translate',
    centerIndices: [358, 423, 426],
    radiusFactor: 0.28,
    aspect: 1.3,
    direction: { x: -0.5, y: -0.35 },
    maxDeltaFactor: 0.06,
  },
  'orbital-direita': {
    kind: 'translate',
    centerIndices: [144, 145, 153],
    radiusFactor: 0.28,
    aspect: 0.7,
    direction: { x: 0, y: -1 },
    maxDeltaFactor: 0.045,
  },
  'orbital-esquerda': {
    kind: 'translate',
    centerIndices: [373, 374, 380],
    radiusFactor: 0.28,
    aspect: 0.7,
    direction: { x: 0, y: -1 },
    maxDeltaFactor: 0.045,
  },
}

/** Pinos que NUNCA deformam: centros das íris e arco interno da boca (dentes). */
const IRIS_PINS = [468, 473]
const TEETH_PINS = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95]
const IRIS_PIN_RADIUS = 0.28 // × interocular
const TEETH_PIN_RADIUS = 0.1

/** Largura da janela que congela a moldura da imagem (fração do menor lado). */
const BORDER_WINDOW = 0.06

/** Classes que compõem "rosto" para o confinamento da deformação. */
const FACE_CONFINEMENT_CLASSES = [
  FACE_CLASSES.skin,
  FACE_CLASSES.nose,
  FACE_CLASSES.u_lip,
  FACE_CLASSES.l_lip,
  FACE_CLASSES.mouth,
  FACE_CLASSES.l_eye,
  FACE_CLASSES.r_eye,
  FACE_CLASSES.l_brow,
  FACE_CLASSES.r_brow,
  FACE_CLASSES.eye_g,
]

/** Atenuação C¹: 1 no centro, 0 (com derivada 0) em t = 1. */
export function falloff(t: number): number {
  if (t >= 1) return 0
  const s = 1 - t * t
  return s * s
}

/** Hermite 0→1 usado nas janelas de pino e borda. */
function smoothstep(t: number): number {
  const s = Math.min(1, Math.max(0, t))
  return s * s * (3 - 2 * s)
}

/** Amostra bilinear de um alpha (0..255) em coordenadas UV → 0..1. */
export function sampleAlpha(
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
  u: number,
  v: number,
): number {
  const x = Math.min(width - 1.001, Math.max(0, u * (width - 1)))
  const y = Math.min(height - 1.001, Math.max(0, v * (height - 1)))
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  const row0 = y0 * width + x0
  const row1 = row0 + width
  const top = alpha[row0] * (1 - fx) + alpha[row0 + 1] * fx
  const bottom = alpha[row1] * (1 - fx) + alpha[row1 + 1] * fx
  return (top * (1 - fy) + bottom * fy) / 255
}

/**
 * Campo pré-computado da região na intensidade 1: Float32Array intercalado
 * [dx0, dy0, …] em px da foto. A máscara de segmentação confina tudo ao rosto.
 */
export function computeRegionField(
  mesh: DeformMesh,
  landmarks: readonly Point2[],
  region: RegionId,
  map: LabelMap,
): Float32Array {
  const params = REGION_DEFORM[region]
  const field = new Float32Array(mesh.vertices.length)

  const scaleUv = interocularDistance(landmarks)
  const scalePx = (scaleUv * (mesh.width + mesh.height)) / 2
  const maxDeltaPx = params.maxDeltaFactor * scalePx

  // Blur proporcional ao rosto na resolução da máscara: borda suave e uma
  // faixa de transição que acompanha o vermelhão para fora.
  const mapScalePx = (scaleUv * (map.width + map.height)) / 2
  const regionBlur = Math.max(2, Math.round(mapScalePx * 0.09))

  const faceAlpha = smoothClassAlpha(map, FACE_CONFINEMENT_CLASSES, Math.max(2, Math.round(mapScalePx * 0.03)))
  const regionAlpha =
    params.kind === 'line-scale' ? smoothClassAlpha(map, params.maskClasses, regionBlur) : null

  const pins: Array<{ x: number; y: number; radius: number }> = []
  for (const index of IRIS_PINS) {
    pins.push({
      x: landmarks[index].x * mesh.width,
      y: landmarks[index].y * mesh.height,
      radius: IRIS_PIN_RADIUS * scalePx,
    })
  }
  // Nos lábios a linha da boca já é o eixo imóvel; os pinos dos dentes lá
  // dentro continuam valendo para as demais regiões.
  for (const index of TEETH_PINS) {
    pins.push({
      x: landmarks[index].x * mesh.width,
      y: landmarks[index].y * mesh.height,
      radius: TEETH_PIN_RADIUS * scalePx,
    })
  }

  const axis =
    params.kind === 'line-scale' ? centroid(landmarks, params.axisIndices) : null
  const center =
    params.kind === 'translate' ? centroid(landmarks, params.centerIndices) : null

  let dirX = 0
  let dirY = 0
  if (params.kind === 'translate') {
    const length = Math.hypot(params.direction.x, params.direction.y)
    dirX = params.direction.x / length
    dirY = params.direction.y / length
  }

  const borderPx = BORDER_WINDOW * Math.min(mesh.width, mesh.height)
  const vertexCount = mesh.vertices.length / 2

  for (let i = 0; i < vertexCount; i++) {
    if (isBorderVertex(mesh, i)) continue

    const x = mesh.vertices[i * 2]
    const y = mesh.vertices[i * 2 + 1]
    const u = x / mesh.width
    const v = y / mesh.height

    // Confinamento: fora do rosto (fundo, cabelo, roupa) nada se move.
    const face = sampleAlpha(faceAlpha, map.width, map.height, u, v)
    if (face < 0.01) continue

    let dx = 0
    let dy = 0

    if (params.kind === 'line-scale' && axis !== null && regionAlpha !== null) {
      const weight = sampleAlpha(regionAlpha, map.width, map.height, u, v)
      if (weight < 0.01) continue
      // Eversão: escala a partir da linha da boca — a linha fica parada,
      // o vermelhão avança; o alpha borrado leva junto a borda da pele.
      const axisY = axis.y * mesh.height
      const axisX = axis.x * mesh.width
      dy = params.verticalGain * (y - axisY) * weight
      dx = params.horizontalGain * (x - axisX) * weight
    } else if (params.kind === 'translate' && center !== null) {
      const cx = center.x * mesh.width
      const cy = center.y * mesh.height
      const rx = params.radiusFactor * scalePx
      const ry = rx * params.aspect
      const t = Math.hypot((x - cx) / rx, (y - cy) / ry)
      const weight = falloff(t)
      if (weight === 0) continue
      const magnitude = maxDeltaPx * weight
      dx = dirX * magnitude
      dy = dirY * magnitude
    }

    if (dx === 0 && dy === 0) continue

    // Pinos: íris e dentes zeram a deformação na vizinhança.
    let pinFactor = 1
    for (const pin of pins) {
      const pinDist = Math.hypot(x - pin.x, y - pin.y)
      pinFactor *= smoothstep(pinDist / pin.radius)
      if (pinFactor === 0) break
    }
    if (pinFactor === 0) continue

    // Borda da imagem: nada escorre para fora.
    const edgeDist = Math.min(x, y, mesh.width - x, mesh.height - y)
    const edgeFactor = smoothstep(edgeDist / borderPx)

    dx *= pinFactor * edgeFactor * face
    dy *= pinFactor * edgeFactor * face

    // Teto anti-caricato da região.
    const magnitude = Math.hypot(dx, dy)
    if (magnitude > maxDeltaPx) {
      const clamp = maxDeltaPx / magnitude
      dx *= clamp
      dy *= clamp
    }

    field[i * 2] = dx
    field[i * 2 + 1] = dy
  }

  return field
}

/**
 * Composição final: base + Σ campoᵣ × intensidadeᵣ. Escreve em `out`
 * (reutilizado entre frames para não alocar durante o arrasto).
 */
export function composeVertices(
  base: Float32Array,
  fields: ReadonlyMap<RegionId, Float32Array>,
  intensities: DeformMap,
  out: Float32Array,
): void {
  out.set(base)
  for (const [region, field] of fields) {
    const intensity = intensities[region]
    if (intensity === undefined || intensity <= 0) continue
    for (let i = 0; i < field.length; i++) {
      if (field[i] !== 0) out[i] += field[i] * intensity
    }
  }
}
