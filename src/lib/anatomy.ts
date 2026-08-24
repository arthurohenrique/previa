/**
 * Mapa anatômico: traduz um ponto tocado (UV) em região nomeada.
 *
 * Estratégia em camadas, conforme a spec:
 *  1. A CLASSE DA MÁSCARA decide primeiro (lábios, olhos, sobrancelhas) —
 *     é ela que resolve a ambiguidade nas bordas ("lábio, não malar").
 *  2. Sobre PELE, a geometria decide: polígono do filtro; senão a âncora de
 *     região mais próxima (malar, sulco, mento), com limite proporcional à
 *     distância interocular para não classificar testa como malar.
 *  3. Fundo, cabelo, pescoço e roupa não são regiões de procedimento.
 *
 * Nomenclatura clínica pelo lado do PACIENTE: numa foto frontal não
 * espelhada, o lado direito do paciente aparece à ESQUERDA da imagem.
 */

import { FACE_CLASSES, type LabelMap } from './segmentation/mask'
import type { Point2 } from './quality'

export type RegionId =
  | 'labio-superior'
  | 'labio-inferior'
  | 'filtro'
  | 'malar-direito'
  | 'malar-esquerdo'
  | 'mento'
  | 'sulco-nasogeniano-direito'
  | 'sulco-nasogeniano-esquerdo'
  | 'orbital-direita'
  | 'orbital-esquerda'

export interface RegionInfo {
  id: RegionId
  label: string
  procedure: string
}

export const REGIONS: Record<RegionId, RegionInfo> = {
  'labio-superior': { id: 'labio-superior', label: 'Lábio superior', procedure: 'Preenchimento labial' },
  'labio-inferior': { id: 'labio-inferior', label: 'Lábio inferior', procedure: 'Preenchimento labial' },
  filtro: { id: 'filtro', label: 'Filtro labial', procedure: 'Preenchimento do filtro' },
  'malar-direito': { id: 'malar-direito', label: 'Malar direito', procedure: 'Preenchimento malar' },
  'malar-esquerdo': { id: 'malar-esquerdo', label: 'Malar esquerdo', procedure: 'Preenchimento malar' },
  mento: { id: 'mento', label: 'Mento', procedure: 'Preenchimento de mento' },
  'sulco-nasogeniano-direito': {
    id: 'sulco-nasogeniano-direito',
    label: 'Sulco nasogeniano direito',
    procedure: 'Preenchimento do sulco',
  },
  'sulco-nasogeniano-esquerdo': {
    id: 'sulco-nasogeniano-esquerdo',
    label: 'Sulco nasogeniano esquerdo',
    procedure: 'Preenchimento do sulco',
  },
  'orbital-direita': { id: 'orbital-direita', label: 'Região orbital direita', procedure: 'Tratamento de olheira' },
  'orbital-esquerda': { id: 'orbital-esquerda', label: 'Região orbital esquerda', procedure: 'Tratamento de olheira' },
}

/* ------------------------------------------------------------------ */
/* Índices de landmark (canônicos do MediaPipe FaceMesh)               */
/* ------------------------------------------------------------------ */

/** Centros das íris (o FaceLandmarker entrega 478 pontos, com íris). */
const IRIS_RIGHT_PATIENT = 468 // lado esquerdo da imagem
const IRIS_LEFT_PATIENT = 473 // lado direito da imagem

/** Centro interno da boca — separa lábio superior do inferior na classe "mouth". */
const MOUTH_INNER_CENTER = 13

/** Polígono do filtro labial (subnasal → topo do lábio superior). */
export const PHILTRUM_POLYGON: readonly number[] = [97, 2, 326, 267, 0, 37]

/** Âncoras de regiões difusas: média dos landmarks listados. */
export const REGION_ANCHORS: ReadonlyArray<{ id: RegionId; indices: readonly number[] }> = [
  // Imagem-esquerda = lado direito do paciente.
  { id: 'malar-direito', indices: [50, 116, 117, 118] },
  { id: 'malar-esquerdo', indices: [280, 345, 346, 347] },
  { id: 'sulco-nasogeniano-direito', indices: [129, 203, 206] },
  { id: 'sulco-nasogeniano-esquerdo', indices: [358, 423, 426] },
  { id: 'mento', indices: [152, 175, 199] },
  // Pálpebra inferior: a olheira é a PELE infraorbital, não o olho — sem
  // estas âncoras, o toque logo abaixo do olho cairia em malar.
  { id: 'orbital-direita', indices: [144, 145, 153] },
  { id: 'orbital-esquerda', indices: [373, 374, 380] },
]

