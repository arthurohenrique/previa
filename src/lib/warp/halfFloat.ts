/**
 * Conversão float32 ↔ half (IEEE 754 binary16) e empacotamento das texturas
 * do filtro. Half é filtrável nativamente em WebGL2 e WebGPU; float32 não é
 * garantido. Precisão: 10 bits de mantissa → para deslocamentos de até ~5%
 * da foto, erro < 0,05px em 4096px.
 */

const floatView = new Float32Array(1)
const intView = new Uint32Array(floatView.buffer)

export const HALF_ONE = 0x3c00

export function toHalf(value: number): number {
  floatView[0] = value
  const bits = intView[0]
  const sign = (bits >>> 16) & 0x8000
  let exponent = ((bits >>> 23) & 0xff) - 127 + 15
  let mantissa = bits & 0x7fffff

  if (exponent >= 31) return sign | 0x7c00 // overflow/inf/NaN → inf
  if (exponent <= 0) {
    if (exponent < -10) return sign // underflow → ±0
    // Subnormal: mantissa explícita, deslocada; arredonda para o mais próximo.
    mantissa = (mantissa | 0x800000) >> (1 - exponent)
    return sign | ((mantissa + 0x1000) >> 13)
  }
  // Arredondamento para o mais próximo (carry propaga para o expoente).
  return sign | ((((exponent << 23) | mantissa) + 0x1000) >> 13)
}

export function fromHalf(half: number): number {
  const sign = half & 0x8000 ? -1 : 1
  const exponent = (half >> 10) & 0x1f
  const mantissa = half & 0x3ff
  if (exponent === 0) return sign * Math.pow(2, -14) * (mantissa / 1024)
  if (exponent === 31) return mantissa === 0 ? sign * Infinity : NaN
  return sign * Math.pow(2, exponent - 15) * (1 + mantissa / 1024)
}

/**
 * Textura do campo: texels RGBA half com R = dx, G = dy, B = shade,
 * A = lift. `disp` tem 2 canais e `photo` 4 ([shade, lift, lip, edge]).
 */
export function packField(
  disp: Float32Array,
  photo: Float32Array,
  texelCount: number,
  out: Uint16Array,
): void {
  if (out.length < texelCount * 4) throw new Error('Buffer half menor que texelCount × 4.')
  for (let i = 0; i < texelCount; i++) {
    const target = i * 4
    out[target] = toHalf(disp[i * 2])
    out[target + 1] = toHalf(disp[i * 2 + 1])
    out[target + 2] = toHalf(photo[i * 4])
    out[target + 3] = toHalf(photo[i * 4 + 1])
  }
}

/** Textura de máscara: RGBA8 com R = lip, G = edge (0..255), B = 0, A = 255. */
export function packMask(photo: Float32Array, texelCount: number, out: Uint8Array): void {
  if (out.length < texelCount * 4) throw new Error('Buffer de máscara menor que texelCount × 4.')
  for (let i = 0; i < texelCount; i++) {
    const target = i * 4
    out[target] = Math.round(Math.min(1, Math.max(0, photo[i * 4 + 2])) * 255)
    out[target + 1] = Math.round(Math.min(1, Math.max(0, photo[i * 4 + 3])) * 255)
    out[target + 2] = 0
    out[target + 3] = 255
  }
}
