/**
 * Templates anatômicos: como cada procedimento move o rosto.
 *
 * Um template lista (a) landmarks que SE MOVEM, com o vetor em unidades do
 * rosto (× distância interocular, eixo Y rumo ao queixo), e (b) landmarks
 * PINADOS (destino = origem). O MLS interpola entre eles; o que não está
 * listado segue a vizinhança. Princípio: o preenchimento avança a borda da
 * região e COMPRIME a pele vizinha até o próximo pino — compressão é muito
 * menos visível que estiramento.
 *
 * Índices canônicos do FaceMesh (os mesmos de landmarkMask.ts e anatomy.ts).
 * Lado do PACIENTE: "direito" aparece à esquerda da imagem (x menor).
 */

import type { RegionId } from '@/lib/anatomy'
import type { Point2 } from '@/lib/quality'
import {
  contourNormals,
  faceVectorToPx,
  landmarkToPx,
  pxVectorToFace,
  type FaceFrame,
} from './frame'
import { MLS_DEFAULT_ALPHA, type ControlPoint } from './mls'

export interface DisplacementSpec {
  index: number
  /** Deslocamento em unidades do rosto. */
  delta: Point2
}

/** Como a região muda a LUZ (Fase C) — a pista de volume. */
export interface PhotometricSpec {
  /** Realce lambertiano máximo (0..1); 0 desliga. */
  shadeGain: number
  /** Largura da rampa da pseudo-altura (× interocular). */
  heightBlur: number
  /** Fração da sombra recuperada pelo shadow lift (0..1); 0 desliga. */
  liftGain: number
  /** Bandas do vermelhão (saturação leve + definição de borda). */
  lips: boolean
}

export interface RegionTemplate {
  moving(landmarks: readonly Point2[], frame: FaceFrame): DisplacementSpec[]
  pins: readonly number[]
  /** Teto de |delta| (× interocular) — anti-caricato, fonte única do limite. */
  maxDeltaFactor: number
  alpha: number
  /**
   * 'rosto': o campo é confinado pela máscara do rosto (regiões interiores).
   * 'livre': a silhueta pode se mover (mento, malar) — só os pinos limitam.
   */
  confine: 'rosto' | 'livre'
  photometric: PhotometricSpec
}

const LIP_PHOTOMETRIC: PhotometricSpec = { shadeGain: 0.45, heightBlur: 0.08, liftGain: 0, lips: true }
const AREA_PHOTOMETRIC: PhotometricSpec = { shadeGain: 0.7, heightBlur: 0.12, liftGain: 0, lips: false }
const CHIN_PHOTOMETRIC: PhotometricSpec = { shadeGain: 0.6, heightBlur: 0.12, liftGain: 0, lips: false }
const FOLD_PHOTOMETRIC: PhotometricSpec = { shadeGain: 0.25, heightBlur: 0.06, liftGain: 0.8, lips: false }
const ORBITAL_PHOTOMETRIC: PhotometricSpec = { shadeGain: 0.15, heightBlur: 0.05, liftGain: 0.8, lips: false }
const PHILTRUM_PHOTOMETRIC: PhotometricSpec = { shadeGain: 0.4, heightBlur: 0.04, liftGain: 0, lips: false }

/* ------------------------------------------------------------------ */
/* Contornos                                                           */
/* ------------------------------------------------------------------ */

/** Contorno externo do lábio superior, da comissura direita à esquerda. */
export const UPPER_LIP_OUTER = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291] as const
/** Contorno externo do lábio inferior, mesma ordem. */
export const LOWER_LIP_OUTER = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291] as const
/** Linha molhada superior (dentes) — nunca se move. */
export const UPPER_LIP_INNER = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308] as const
export const LOWER_LIP_INNER = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308] as const
/** Picos do arco do cupido. */
const CUPID_PEAKS = [37, 267] as const
/** Base do nariz / columela — pino do filtro. */
const NOSE_BASE = [2, 97, 326, 98, 327, 164] as const
const NOSE_ALA_RIGHT = [129, 49, 209] as const
const NOSE_ALA_LEFT = [358, 279, 429] as const
const LOWER_EYELID_RIGHT = [33, 7, 163, 144, 145, 153, 154, 155, 133] as const
const LOWER_EYELID_LEFT = [263, 249, 390, 373, 374, 380, 381, 382, 362] as const
const CHIN_MIDLINE = [152, 175, 199] as const
const JAW_NEAR_CHIN = [172, 397] as const
const JAW_MID = [132, 361] as const
const EARS = [234, 454] as const
const MOUTH_CENTER_INDICES = [13, 14] as const

