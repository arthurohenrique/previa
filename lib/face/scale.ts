import type { HeadPose, Landmark, Point2 } from './types'

/**
 * Escala em DIP — distância interpupilar.
 *
 * Pixel não é comparável entre fotos, entre pacientes nem entre consultas: muda
 * com a distância da câmera, com a lente e com o recorte. Fração de DIP é. Toda
 * amplitude e todo raio do Prévia são expressos assim (D-04).
 */

/** Centro da íris esquerda no modelo de 478 pontos. */
export const IRIS_LEFT_CENTER = 468
/** Centro da íris direita no modelo de 478 pontos. */
export const IRIS_RIGHT_CENTER = 473

/** Cantos externos dos olhos — usados só se as íris não vierem no resultado. */
export const EYE_OUTER_LEFT = 263
export const EYE_OUTER_RIGHT = 33
export const EYE_INNER_LEFT = 362
export const EYE_INNER_RIGHT = 133

export class ScaleError extends Error {}

function at(landmarks: readonly Landmark[], index: number): Landmark {
  const point = landmarks[index]
  if (!point) throw new ScaleError(`Landmark ${index} ausente no resultado da detecção.`)
  return point
}

/** Ponto médio entre dois landmarks, em coordenada normalizada. */
function midpoint(a: Point2, b: Point2): Point2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

/**
 * Distância interpupilar em pixels da foto.
 *
 * Prefere os centros de íris (468/473), que são a pupila de fato. Sem eles cai
 * para o ponto médio dos cantos de cada olho, que é uma aproximação pior mas
 * ainda estável — e nunca deixa a sessão sem escala.
 */
export function measureIpdPx(
  landmarks: readonly Landmark[],
  width: number,
  height: number,
): number {
  const hasIris = landmarks.length > IRIS_RIGHT_CENTER

  const left = hasIris
    ? at(landmarks, IRIS_LEFT_CENTER)
    : midpoint(at(landmarks, EYE_OUTER_LEFT), at(landmarks, EYE_INNER_LEFT))
  const right = hasIris
    ? at(landmarks, IRIS_RIGHT_CENTER)
    : midpoint(at(landmarks, EYE_OUTER_RIGHT), at(landmarks, EYE_INNER_RIGHT))

  const dx = (left.x - right.x) * width
  const dy = (left.y - right.y) * height
  const ipd = Math.hypot(dx, dy)

  if (!Number.isFinite(ipd) || ipd <= 0) {
    throw new ScaleError('Não foi possível medir a distância interpupilar.')
  }
  return ipd
}

/** Converte uma fração de DIP em pixels da foto. */
export function ipdToPx(fraction: number, ipdPx: number): number {
  return fraction * ipdPx
}

/** Converte pixels da foto em fração de DIP. */
export function pxToIpd(px: number, ipdPx: number): number {
  return px / ipdPx
}

/**
 * Converte um deslocamento em pixels para fração de DIP nos dois eixos.
 * O resultado é isotrópico de propósito: a DIP é uma distância, não um par.
 */
export function offsetToIpd(
  from: Point2,
  to: Point2,
  width: number,
  height: number,
  ipdPx: number,
): Point2 {
  return {
    x: ((to.x - from.x) * width) / ipdPx,
    y: ((to.y - from.y) * height) / ipdPx,
  }
}

/** Aplica um offset em fração de DIP sobre um ponto normalizado. */
export function applyIpdOffset(
  origin: Point2,
  offsetIpd: Point2,
  width: number,
  height: number,
  ipdPx: number,
): Point2 {
  return {
    x: origin.x + (offsetIpd.x * ipdPx) / width,
    y: origin.y + (offsetIpd.y * ipdPx) / height,
  }
}

/**
 * Extrai guinada, arfagem e rolagem da matriz de transformação facial do
 * MediaPipe (coluna-major 4×4, como o WebGL).
 *
 * A convenção segue a intuição clínica: guinada positiva é o rosto virando para
 * a direita de quem olha a foto, arfagem positiva é o queixo subindo.
 */
export function poseFromMatrix(matrix: readonly number[]): HeadPose {
  if (matrix.length < 16) {
    throw new ScaleError('Matriz de transformação facial ausente ou incompleta.')
  }

  // Coluna-major: m[col * 4 + row].
  const m00 = matrix[0] as number
  const m10 = matrix[1] as number
  const m20 = matrix[2] as number
  const m21 = matrix[6] as number
  const m22 = matrix[10] as number

  const toDeg = 180 / Math.PI
  const pitch = Math.atan2(-m20, Math.hypot(m21, m22)) * toDeg
  const yaw = Math.atan2(m10, m00) * toDeg
  const roll = Math.atan2(m21, m22) * toDeg

  return { yaw, pitch, roll }
}
