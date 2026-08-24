/**
 * Máscaras de segmentação facial — funções puras, sem DOM.
 *
 * O resultado da segmentação (IA ou polígono de landmarks) é sempre um
 * "labelmap": um Uint8Array onde cada pixel guarda o id da classe. Daqui
 * saem as máscaras alpha por classe, com borda suavizada.
 */

/** Classes do face-parsing (SegFormer jonathandinu/face-parsing). */
export const FACE_CLASSES = {
  background: 0,
  skin: 1,
  nose: 2,
  eye_g: 3,
  l_eye: 4,
  r_eye: 5,
  l_brow: 6,
  r_brow: 7,
  l_ear: 8,
  r_ear: 9,
  mouth: 10,
  u_lip: 11,
  l_lip: 12,
  hair: 13,
  hat: 14,
  ear_r: 15,
  neck_l: 16,
  neck: 17,
  cloth: 18,
} as const

export type FaceClassName = keyof typeof FACE_CLASSES

export const CLASS_LABELS_PT: Partial<Record<FaceClassName, string>> = {
  skin: 'Pele',
  nose: 'Nariz',
  l_eye: 'Olho esq.',
  r_eye: 'Olho dir.',
  l_brow: 'Sobrancelha esq.',
  r_brow: 'Sobrancelha dir.',
  u_lip: 'Lábio superior',
  l_lip: 'Lábio inferior',
  mouth: 'Boca (interna)',
  hair: 'Cabelo',
}

export interface LabelMap {
  labels: Uint8Array
  width: number
  height: number
}

/** Máscara binária (0/255) dos pixels que pertencem a qualquer das classes. */
export function classAlpha(map: LabelMap, classIds: readonly number[]): Uint8ClampedArray {
  const wanted = new Set(classIds)
  const alpha = new Uint8ClampedArray(map.labels.length)
  for (let i = 0; i < map.labels.length; i++) {
    if (wanted.has(map.labels[i])) alpha[i] = 255
  }
  return alpha
}

/**
 * Box blur separável (duas passadas 1D com janela deslizante, O(n) por
 * passada). Aplicado à máscara binária, vira a "borda suavizada": o interior
 * segue 255, a transição cai em rampa ao longo de ~2·radius pixels.
 */
export function boxBlurAlpha(
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
): Uint8ClampedArray {
  if (radius <= 0) return alpha.slice()
  const horizontal = new Float32Array(alpha.length)
  const output = new Uint8ClampedArray(alpha.length)
  const window = 2 * radius + 1

  // Passada horizontal
  for (let y = 0; y < height; y++) {
    const row = y * width
    let sum = 0
    for (let x = -radius; x <= radius; x++) {
      sum += alpha[row + Math.min(width - 1, Math.max(0, x))]
    }
    for (let x = 0; x < width; x++) {
      horizontal[row + x] = sum / window
      const leaving = row + Math.max(0, x - radius)
      const entering = row + Math.min(width - 1, x + radius + 1)
      sum += alpha[entering] - alpha[leaving]
    }
  }

  // Passada vertical
  for (let x = 0; x < width; x++) {
    let sum = 0
    for (let y = -radius; y <= radius; y++) {
      sum += horizontal[Math.min(height - 1, Math.max(0, y)) * width + x]
    }
    for (let y = 0; y < height; y++) {
      output[y * width + x] = sum / window
      const leaving = Math.max(0, y - radius) * width + x
      const entering = Math.min(height - 1, y + radius + 1) * width + x
      sum += horizontal[entering] - horizontal[leaving]
    }
  }

  return output
}

/** Alpha suavizado de um conjunto de classes — atalho usado pela UI. */
export function smoothClassAlpha(
  map: LabelMap,
  classIds: readonly number[],
  blurRadius: number,
): Uint8ClampedArray {
  return boxBlurAlpha(classAlpha(map, classIds), map.width, map.height, blurRadius)
}
