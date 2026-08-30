/**
 * Shadow lift — o efeito principal de sulco nasogeniano e olheira: o
 * preenchimento apaga a SOMBRA da depressão. Trazemos a luminância de baixa
 * frequência dentro da máscara até a da pele vizinha; a alta frequência
 * (poros, textura) fica intacta porque o shader SOMA o lift à luminância
 * original em vez de substituí-la. Só clareia, nunca escurece.
 */

import { boxBlurFloat, normalizedBlur, type LumaImage } from './luma'

/** Teto do lift como fração da luminância de referência. */
export const LIFT_MAX_FRACTION = 0.12

/**
 * @param mask   peso 0..1 da região (onde a sombra está)
 * @param small  raio da baixa frequência local (px)
 * @param large  raio da vizinhança de referência (px), ~2× small
 * @param gain   0..1: fração da diferença que o preenchimento recupera
 */
export function shadowLift(
  luma: LumaImage,
  mask: Float32Array,
  small: number,
  large: number,
  gain: number,
  out: Float32Array,
): void {
  const { y, width, height } = luma
  const low = boxBlurFloat(y, width, height, small)
  const outside = new Float32Array(mask.length)
  for (let i = 0; i < mask.length; i++) outside[i] = 1 - mask[i]
  const reference = normalizedBlur(y, outside, width, height, large)
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] <= 0) {
      out[i] = 0
      continue
    }
    const deficit = reference[i] - low[i]
    const lift = deficit > 0 ? gain * mask[i] * deficit : 0
    out[i] = Math.min(lift, LIFT_MAX_FRACTION * reference[i])
  }
}
