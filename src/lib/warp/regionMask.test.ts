import { describe, expect, it } from 'vitest'
import { falloff, regionAlpha } from './regionMask'
import { syntheticFace, syntheticMap } from './__fixtures__/face'

const landmarks = syntheticFace()
const map = syntheticMap()
const at = (alpha: Uint8ClampedArray, xPx: number, yPx: number) =>
  alpha[Math.round(yPx / 4) * map.width + Math.round(xPx / 4)]

describe('falloff', () => {
  it('1 no centro, 0 na borda, monotônica', () => {
    expect(falloff(0)).toBe(1)
    expect(falloff(1)).toBe(0)
    expect(falloff(0.5)).toBeGreaterThan(falloff(0.7))
  })
})

describe('regionAlpha', () => {
  it('lábios seguem a classe da máscara', () => {
    const upper = regionAlpha('labio-superior', landmarks, map)
    expect(at(upper, 384, 686)).toBeGreaterThan(200)
    expect(at(upper, 384, 720)).toBeLessThan(60) // lábio inferior
    expect(at(upper, 384, 560)).toBe(0) // nariz
  })

  it('mento é uma elipse: máximo no queixo, zero na testa', () => {
    const chin = regionAlpha('mento', landmarks, map)
    expect(at(chin, 384, 870)).toBeGreaterThan(200)
    expect(at(chin, 384, 400)).toBe(0)
  })

  it('malar direito fica do lado esquerdo da imagem', () => {
    const malar = regionAlpha('malar-direito', landmarks, map)
    expect(at(malar, 290, 570)).toBeGreaterThan(150)
    expect(at(malar, 480, 570)).toBe(0)
  })
})
