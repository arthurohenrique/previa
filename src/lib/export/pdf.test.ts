import { describe, expect, it } from 'vitest'
import { fitImage, pageBoxes, pdfSafe } from './pdf'

describe('pdfSafe', () => {
  it('troca caracteres fora do WinAnsi por ASCII', () => {
    expect(pdfSafe('Lábio: ≈ 0,5 mL • x')).toBe('Lábio: ~ 0,5 mL - x')
  })
})

describe('pageBoxes', () => {
  it('duas caixas iguais, lado a lado, dentro da A4 paisagem', () => {
    const { before, after } = pageBoxes()
    expect(before.width).toBeCloseTo(after.width)
    expect(before.y).toBe(after.y)
    expect(after.x).toBeGreaterThan(before.x + before.width)
    expect(after.x + after.width).toBeLessThanOrEqual(297)
    expect(before.y + before.height).toBeLessThan(210)
  })
})

describe('fitImage', () => {
  it('preserva a proporção e centraliza na caixa', () => {
    const box = { x: 10, y: 20, width: 100, height: 100 }
    const wide = fitImage(2000, 1000, box)
    expect(wide.width).toBeCloseTo(100)
    expect(wide.height).toBeCloseTo(50)
    expect(wide.y).toBeCloseTo(45)
    const tall = fitImage(1000, 2000, box)
    expect(tall.height).toBeCloseTo(100)
    expect(tall.x).toBeCloseTo(35)
  })
})
