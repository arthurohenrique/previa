import { describe, expect, it } from 'vitest'
import { fromHalf, HALF_ONE, packField, packMask, toHalf } from './halfFloat'

describe('toHalf / fromHalf', () => {
  it('valores exatos: 0, ±1, 0.5, 2', () => {
    expect(toHalf(0)).toBe(0)
    expect(toHalf(1)).toBe(HALF_ONE)
    expect(fromHalf(toHalf(-1))).toBe(-1)
    expect(fromHalf(toHalf(0.5))).toBe(0.5)
    expect(fromHalf(toHalf(2))).toBe(2)
  })

  it('ida e volta com erro relativo < 1e-3 na faixa do campo', () => {
    for (const value of [0.0123, -0.045, 0.00071, 0.31, -0.5, 3.7e-5]) {
      const back = fromHalf(toHalf(value))
      expect(Math.abs(back - value) / Math.abs(value)).toBeLessThan(1e-3)
    }
  })

  it('subnormais e extremos', () => {
    expect(fromHalf(toHalf(1e-6))).toBeCloseTo(1e-6, 7)
    expect(toHalf(1e-9)).toBe(0)
    expect(fromHalf(toHalf(1e6))).toBe(Infinity)
  })
})

describe('packField', () => {
  it('R = dx, G = dy, B = shade, A = lift por texel', () => {
    const disp = new Float32Array([0.25, -0.5, 0, 1])
    const photo = new Float32Array([0.125, 0.0625, 1, 0, -0.125, 0.25, 0, 1])
    const out = new Uint16Array(8)
    packField(disp, photo, 2, out)
    expect(fromHalf(out[0])).toBe(0.25)
    expect(fromHalf(out[1])).toBe(-0.5)
    expect(fromHalf(out[2])).toBe(0.125)
    expect(fromHalf(out[3])).toBe(0.0625)
    expect(fromHalf(out[6])).toBe(-0.125)
    expect(fromHalf(out[7])).toBe(0.25)
  })

  it('rejeita buffer pequeno', () => {
    expect(() => packField(new Float32Array(2), new Float32Array(4), 1, new Uint16Array(3))).toThrow()
  })
})

describe('packMask', () => {
  it('R = lip, G = edge em 0..255, alpha opaco, valores saturados', () => {
    const photo = new Float32Array([0, 0, 1, 0.5, 0, 0, 1.7, -0.2])
    const out = new Uint8Array(8)
    packMask(photo, 2, out)
    expect(Array.from(out)).toEqual([255, 128, 0, 255, 255, 0, 0, 255])
  })
})
