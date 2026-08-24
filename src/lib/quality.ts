/**
 * Validação de qualidade da foto — funções puras, testáveis, sem DOM.
 *
 * A foto é recusada com instrução de correção quando: não há rosto, há mais
 * de um rosto, o rosto está de perfil ou a imagem está sem nitidez.
 */

export type QualityIssue =
  | 'sem-rosto'
  | 'multiplos-rostos'
  | 'rosto-de-perfil'
  | 'sem-nitidez'

export const QUALITY_MESSAGES: Record<QualityIssue, { title: string; hint: string }> = {
  'sem-rosto': {
    title: 'Nenhum rosto encontrado',
    hint: 'Enquadre o rosto do paciente no centro da foto, com boa iluminação.',
  },
  'multiplos-rostos': {
    title: 'Mais de um rosto na foto',
    hint: 'Fotografe apenas o paciente, sem outras pessoas ao fundo.',
  },
  'rosto-de-perfil': {
    title: 'Rosto de perfil',
    hint: 'Peça ao paciente para olhar de frente para a câmera.',
  },
  'sem-nitidez': {
    title: 'Foto sem nitidez',
    hint: 'Segure o aparelho firme e refaça a foto com mais luz.',
  },
}

export interface Point2 {
  x: number
  y: number
}

/** 0 ou 2+ rostos são recusados; exatamente 1 passa. */
export function validateFaceCount(count: number): QualityIssue | null {
  if (count === 0) return 'sem-rosto'
  if (count > 1) return 'multiplos-rostos'
  return null
}

/**
 * Proxy de yaw (rotação lateral) sem matriz 3D: razão entre as distâncias
 * horizontais da ponta do nariz até cada borda do contorno do rosto.
 * Rosto frontal ≈ 1.0; quanto mais de perfil, mais a razão foge de 1.
 */
export function estimateYawRatio(
  noseTip: Point2,
  leftEdge: Point2,
  rightEdge: Point2,
): number {
  const epsilon = 1e-6
  const distanceLeft = Math.max(Math.abs(noseTip.x - leftEdge.x), epsilon)
  const distanceRight = Math.max(Math.abs(rightEdge.x - noseTip.x), epsilon)
  return distanceLeft / distanceRight
}

/** Acima disso (ou abaixo do inverso), consideramos rosto de perfil. */
export const YAW_RATIO_LIMIT = 2.2

export function isFrontal(yawRatio: number, limit: number = YAW_RATIO_LIMIT): boolean {
  return yawRatio <= limit && yawRatio >= 1 / limit
}

/** Luminância Rec. 601 a partir de RGBA intercalado. */
export function toGrayscale(rgba: Uint8ClampedArray): Float32Array {
  const gray = new Float32Array(rgba.length / 4)
  for (let i = 0; i < gray.length; i++) {
    const offset = i * 4
    gray[i] =
      0.299 * rgba[offset] + 0.587 * rgba[offset + 1] + 0.114 * rgba[offset + 2]
  }
  return gray
}

/**
 * Nitidez: variância do Laplaciano 4-vizinhos sobre a luminância.
 * Imagem borrada tem bordas fracas -> Laplaciano quase constante -> variância
 * baixa. Medir SEMPRE na mesma escala (ver SHARPNESS_MEASURE_WIDTH) para o
 * limiar valer entre fotos de tamanhos diferentes.
 */
export function laplacianVariance(
  gray: Float32Array,
  width: number,
  height: number,
): number {
  if (width < 3 || height < 3) return 0
  let sum = 0
  let sumSquares = 0
  const count = (width - 2) * (height - 2)
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      const lap =
        4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - width] - gray[i + width]
      sum += lap
      sumSquares += lap * lap
    }
  }
  const mean = sum / count
  return sumSquares / count - mean * mean
}

/** Largura padrão em que a nitidez é medida. */
export const SHARPNESS_MEASURE_WIDTH = 256

/** Limiar mínimo de variância do Laplaciano para aceitar a foto. */
export const SHARPNESS_MIN = 12

export function isSharp(variance: number, minimum: number = SHARPNESS_MIN): boolean {
  return variance >= minimum
}
