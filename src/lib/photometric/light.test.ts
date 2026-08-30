import { describe, expect, it } from 'vitest'
import { estimateLight, meanSkinLuma } from './light'
import type { LumaImage } from './luma'
import { syntheticFace, syntheticMap } from '@/lib/warp/__fixtures__/face'

const landmarks = syntheticFace()
const map = syntheticMap()

function lumaFrom(fn: (u: number, v: number) => number): LumaImage {
  const width = 192
  const height = 256
  const y = new Float32Array(width * height)
  for (let j = 0; j < height; j++)
    for (let i = 0; i < width; i++) y[j * width + i] = fn((i + 0.5) / width, (j + 0.5) / height)
  return { y, width, height }
}

describe('estimateLight', () => {
  it('iluminação uniforme → luz frontal', () => {
    const light = estimateLight(lumaFrom(() => 0.6), map, landmarks)
    expect(light.x).toBeCloseTo(0)
    expect(light.y).toBeCloseTo(0)
    expect(light.z).toBeCloseTo(1)
  })

  it('lado esquerdo da imagem mais claro → luz vem da esquerda (x < 0)', () => {
    const light = estimateLight(lumaFrom((u) => 0.8 - 0.5 * u), map, landmarks)
    expect(light.x).toBeLessThan(-0.3)
    expect(Math.abs(light.y)).toBeLessThan(0.1)
  })

  it('testa mais clara que o mento → luz vem de cima (y < 0)', () => {
    const light = estimateLight(lumaFrom((_u, v) => 0.8 - 0.5 * v), map, landmarks)
    expect(light.y).toBeLessThan(-0.3)
    expect(Math.abs(light.x)).toBeLessThan(0.1)
  })

  it('componente lateral é limitada e o vetor é unitário', () => {
    const light = estimateLight(lumaFrom((u) => (u < 0.5 ? 1 : 0.05)), map, landmarks)
    expect(Math.hypot(light.x, light.y, light.z)).toBeCloseTo(1)
    expect(light.x).toBeGreaterThan(-0.75)
  })
})

describe('meanSkinLuma', () => {
  it('ignora pixels que não são pele e devolve null sem amostras', () => {
    const luma = lumaFrom((_u, v) => (v < 0.4 ? 0.9 : 0.3))
    // Sobre os lábios (classe u_lip) não há pele suficiente → null.
    expect(meanSkinLuma(luma, map, landmarks[13], 2)).toBeNull()
    // Bochecha: só pele, valor da região inferior.
    expect(meanSkinLuma(luma, map, landmarks[50], 8)).toBeCloseTo(0.3)
  })
})