/** Limite de captura de uma âncora, em múltiplos da distância interocular. */
const ANCHOR_MAX_DISTANCE = 0.8

/* ------------------------------------------------------------------ */
/* Geometria pura                                                      */
/* ------------------------------------------------------------------ */

/** Ray casting clássico; polígono em qualquer orientação. */
export function pointInPolygon(point: Point2, polygon: readonly Point2[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]
    const b = polygon[j]
    const crosses =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    if (crosses) inside = !inside
  }
  return inside
}

export function distance(a: Point2, b: Point2): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function centroid(landmarks: readonly Point2[], indices: readonly number[]): Point2 {
  let x = 0
  let y = 0
  for (const index of indices) {
    x += landmarks[index].x
    y += landmarks[index].y
  }
  return { x: x / indices.length, y: y / indices.length }
}

/** Escala do rosto: distância entre os centros das íris (em UV). */
export function interocularDistance(landmarks: readonly Point2[]): number {
  return distance(landmarks[IRIS_RIGHT_PATIENT], landmarks[IRIS_LEFT_PATIENT])
}

/* ------------------------------------------------------------------ */
/* Classificação                                                       */
/* ------------------------------------------------------------------ */

/** Classe do labelmap no ponto UV (vizinho mais próximo). */
export function sampleClass(map: LabelMap, uv: Point2): number {
  const x = Math.min(map.width - 1, Math.max(0, Math.round(uv.x * (map.width - 1))))
  const y = Math.min(map.height - 1, Math.max(0, Math.round(uv.y * (map.height - 1))))
  return map.labels[y * map.width + x]
}

function orbitalBySide(uv: Point2, landmarks: readonly Point2[]): RegionId {
  // Nariz (ponta, índice 1) como eixo central da imagem.
  return uv.x < landmarks[1].x ? 'orbital-direita' : 'orbital-esquerda'
}

/**
 * Ponto tocado -> região anatômica (ou null fora de área de procedimento).
 */
export function classifyPoint(
  uv: Point2,
  map: LabelMap,
  landmarks: readonly Point2[],
): RegionId | null {
  const classId = sampleClass(map, uv)

  // 1) A máscara resolve as regiões com classe própria — inclusive a
  //    ambiguidade da borda lábio/pele.
  switch (classId) {
    case FACE_CLASSES.u_lip:
      return 'labio-superior'
    case FACE_CLASSES.l_lip:
      return 'labio-inferior'
    case FACE_CLASSES.mouth:
      return uv.y < landmarks[MOUTH_INNER_CENTER].y ? 'labio-superior' : 'labio-inferior'
    case FACE_CLASSES.l_eye:
    case FACE_CLASSES.r_eye:
    case FACE_CLASSES.l_brow:
    case FACE_CLASSES.r_brow:
    case FACE_CLASSES.eye_g:
      return orbitalBySide(uv, landmarks)
    case FACE_CLASSES.skin:
    case FACE_CLASSES.nose:
      break // geometria decide abaixo
    default:
      return null // fundo, cabelo, pescoço, roupa, orelhas…
  }

  // 2) Filtro labial tem contorno próprio.
  const philtrum = PHILTRUM_POLYGON.map((index) => landmarks[index])
  if (pointInPolygon(uv, philtrum)) return 'filtro'

  // Nariz fora do filtro não é região de procedimento.
  if (classId === FACE_CLASSES.nose) return null

  // 3) Pele: âncora mais próxima, limitada pela escala do rosto.
  const scale = interocularDistance(landmarks)
  let best: { id: RegionId; dist: number } | null = null
  for (const anchor of REGION_ANCHORS) {
    const dist = distance(uv, centroid(landmarks, anchor.indices))
    if (best === null || dist < best.dist) best = { id: anchor.id, dist }
  }
  if (best !== null && best.dist <= scale * ANCHOR_MAX_DISTANCE) return best.id
  return null
}
