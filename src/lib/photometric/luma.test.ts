import { describe, expect, it } from 'vitest'
import { boxBlurFloat, gradient, lumaFromRgba, normalizedBlur } from './luma'

describe('lumaFromRgba', () => {
  it('Rec. 601 normalizada em 0..1', () => {
    const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255])
    const luma = lumaFromRgba(rgba, 3, 1)
    expect(luma.y[0]).toBeCloseTo(1)
    expect(luma.y[1]).toBeCloseTo(0)
    expect(luma.y[2]).toBeCloseTo(0.299)
  })
})

describe('boxBlurFloat', () => {
  it('preserva imagem constante e a média de um impulso', () => {
    const constant = new Float32Array(25).fill(0.4)
    expect(Array.from(boxBlurFloat(constant, 5, 5, 1)).every((v) => Math.abs(v - 0.4) < 1e-6)).toBe(true)
    const impulse = new Float32Array(49)
    impulse[24] = 9
    const blurred = boxBlurFloat(impulse, 7, 7, 1)
    expect(blurred[24]).toBeCloseTo(1)
    expect(blurred[0]).toBe(0)
  })
})

describe('normalizedBlur', () => {
  it('preenche um buraco (peso 0) com a vizinhança', () => {
    const values = new Float32Array(9).fill(0.6)
    values[4] = 0.1
    const weight = new Float32Array(9).fill(1)
    weight[4] = 0
    const filled = normalizedBlur(values, weight, 3, 3, 1)
    expect(filled[4]).toBeCloseTo(0.6)
  })

  it('usa o fallback onde não há peso', () => {
    const filled = normalizedBlur(new Float32Array(4), new Float32Array(4), 2, 2, 1, 0.5)
    expect(filled[0]).toBe(0.5)
  })
})

describe('gradient', () => {
  it('rampa horizontal → ∂x constante, ∂y zero', () => {
    const width = 5
    const source = new Float32Array(15)
    for (let y = 0; y < 3; y++) for (let x = 0; x < width; x++) source[y * width + x] = x * 0.1
    const gx = new Float32Array(15)
    const gy = new Float32Array(15)
    gradient(source, width, 3, gx, gy)
    expect(gx[7]).toBeCloseTo(0.1)
    expect(gy[7]).toBeCloseTo(0)
  })
})
