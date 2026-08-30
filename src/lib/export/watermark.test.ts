import { describe, expect, it } from 'vitest'
import { footerText, WATERMARK_TEXT, watermarkLayout } from './watermark'

describe('watermarkLayout', () => {
  it('cobre pelo menos 20% da diagonal, centrada, em qualquer proporção', () => {
    for (const [width, height] of [
      [4096, 3072],
      [3000, 4000],
      [720, 1280],
      [200, 200],
    ]) {
      const layout = watermarkLayout(width, height)
      const diagonal = Math.hypot(width, height)
      expect(layout.estimatedWidth).toBeGreaterThanOrEqual(0.2 * diagonal)
      expect(layout.centerX).toBe(width / 2)
      expect(layout.centerY).toBe(height / 2)
      expect(layout.alpha).toBeGreaterThan(0.2)
      expect(layout.alpha).toBeLessThan(0.6)
    }
  })

  it('a diagonal sobe da esquerda para a direita (ângulo negativo, |ângulo| < 90°)', () => {
    const layout = watermarkLayout(1600, 900)
    expect(layout.angle).toBeLessThan(0)
    expect(layout.angle).toBeGreaterThan(-Math.PI / 2)
    expect(Math.abs(layout.angle)).toBeCloseTo(Math.atan2(900, 1600))
  })

  it('fonte nunca abaixo do mínimo legível', () => {
    expect(watermarkLayout(50, 50).fontSize).toBeGreaterThanOrEqual(12)
    expect(watermarkLayout(50, 50).footer.fontSize).toBeGreaterThanOrEqual(10)
  })
})

describe('footerText', () => {
  it('traz a origem, o aviso e a data em pt-BR', () => {
    const text = footerText(new Date(2026, 7, 30))
    expect(text).toContain('Prévia')
    expect(text).toContain('simulação ilustrativa')
    expect(text).toContain('30/08/2026')
  })
})

describe('WATERMARK_TEXT', () => {
  it('é o texto exigido pela restrição nº 5', () => {
    expect(WATERMARK_TEXT).toBe('SIMULAÇÃO ILUSTRATIVA')
  })
})
