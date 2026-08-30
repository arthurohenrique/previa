/**
 * Luminância e filtros em ponto flutuante — base da camada fotométrica.
 * Funções puras sobre Float32Array (0..1), na resolução do campo de warp.
 */

export interface LumaImage {
  /** Luminância Rec. 601 em 0..1, linha a linha. */
  y: Float32Array
  width: number
  height: number
}

/** RGBA intercalado (0..255) → luminância 0..1. */
export function lumaFromRgba(rgba: Uint8ClampedArray, width: number, height: number): LumaImage {
  const y = new Float32Array(width * height)
  for (let i = 0; i < y.length; i++) {
    const offset = i * 4
    y[i] = (0.299 * rgba[offset] + 0.587 * rgba[offset + 1] + 0.114 * rgba[offset + 2]) / 255
  }
  return { y, width, height }
}

/** Box blur separável em float (bordas replicadas). radius 0 devolve cópia. */
export function boxBlurFloat(
  source: Float32Array,
  width: number,
  height: number,
  radius: number,
): Float32Array {
  if (radius <= 0) return source.slice()
  const horizontal = new Float32Array(source.length)
  const output = new Float32Array(source.length)
  const window = 2 * radius + 1

  for (let y = 0; y < height; y++) {
    const row = y * width
    let sum = 0
    for (let x = -radius; x <= radius; x++) sum += source[row + Math.min(width - 1, Math.max(0, x))]
    for (let x = 0; x < width; x++) {
      horizontal[row + x] = sum / window
      sum += source[row + Math.min(width - 1, x + radius + 1)] - source[row + Math.max(0, x - radius)]
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0
    for (let y = -radius; y <= radius; y++) sum += horizontal[Math.min(height - 1, Math.max(0, y)) * width + x]
    for (let y = 0; y < height; y++) {
      output[y * width + x] = sum / window
      sum +=
        horizontal[Math.min(height - 1, y + radius + 1) * width + x] -
        horizontal[Math.max(0, y - radius) * width + x]
    }
  }
  return output
}

/**
 * Blur normalizado por peso: média de `values` ponderada por `weight` numa
 * janela — preenche "buracos" (peso 0) com a vizinhança. Onde o peso
 * acumulado é ~0 devolve `fallback`.
 */
export function normalizedBlur(
  values: Float32Array,
  weight: Float32Array,
  width: number,
  height: number,
  radius: number,
  fallback = 0,
): Float32Array {
  const weighted = new Float32Array(values.length)
  for (let i = 0; i < values.length; i++) weighted[i] = values[i] * weight[i]
  const numerator = boxBlurFloat(weighted, width, height, radius)
  const denominator = boxBlurFloat(weight, width, height, radius)
  const output = new Float32Array(values.length)
  for (let i = 0; i < values.length; i++) {
    output[i] = denominator[i] > 1e-4 ? numerator[i] / denominator[i] : fallback
  }
  return output
}

/** Gradiente por diferenças centrais (bordas replicadas), em unidades por pixel. */
export function gradient(
  source: Float32Array,
  width: number,
  height: number,
  outX: Float32Array,
  outY: Float32Array,
): void {
  for (let y = 0; y < height; y++) {
    const up = Math.max(0, y - 1) * width
    const down = Math.min(height - 1, y + 1) * width
    const row = y * width
    for (let x = 0; x < width; x++) {
      const left = Math.max(0, x - 1)
      const right = Math.min(width - 1, x + 1)
      outX[row + x] = (source[row + right] - source[row + left]) / 2
      outY[row + x] = (source[down + x] - source[up + x]) / 2
    }
  }
}
