import { describe, expect, it } from 'vitest'
import { lipBands } from './lips'

describe('lipBands', () => {
  const width = 40
  const height = 30
  const alpha = new Uint8ClampedArray(width * height)
  for (let y = 10; y < 20; y++) for (let x = 8; x < 32; x++) alpha[y * width + x] = 255
  const bands = lipBands(alpha, width, height, 2)
  const at = (buffer: Float32Array, x: number, y: number) => buffer[y * width + x]

  it('lip é 1 dentro do vermelhão e 0 fora', () => {
    expect(at(bands.lip, 20, 15)).toBe(1)
    expect(at(bands.lip, 20, 3)).toBe(0)
  })

  it('edge marca a borda, não o interior nem o fundo distante', () => {
    expect(at(bands.edge, 20, 10)).toBeGreaterThan(0.3)
    expect(at(bands.edge, 20, 15)).toBeLessThan(0.05)
    expect(at(bands.edge, 20, 2)).toBe(0)
    for (const value of bands.edge) expect(value).toBeLessThanOrEqual(1)
  })
})