const IRIS = [468, 473] as const

/** Abertura da boca (gap 13↔14, × interocular) acima da qual o lábio reduz. */
export const MOUTH_OPEN_GAP = 0.05

/**
 * Ganho na intensidade 1 (× interocular). Preenchimento real aumenta a
 * altura do vermelhão ~20–30%; com vermelhão ≈ 0,12 IOD, 0,035 IOD ≈ 30%.
 */
const UPPER_LIP_GAIN = 0.035
const LOWER_LIP_GAIN = 0.04
const CUPID_LIFT = 0.1

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function centerPx(landmarks: readonly Point2[], indices: readonly number[], frame: FaceFrame): Point2 {
  let x = 0
  let y = 0
  for (const index of indices) {
    const point = landmarkToPx(landmarks[index], frame.width, frame.height)
    x += point.x
    y += point.y
  }
  return { x: x / indices.length, y: y / indices.length }
}

export function isMouthOpen(landmarks: readonly Point2[], frame: FaceFrame): boolean {
  const upper = landmarkToPx(landmarks[MOUTH_CENTER_INDICES[0]], frame.width, frame.height)
  const lower = landmarkToPx(landmarks[MOUTH_CENTER_INDICES[1]], frame.width, frame.height)
  return Math.hypot(lower.x - upper.x, lower.y - upper.y) / frame.scale > MOUTH_OPEN_GAP
}

/** Perfil ao longo do contorno: 0 nas comissuras, 1 no centro, suave. */
export function lipProfile(s: number): number {
  return Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, s))), 1.5)
}

/**
 * O contorno externo do vermelhão avança na normal (para fora da boca),
 * com o perfil `lipProfile` pelo comprimento de arco. Boca aberta reduz o
 * ganho pela metade (o modelo labial supõe lábios em contato).
 */
function lipContourMovers(
  landmarks: readonly Point2[],
  frame: FaceFrame,
  contour: readonly number[],
  gain: number,
  cupidLift: number,
): DisplacementSpec[] {
  const points = contour.map((index) => landmarkToPx(landmarks[index], frame.width, frame.height))
  const mouthCenter = centerPx(landmarks, MOUTH_CENTER_INDICES, frame)
  const normals = contourNormals(points, mouthCenter)

  const cumulative = [0]
  for (let i = 1; i < points.length; i++) {
    cumulative.push(
      cumulative[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y),
    )
  }
  const total = cumulative[cumulative.length - 1] || 1
  const openFactor = isMouthOpen(landmarks, frame) ? 0.5 : 1

  return contour.map((index, i) => {
    const magnitude = gain * lipProfile(cumulative[i] / total) * openFactor
    const normal = pxVectorToFace(normals[i], frame)
    const delta = { x: normal.x * magnitude, y: normal.y * magnitude }
    if (cupidLift > 0 && (CUPID_PEAKS as readonly number[]).includes(index)) {
      delta.y -= cupidLift * gain * openFactor
    }
    return { index, delta }
  })
}

function scaled(indices: readonly number[], delta: Point2, factor = 1): DisplacementSpec[] {
  return indices.map((index) => ({ index, delta: { x: delta.x * factor, y: delta.y * factor } }))
}

/* ------------------------------------------------------------------ */
/* Templates                                                           */
/* ------------------------------------------------------------------ */

const LIP_PINS_COMMON = [...NOSE_BASE, ...IRIS, ...CHIN_MIDLINE, ...JAW_NEAR_CHIN]

