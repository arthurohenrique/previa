import { describe, expect, it } from 'vitest'
import {
  estimateYawRatio,
  isFrontal,
  isSharp,
  laplacianVariance,
  toGrayscale,
  validateFaceCount,
  YAW_RATIO_LIMIT,
} from './quality'

describe('validateFaceCount', () => {
  it('recusa zero rostos', () => {
    expect(validateFaceCount(0)).toBe('sem-rosto')
  })
  it('recusa múltiplos rostos', () => {
    expect(validateFaceCount(2)).toBe('multiplos-rostos')
    expect(validateFaceCount(5)).toBe('multiplos-rostos')
  })
  it('aceita exatamente um', () => {
    expect(validateFaceCount(1)).toBeNull()
  })
})

describe('estimateYawRatio / isFrontal', () => {
  const point = (x: number) => ({ x, y: 0.5 })

  it('rosto simétrico dá razão 1', () => {
    expect(estimateYawRatio(point(0.5), point(0.3), point(0.7))).toBeCloseTo(1)
  })

  it('nariz deslocado para a borda dá razão alta', () => {
    const ratio = estimateYawRatio(point(0.65), point(0.3), point(0.7))
    expect(ratio).toBeCloseTo(0.35 / 0.05)
    expect(isFrontal(ratio)).toBe(false)
  })

  it('frontalidade é simétrica nos dois sentidos', () => {
    expect(isFrontal(YAW_RATIO_LIMIT)).toBe(true)
    expect(isFrontal(1 / YAW_RATIO_LIMIT)).toBe(true)
    expect(isFrontal(YAW_RATIO_LIMIT + 0.01)).toBe(false)
    expect(isFrontal(1 / (YAW_RATIO_LIMIT + 0.01))).toBe(false)
  })
})

describe('toGrayscale', () => {
  it('converte RGBA em luminância Rec. 601', () => {
    // branco, preto, vermelho puro
    const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255])
    const gray = toGrayscale(rgba)
    expect(gray[0]).toBeCloseTo(255)
    expect(gray[1]).toBeCloseTo(0)
    expect(gray[2]).toBeCloseTo(0.299 * 255)
  })
})

describe('laplacianVariance', () => {
  const flat = (w: number, h: number, value: number) =>
    new Float32Array(w * h).fill(value)

  it('imagem uniforme tem variância zero', () => {
    expect(laplacianVariance(flat(8, 8, 128), 8, 8)).toBe(0)
  })

  it('gradiente linear tem variância ~zero (Laplaciano constante)', () => {
    const w = 8
    const h = 8
    const gray = new Float32Array(w * h)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) gray[y * w + x] = x * 10
    expect(laplacianVariance(gray, w, h)).toBeCloseTo(0)
  })

  it('xadrez (bordas fortes) tem variância alta', () => {
    const w = 8
    const h = 8
    const gray = new Float32Array(w * h)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) gray[y * w + x] = (x + y) % 2 === 0 ? 255 : 0
    const variance = laplacianVariance(gray, w, h)
    expect(variance).toBeGreaterThan(10000)
    expect(isSharp(variance)).toBe(true)
  })

  it('imagem menor que o kernel devolve zero', () => {
    expect(laplacianVariance(flat(2, 2, 50), 2, 2)).toBe(0)
  })
})
