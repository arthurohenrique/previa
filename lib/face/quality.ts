import type { HeadPose, Landmark } from './types'

/**
 * Validação de qualidade da foto — bloqueante (E-04).
 *
 * Sem esta etapa o "depois" mente por ângulo em vez de mostrar o procedimento:
 * um rosto 20° virado já parece ter mais projeção malar do que tinha, e a
 * simulação leva o crédito. O mesmo vale para foto desfocada, que esconde o
 * relevo, e para foto escura, que achata o volume percebido.
 *
 * Cada falha diz o que corrigir. Nenhuma diz "erro ao processar".
 */

/** Tolerância de frontalidade, em graus, para cada eixo. */
export const MAX_ANGLE_DEG = 10

/** Variância de Laplaciano abaixo disto é foto desfocada. */
export const MIN_LAPLACIAN_VARIANCE = 55

/** Luminância média aceitável na região do rosto, em 0..255. */
export const MIN_FACE_LUMA = 55
export const MAX_FACE_LUMA = 225

/** Fração máxima de pixels estourados no rosto. */
export const MAX_CLIPPED_FRACTION = 0.06

/** DIP mínima em pixels: abaixo disso não há detalhe para simular. */
export const MIN_IPD_PX = 90

export type QualityIssueCode =
  | 'angle_yaw'
  | 'angle_pitch'
  | 'angle_roll'
  | 'blur'
  | 'underexposed'
  | 'overexposed'
  | 'clipped'
  | 'too_small'

export interface QualityIssue {
  code: QualityIssueCode
  /** Texto de interface: diz o que corrigir, sem desculpa e sem vaguidade. */
  message: string
}

export interface QualityMetrics {
  pose: HeadPose
  laplacianVariance: number
  meanLuma: number
  clippedFraction: number
  ipdPx: number
}

export interface QualityReport {
  ok: boolean
  issues: QualityIssue[]
  metrics: QualityMetrics
}

/** Retângulo do rosto em pixels, com folga, a partir dos landmarks. */
export function faceBounds(
  landmarks: readonly Landmark[],
  width: number,
  height: number,
  padding = 0.06,
): { x: number; y: number; width: number; height: number } {
  let minX = 1
  let minY = 1
  let maxX = 0
  let maxY = 0

  for (const landmark of landmarks) {
    if (landmark.x < minX) minX = landmark.x
    if (landmark.y < minY) minY = landmark.y
    if (landmark.x > maxX) maxX = landmark.x
    if (landmark.y > maxY) maxY = landmark.y
  }

  const padX = (maxX - minX) * padding
  const padY = (maxY - minY) * padding

  const x = Math.max(0, Math.floor((minX - padX) * width))
  const y = Math.max(0, Math.floor((minY - padY) * height))
  const right = Math.min(width, Math.ceil((maxX + padX) * width))
  const bottom = Math.min(height, Math.ceil((maxY + padY) * height))

  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) }
}

/** Luminância percebida (Rec. 601), suficiente e barata para este uso. */
function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

interface GrayCrop {
  data: Float32Array
  width: number
  height: number
}

function toGrayCrop(
  image: ImageData,
  bounds: { x: number; y: number; width: number; height: number },
): GrayCrop {
  const { width: cw, height: ch } = bounds
  const gray = new Float32Array(cw * ch)

  for (let row = 0; row < ch; row += 1) {
    const sourceRow = (bounds.y + row) * image.width
    for (let col = 0; col < cw; col += 1) {
      const index = (sourceRow + bounds.x + col) * 4
      gray[row * cw + col] = luma(
        image.data[index] ?? 0,
        image.data[index + 1] ?? 0,
        image.data[index + 2] ?? 0,
      )
    }
  }

  return { data: gray, width: cw, height: ch }
}

/**
 * Variância do Laplaciano 4-vizinhos. É a medida de nitidez padrão: o Laplaciano
 * responde a bordas, e foto desfocada tem poucas bordas fortes, logo variância
 * baixa.
 */
export function laplacianVariance(crop: GrayCrop): number {
  const { data, width, height } = crop
  if (width < 3 || height < 3) return 0

  let sum = 0
  let sumSquares = 0
  let count = 0

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x
      const value =
        4 * (data[i] ?? 0) -
        (data[i - 1] ?? 0) -
        (data[i + 1] ?? 0) -
        (data[i - width] ?? 0) -
        (data[i + width] ?? 0)
      sum += value
      sumSquares += value * value
      count += 1
    }
  }

  if (count === 0) return 0
  const mean = sum / count
  return sumSquares / count - mean * mean
}

function exposure(crop: GrayCrop): { meanLuma: number; clippedFraction: number } {
  let sum = 0
  let clipped = 0
  for (const value of crop.data) {
    sum += value
    if (value <= 4 || value >= 251) clipped += 1
  }
  const count = crop.data.length || 1
  return { meanLuma: sum / count, clippedFraction: clipped / count }
}

/**
 * Avalia a foto. Recebe o `ImageData` já reduzido (lado maior ≤ 2048 px) e a
 * geometria da detecção.
 */
export function assessQuality(
  image: ImageData,
  landmarks: readonly Landmark[],
  pose: HeadPose,
  ipdPx: number,
): QualityReport {
  const bounds = faceBounds(landmarks, image.width, image.height)
  const crop = toGrayCrop(image, bounds)
  const variance = laplacianVariance(crop)
  const { meanLuma, clippedFraction } = exposure(crop)

  const issues: QualityIssue[] = []

  if (Math.abs(pose.yaw) > MAX_ANGLE_DEG) {
    issues.push({
      code: 'angle_yaw',
      message: 'Rosto de perfil. Reposicione para frontal.',
    })
  }
  if (Math.abs(pose.pitch) > MAX_ANGLE_DEG) {
    issues.push({
      code: 'angle_pitch',
      message:
        pose.pitch > 0
          ? 'Queixo levantado. Baixe o queixo até o rosto ficar frontal.'
          : 'Queixo baixo. Levante o queixo até o rosto ficar frontal.',
    })
  }
  if (Math.abs(pose.roll) > MAX_ANGLE_DEG) {
    issues.push({
      code: 'angle_roll',
      message: 'Cabeça inclinada. Alinhe os olhos na horizontal.',
    })
  }
  if (ipdPx < MIN_IPD_PX) {
    issues.push({
      code: 'too_small',
      message: 'Rosto pequeno na foto. Aproxime a câmera e refaça.',
    })
  }
  if (variance < MIN_LAPLACIAN_VARIANCE) {
    issues.push({ code: 'blur', message: 'Foto desfocada. Apoie o tablet e refaça.' })
  }
  if (meanLuma < MIN_FACE_LUMA) {
    issues.push({ code: 'underexposed', message: 'Foto escura. Aumente a luz do ambiente.' })
  }
  if (meanLuma > MAX_FACE_LUMA) {
    issues.push({
      code: 'overexposed',
      message: 'Foto estourada. Reduza a luz direta sobre o rosto.',
    })
  }
  if (clippedFraction > MAX_CLIPPED_FRACTION) {
    issues.push({
      code: 'clipped',
      message: 'Luz muito dura no rosto. Suavize a iluminação e refaça.',
    })
  }

  return {
    ok: issues.length === 0,
    issues,
    metrics: { pose, laplacianVariance: variance, meanLuma, clippedFraction, ipdPx },
  }
}