export const REGION_TEMPLATES: Record<RegionId, RegionTemplate> = {
  'labio-superior': {
    moving: (landmarks, frame) =>
      lipContourMovers(landmarks, frame, UPPER_LIP_OUTER, UPPER_LIP_GAIN, CUPID_LIFT),
    pins: [...UPPER_LIP_INNER, ...LOWER_LIP_INNER, ...LOWER_LIP_OUTER, ...LIP_PINS_COMMON],
    maxDeltaFactor: 0.08,
    alpha: MLS_DEFAULT_ALPHA,
    confine: 'rosto',
    photometric: LIP_PHOTOMETRIC,
  },
  'labio-inferior': {
    moving: (landmarks, frame) =>
      lipContourMovers(landmarks, frame, LOWER_LIP_OUTER, LOWER_LIP_GAIN, 0),
    pins: [...UPPER_LIP_INNER, ...LOWER_LIP_INNER, ...UPPER_LIP_OUTER, ...LIP_PINS_COMMON],
    maxDeltaFactor: 0.08,
    alpha: MLS_DEFAULT_ALPHA,
    confine: 'rosto',
    photometric: LIP_PHOTOMETRIC,
  },
  filtro: {
    // Definição das colunas do filtro: o arco do cupido sobe de leve.
    moving: () => [
      ...scaled([37, 267], { x: 0, y: -0.02 }),
      ...scaled([0, 39, 269], { x: 0, y: -0.012 }),
    ],
    pins: [...NOSE_BASE, ...UPPER_LIP_INNER, ...LOWER_LIP_OUTER, 61, 291, ...IRIS],
    maxDeltaFactor: 0.03,
    alpha: MLS_DEFAULT_ALPHA,
    confine: 'rosto',
    photometric: PHILTRUM_PHOTOMETRIC,
  },
  'malar-direito': {
    // Projeção em 2D: leve alargamento lateral da eminência + lift sutil.
    moving: () => [
      ...scaled([50, 117, 118, 101, 205, 123], { x: -0.03, y: -0.02 }),
      ...scaled([187, 207, 216], { x: 0, y: -0.02 }),
    ],
    pins: [
      ...LOWER_EYELID_RIGHT,
      ...NOSE_ALA_RIGHT,
      ...UPPER_LIP_OUTER,
      ...UPPER_LIP_INNER,
      ...JAW_MID,
      ...JAW_NEAR_CHIN,
      EARS[0],
      ...IRIS,
    ],
    maxDeltaFactor: 0.05,
    alpha: MLS_DEFAULT_ALPHA,
    confine: 'livre',
    photometric: AREA_PHOTOMETRIC,
  },
  'malar-esquerdo': {
    moving: () => [
      ...scaled([280, 346, 347, 330, 425, 352], { x: 0.03, y: -0.02 }),
      ...scaled([411, 427, 436], { x: 0, y: -0.02 }),
    ],
    pins: [
      ...LOWER_EYELID_LEFT,
      ...NOSE_ALA_LEFT,
      ...UPPER_LIP_OUTER,
      ...UPPER_LIP_INNER,
      ...JAW_MID,
      ...JAW_NEAR_CHIN,
      EARS[1],
      ...IRIS,
    ],
    maxDeltaFactor: 0.05,
    alpha: MLS_DEFAULT_ALPHA,
    confine: 'livre',
    photometric: AREA_PHOTOMETRIC,
  },
  mento: {
    // Ponto mentoniano desce/projeta; contorno inferior acompanha com atenuação.
    moving: () => [
      ...scaled([152], { x: 0, y: 0.08 }),
      ...scaled([175, 148, 377], { x: 0, y: 0.08 }, 0.6),
      ...scaled([199, 176, 400], { x: 0, y: 0.08 }, 0.35),
      ...scaled([149, 378], { x: 0, y: 0.08 }, 0.15),
    ],
    pins: [...LOWER_LIP_OUTER, ...LOWER_LIP_INNER, ...JAW_NEAR_CHIN, ...JAW_MID, ...IRIS],
    maxDeltaFactor: 0.1,
    alpha: MLS_DEFAULT_ALPHA,
    confine: 'livre',
    photometric: CHIN_PHOTOMETRIC,
  },
  'sulco-nasogeniano-direito': {
    // Efeito principal é fotométrico; a geometria só suaviza a prega.
    moving: () => scaled([203, 206, 216], { x: -0.008, y: -0.008 }),
    pins: [...NOSE_ALA_RIGHT, ...UPPER_LIP_OUTER, ...UPPER_LIP_INNER, ...IRIS],
    maxDeltaFactor: 0.02,
    alpha: MLS_DEFAULT_ALPHA,
    confine: 'rosto',
    photometric: FOLD_PHOTOMETRIC,
  },
  'sulco-nasogeniano-esquerdo': {
    moving: () => scaled([423, 426, 436], { x: 0.008, y: -0.008 }),
    pins: [...NOSE_ALA_LEFT, ...UPPER_LIP_OUTER, ...UPPER_LIP_INNER, ...IRIS],
    maxDeltaFactor: 0.02,
    alpha: MLS_DEFAULT_ALPHA,
    confine: 'rosto',
    photometric: FOLD_PHOTOMETRIC,
  },
  'orbital-direita': {
    moving: () => scaled([119, 100, 101, 118], { x: 0, y: -0.006 }),
    pins: [...LOWER_EYELID_RIGHT, ...NOSE_ALA_RIGHT, ...IRIS],
    maxDeltaFactor: 0.01,
    alpha: MLS_DEFAULT_ALPHA,
    confine: 'rosto',
    photometric: ORBITAL_PHOTOMETRIC,
  },
  'orbital-esquerda': {
    moving: () => scaled([348, 329, 330, 347], { x: 0, y: -0.006 }),
    pins: [...LOWER_EYELID_LEFT, ...NOSE_ALA_LEFT, ...IRIS],
    maxDeltaFactor: 0.01,
    alpha: MLS_DEFAULT_ALPHA,
    confine: 'rosto',
    photometric: ORBITAL_PHOTOMETRIC,
  },
}

