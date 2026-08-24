import { describe, expect, it } from 'vitest'
import type { Point2 } from '@/lib/quality'
import { FACE_CLASSES, type LabelMap } from '@/lib/segmentation/mask'
import { buildShadingSource } from './shading'

function landmarksFixture(): Point2[] {
  const landmarks: Point2[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }))
  landmarks[468] = { x: 0.4, y: 0.4 }
  landmarks[473] = { x: 0.6, y: 0.4 }
  for (const index of [50, 116, 117, 118]) landmarks[index] = { x: 0.35, y: 0.55 }
  return landmarks
}

function mapFixture(): LabelMap {
  const width = 100
  const height = 100
  const labels = new Uint8Array(width * height)
  for (let y = 64; y < 69; y++)
    for (let x = 40; x < 60; x++) labels[y * width + x] = FACE_CLASSES.u_lip
  return { labels, width, height }
}

const landmarks = landmarksFixture()
const map = mapFixture()

const alphaAt = (source: { pixels: Uint8ClampedArray; width: number }, x: number, y: number) =>
  source.pixels[(y * source.width + x) * 4 + 3]

describe('buildShadingSource', () => {
  it('lábios: realce segue o vermelhão e é zero na bochecha', () => {
    const source = buildShadingSource('labio-superior', landmarks, map)
    expect(alphaAt(source, 50, 66)).toBeGreaterThan(128) // dentro do lábio
    expect(alphaAt(source, 80, 40)).toBe(0) // bochecha
    expect(source.strength).toBeGreaterThan(0)
    expect(source.strength).toBeLessThanOrEqual(1)
  })

  it('malar: elipse com pico no centro e zero fora do raio', () => {
    const source = buildShadingSource('malar-direito', landmarks, map)
    expect(alphaAt(source, 35, 55)).toBe(255) // centro da âncora
    expect(alphaAt(source, 90, 10)).toBe(0) // longe
    // decaimento monotônico ao longo do eixo x
    const near = alphaAt(source, 38, 55)
    const far = alphaAt(source, 44, 55)
    expect(near).toBeGreaterThan(far)
  })

  it('pixels são brancos (só o alpha varia)', () => {
    const source = buildShadingSource('labio-superior', landmarks, map)
    const offset = (66 * source.width + 50) * 4
    expect(source.pixels[offset]).toBe(255)
    expect(source.pixels[offset + 1]).toBe(255)
    expect(source.pixels[offset + 2]).toBe(255)
  })
})
