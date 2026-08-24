/**
 * Recorte e composição da geração local — funções puras.
 *
 * A difusão NUNCA vê nem devolve a foto inteira: recebe um recorte quadrado
 * ao redor da região ativa e o resultado volta APENAS onde a máscara permite,
 * com borda em pluma. Fora da máscara o pixel é bit a bit o original — é a
 * contenção exigida pela emenda da restrição nº 3.
 */

export interface BBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface CropRect {
  x: number
  y: number
  size: number
}

/** Caixa envolvente dos pixels com alpha acima do limiar; null se vazio. */
export function alphaBBox(
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
  threshold = 16,
): BBox | null {
  let x0 = width
  let y0 = height
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (alpha[y * width + x] > threshold) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 }
}

/**
 * Quadrado de recorte: bbox expandida pela margem, quadrada, presa aos
 * limites da imagem e com tamanho mínimo (a difusão trabalha melhor com
 * contexto ao redor da região).
 */
export function squareCrop(
  bbox: BBox,
  imageWidth: number,
  imageHeight: number,
  marginFactor = 1.8,
  minSize = 160,
): CropRect {
  const boxWidth = bbox.x1 - bbox.x0 + 1
  const boxHeight = bbox.y1 - bbox.y0 + 1
  const centerX = (bbox.x0 + bbox.x1) / 2
  const centerY = (bbox.y0 + bbox.y1) / 2

  let size = Math.ceil(Math.max(boxWidth, boxHeight) * marginFactor)
  size = Math.max(size, minSize)
  size = Math.min(size, imageWidth, imageHeight)

  let x = Math.round(centerX - size / 2)
  let y = Math.round(centerY - size / 2)
  x = Math.min(Math.max(x, 0), imageWidth - size)
  y = Math.min(Math.max(y, 0), imageHeight - size)

  return { x, y, size }
}

/**
 * Composição final, in-place sobre `base` (RGBA da foto inteira):
 * dentro do recorte, cada pixel vira mistura base↔gerado pesada pelo alpha
 * em pluma (0..255). `generated` e `featherAlpha` estão na resolução do
 * recorte (crop.size × crop.size).
 */
export function compositeCrop(
  base: Uint8ClampedArray,
  imageWidth: number,
  generated: Uint8ClampedArray,
  featherAlpha: Uint8ClampedArray,
  crop: CropRect,
): void {
  for (let cy = 0; cy < crop.size; cy++) {
    for (let cx = 0; cx < crop.size; cx++) {
      const weight = featherAlpha[cy * crop.size + cx] / 255
      if (weight === 0) continue
      const baseOffset = ((crop.y + cy) * imageWidth + (crop.x + cx)) * 4
      const genOffset = (cy * crop.size + cx) * 4
      for (let channel = 0; channel < 3; channel++) {
        base[baseOffset + channel] =
          base[baseOffset + channel] * (1 - weight) +
          generated[genOffset + channel] * weight
      }
    }
  }
}

/** RGBA (0..255) → CHW float32 em [-1, 1], formato do VAE encoder. */
export function rgbaToTensor(pixels: Uint8ClampedArray, size: number): Float32Array {
  const plane = size * size
  const tensor = new Float32Array(3 * plane)
  for (let i = 0; i < plane; i++) {
    tensor[i] = (pixels[i * 4] / 255) * 2 - 1
    tensor[plane + i] = (pixels[i * 4 + 1] / 255) * 2 - 1
    tensor[2 * plane + i] = (pixels[i * 4 + 2] / 255) * 2 - 1
  }
  return tensor
}

/** CHW float32 em [-1, 1] → RGBA opaco (0..255). */
export function tensorToRgba(tensor: Float32Array, size: number): Uint8ClampedArray {
  const plane = size * size
  const pixels = new Uint8ClampedArray(plane * 4)
  for (let i = 0; i < plane; i++) {
    pixels[i * 4] = (Math.min(1, Math.max(-1, tensor[i])) / 2 + 0.5) * 255
    pixels[i * 4 + 1] = (Math.min(1, Math.max(-1, tensor[plane + i])) / 2 + 0.5) * 255
    pixels[i * 4 + 2] = (Math.min(1, Math.max(-1, tensor[2 * plane + i])) / 2 + 0.5) * 255
    pixels[i * 4 + 3] = 255
  }
  return pixels
}