/* ------------------------------------------------------------------ */
/* Pontos de controle                                                  */
/* ------------------------------------------------------------------ */

/** Pontos fixos na moldura da imagem: nada escorre pela borda. */
export function borderPins(width: number, height: number): ControlPoint[] {
  const pins: ControlPoint[] = []
  const fixed = (x: number, y: number) => pins.push({ p: { x, y }, q: { x, y } })
  for (let i = 0; i <= 4; i++) {
    fixed((width * i) / 4, 0)
    fixed((width * i) / 4, height)
  }
  fixed(0, height / 2)
  fixed(width, height / 2)
  return pins
}

/** Limita |delta| ao teto da região. */
export function clampDelta(delta: Point2, maxDeltaFactor: number): Point2 {
  const magnitude = Math.hypot(delta.x, delta.y)
  if (magnitude <= maxDeltaFactor) return delta
  const factor = maxDeltaFactor / magnitude
  return { x: delta.x * factor, y: delta.y * factor }
}

/**
 * Controles do MLS para a região na intensidade 1, em px da foto:
 * movers (com teto), pinos do template (exceto índices que já se movem),
 * e a moldura da imagem.
 */
export function buildControlPoints(
  region: RegionId,
  landmarks: readonly Point2[],
  frame: FaceFrame,
): ControlPoint[] {
  const template = REGION_TEMPLATES[region]
  const controls: ControlPoint[] = []
  const used = new Set<number>()

  for (const spec of template.moving(landmarks, frame)) {
    if (used.has(spec.index)) continue
    used.add(spec.index)
    const p = landmarkToPx(landmarks[spec.index], frame.width, frame.height)
    const vector = faceVectorToPx(clampDelta(spec.delta, template.maxDeltaFactor), frame)
    controls.push({ p, q: { x: p.x + vector.x, y: p.y + vector.y } })
  }

  for (const index of template.pins) {
    if (used.has(index)) continue
    used.add(index)
    const p = landmarkToPx(landmarks[index], frame.width, frame.height)
    controls.push({ p, q: { x: p.x, y: p.y } })
  }

  controls.push(...borderPins(frame.width, frame.height))
  return controls
}
