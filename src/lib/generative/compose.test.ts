import { describe, expect, it } from 'vitest'
import {
  alphaBBox,
  compositeCrop,
  rgbaToTensor,
  squareCrop,
  tensorToRgba,
} from './compose'

describe('alphaBBox', () => {
  it('acha a caixa dos pixels ativos e ignora ruído abaixo do limiar', () => {
    const width = 10
    const height = 10
    const alpha = new Uint8ClampedArray(width * height)
    alpha[3 * width + 4] = 255
    alpha[6 * width + 7] = 200
    alpha[0] = 10 // abaixo do limiar
    expect(alphaBBox(alpha, width, height)).toEqual({ x0: 4, y0: 3, x1: 7, y1: 6 })
  })

  it('vazio devolve null', () => {
    expect(alphaBBox(new Uint8ClampedArray(25), 5, 5)).toBeNull()
  })
})

describe('squareCrop', () => {
  it('expande pela margem, respeita mínimo e vira quadrado', () => {
    const crop = squareCrop({ x0: 100, y0: 100, x1: 139, y1: 119 }, 1000, 800)
    expect(crop.size).toBe(160) // mínimo domina (40×1.8=72 < 160)
    // centrado na bbox
    expect(crop.x + crop.size / 2).toBeCloseTo(119.5, -1)
  })

  it('preso à borda da imagem sem sair dela', () => {
    const crop = squareCrop({ x0: 0, y0: 0, x1: 30, y1: 30 }, 500, 500)
    expect(crop.x).toBe(0)
    expect(crop.y).toBe(0)
    expect(crop.x + crop.size).toBeLessThanOrEqual(500)
  })

  it('nunca maior que a imagem', () => {
    const crop = squareCrop({ x0: 0, y0: 0, x1: 400, y1: 400 }, 300, 300)
    expect(crop.size).toBe(300)
  })
})

describe('compositeCrop', () => {
  it('alpha 255 substitui, alpha 0 preserva, meio-termo mistura; fora do crop intacto', () => {
    const imageWidth = 8
    const base = new Uint8ClampedArray(8 * 8 * 4).fill(100)
    const crop = { x: 2, y: 2, size: 2 }
    const generated = new Uint8ClampedArray(2 * 2 * 4).fill(200)
    const feather = new Uint8ClampedArray([255, 0, 128, 255])

    compositeCrop(base, imageWidth, generated, feather, crop)

    const px = (x: number, y: number) => base[(y * imageWidth + x) * 4]
    expect(px(2, 2)).toBe(200) // substituído
    expect(px(3, 2)).toBe(100) // preservado
    expect(px(2, 3)).toBeGreaterThan(140) // mistura ~150
    expect(px(2, 3)).toBeLessThan(160)
    expect(px(0, 0)).toBe(100) // fora do crop
    expect(px(5, 5)).toBe(100)
  })
})

describe('conversão tensor', () => {
  it('rgba→tensor→rgba é identidade (dentro do arredondamento)', () => {
    const size = 2
    const rgba = new Uint8ClampedArray([
      0, 128, 255, 255, 10, 20, 30, 255,
      200, 100, 50, 255, 255, 255, 0, 255,
    ])
    const roundTrip = tensorToRgba(rgbaToTensor(rgba, size), size)
    for (let i = 0; i < rgba.length; i++) {
      if (i % 4 === 3) {
        expect(roundTrip[i]).toBe(255)
      } else {
        expect(Math.abs(roundTrip[i] - rgba[i])).toBeLessThanOrEqual(1)
      }
    }
  })

  it('tensor fora de [-1,1] é grampeado', () => {
    const tensor = new Float32Array([5, -5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    const rgba = tensorToRgba(tensor, 2)
    expect(rgba[0]).toBe(255)
    expect(rgba[4]).toBe(0)
  })
})
