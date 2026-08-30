/**
 * Referencial do rosto — todas as medidas anatômicas do motor de warp são
 * expressas em "unidades do rosto": origem no ponto médio das íris, eixo X
 * ao longo da linha das íris (corrige a inclinação da cabeça), eixo Y
 * perpendicular apontando para o queixo, e escala = distância interocular
 * em px. Assim um template vale para qualquer foto, resolução ou rotação.
 */

import type { Point2 } from '@/lib/quality'

/** Centros das íris (o FaceLandmarker entrega 478 pontos, com íris). */
export const IRIS_RIGHT_PATIENT = 468 // lado esquerdo da imagem
export const IRIS_LEFT_PATIENT = 473 // lado direito da imagem

export interface FaceFrame {
  /** Origem em px da foto: ponto médio entre as íris. */
  origin: Point2
  /** Eixo horizontal unitário (íris direita → íris esquerda do paciente). */
  axisX: Point2
  /** Eixo vertical unitário, perpendicular a X, apontando para o queixo. */
  axisY: Point2
  /** Distância interocular em px — a unidade de todas as medidas. */
  scale: number
  width: number
  height: number
}

export function landmarkToPx(landmark: Point2, width: number, height: number): Point2 {
  return { x: landmark.x * width, y: landmark.y * height }
}

export function buildFaceFrame(
  landmarks: readonly Point2[],
  width: number,
  height: number,
): FaceFrame {
  const right = landmarkToPx(landmarks[IRIS_RIGHT_PATIENT], width, height)
  const left = landmarkToPx(landmarks[IRIS_LEFT_PATIENT], width, height)
  const dx = left.x - right.x
  const dy = left.y - right.y
  const scale = Math.hypot(dx, dy)
  if (scale < 1e-6) throw new Error('Íris coincidentes: referencial do rosto indefinido.')
  const axisX = { x: dx / scale, y: dy / scale }
  // Perpendicular no sentido horário em coordenadas de imagem (y cresce para
  // baixo): para axisX = (1, 0) resulta (0, 1), isto é, rumo ao queixo.
  const axisY = { x: -axisX.y, y: axisX.x }
  return {
    origin: { x: (right.x + left.x) / 2, y: (right.y + left.y) / 2 },
    axisX,
    axisY,
    scale,
    width,
    height,
  }
}

/** px da foto → unidades do rosto. */
export function toFace(point: Point2, frame: FaceFrame): Point2 {
  const rx = point.x - frame.origin.x
  const ry = point.y - frame.origin.y
  return {
    x: (rx * frame.axisX.x + ry * frame.axisX.y) / frame.scale,
    y: (rx * frame.axisY.x + ry * frame.axisY.y) / frame.scale,
  }
}

/** unidades do rosto → px da foto. */
export function fromFace(point: Point2, frame: FaceFrame): Point2 {
  const vector = faceVectorToPx(point, frame)
  return { x: frame.origin.x + vector.x, y: frame.origin.y + vector.y }
}

/** Vetor (sem origem) em unidades do rosto → vetor em px. */
export function faceVectorToPx(vector: Point2, frame: FaceFrame): Point2 {
  return {
    x: (vector.x * frame.axisX.x + vector.y * frame.axisY.x) * frame.scale,
    y: (vector.x * frame.axisX.y + vector.y * frame.axisY.y) * frame.scale,
  }
}

/** Vetor unitário em px → vetor unitário em unidades do rosto (só rotação). */
export function pxVectorToFace(vector: Point2, frame: FaceFrame): Point2 {
  return {
    x: vector.x * frame.axisX.x + vector.y * frame.axisX.y,
    y: vector.x * frame.axisY.x + vector.y * frame.axisY.y,
  }
}

/**
 * Normal unitária em cada ponto de uma polilinha, orientada para LONGE de
 * `away` (ex.: contorno do lábio com `away` = centro da boca → normais
 * apontam para fora do vermelhão). Nas pontas usa o segmento adjacente.
 */
export function contourNormals(points: readonly Point2[], away: Point2): Point2[] {
  const count = points.length
  return points.map((point, i) => {
    const previous = points[Math.max(0, i - 1)]
    const next = points[Math.min(count - 1, i + 1)]
    let nx = -(next.y - previous.y)
    let ny = next.x - previous.x
    let length = Math.hypot(nx, ny)
    if (length < 1e-9) {
      nx = point.x - away.x
      ny = point.y - away.y
      length = Math.hypot(nx, ny)
      if (length < 1e-9) return { x: 0, y: -1 }
    }
    nx /= length
    ny /= length
    if (nx * (point.x - away.x) + ny * (point.y - away.y) < 0) {
      nx = -nx
      ny = -ny
    }
    return { x: nx, y: ny }
  })
}
