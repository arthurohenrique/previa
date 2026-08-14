import { describe, expect, it } from 'vitest'
import { REGION_IDS, getRegion } from '@/lib/face/atlas'
import { amplitudeFor, clampFor, clampRadius, smoothingFor } from '@/lib/warp/clamps'
import type { Technique } from '@/lib/supabase/types'

const TECHNIQUES: Technique[] = ['filler', 'toxin', 'biostimulator', 'rhinomodeling']

describe('limites de amplitude', () => {
  it('nunca ultrapassa o teto da região, para nenhuma intensidade', () => {
    for (const regionId of REGION_IDS) {
      for (const technique of TECHNIQUES) {
        const limit = clampFor(regionId, technique).maxAmplitudeIpd
        for (let intensity = 0; intensity <= 1.0001; intensity += 0.05) {
          expect(amplitudeFor(intensity, regionId, technique)).toBeLessThanOrEqual(limit + 1e-12)
        }
      }
    }
  })

  it('trata intensidade fora da faixa como se estivesse no limite', () => {
    // A interface não deveria mandar isto, mas o clamp é de segurança e não
    // confia em quem chama.
    expect(amplitudeFor(5, 'malar', 'filler')).toBe(amplitudeFor(1, 'malar', 'filler'))
    expect(amplitudeFor(-3, 'malar', 'filler')).toBe(0)
  })

  it('cresce de forma monotônica com a intensidade', () => {
    let previous = -1
    for (let intensity = 0; intensity <= 1; intensity += 0.1) {
      const amplitude = amplitudeFor(intensity, 'chin', 'filler')
      expect(amplitude).toBeGreaterThanOrEqual(previous)
      previous = amplitude
    }
  })

  it('entrega um quarto do teto na metade do controle', () => {
    // A curva é quadrática de propósito: dá resolução fina na faixa usada e
    // torna o exagero um gesto deliberado.
    const half = amplitudeFor(0.5, 'chin', 'filler')
    const full = amplitudeFor(1, 'chin', 'filler')
    expect(half / full).toBeCloseTo(0.25, 10)
  })
})

describe('limite rígido da rinomodelação', () => {
  it('fica dentro de 5% da largura nasal', () => {
    // A largura nasal gira em torno de 0.62 DIP; 5% dela é ≈ 0.031 DIP.
    const limit = clampFor('nasal_dorsum', 'rhinomodeling').maxAmplitudeIpd
    expect(limit).toBeLessThanOrEqual(0.031)
    expect(amplitudeFor(1, 'nasal_dorsum', 'rhinomodeling')).toBeLessThanOrEqual(0.031)
  })

  it('usa máscara estreita', () => {
    const nose = clampFor('nasal_dorsum', 'rhinomodeling')
    const cheek = clampFor('malar', 'filler')
    expect(nose.maxRadiusIpd).toBeLessThan(cheek.maxRadiusIpd)
  })
})

describe('efeitos por técnica são distintos', () => {
  it('a toxina praticamente não desloca tecido', () => {
    const toxin = clampFor('glabella', 'toxin')
    const filler = clampFor('malar', 'filler')
    expect(toxin.maxAmplitudeIpd).toBeLessThan(filler.maxAmplitudeIpd / 5)
  })

  it('a toxina é a única com suavização relevante', () => {
    expect(smoothingFor(1, 'glabella', 'toxin')).toBeGreaterThan(0.5)
    expect(smoothingFor(1, 'malar', 'filler')).toBeLessThan(0.2)
  })

  it('o bioestimulador tem amplitude baixa e raio grande', () => {
    const bio = clampFor('malar', 'biostimulator')
    const filler = clampFor('malar', 'filler')
    expect(bio.maxAmplitudeIpd).toBeLessThan(filler.maxAmplitudeIpd)
    expect(bio.maxRadiusIpd).toBeGreaterThan(filler.maxRadiusIpd)
  })
})

describe('limites de raio', () => {
  it('prende o raio pedido dentro da faixa da região', () => {
    for (const regionId of REGION_IDS) {
      for (const technique of TECHNIQUES) {
        const limits = clampFor(regionId, technique)
        expect(clampRadius(0, regionId, technique)).toBe(limits.minRadiusIpd)
        expect(clampRadius(99, regionId, technique)).toBe(limits.maxRadiusIpd)
      }
    }
  })

  it('mantém o mínimo abaixo do máximo em toda combinação', () => {
    for (const regionId of REGION_IDS) {
      for (const technique of TECHNIQUES) {
        const limits = clampFor(regionId, technique)
        expect(limits.minRadiusIpd).toBeLessThan(limits.maxRadiusIpd)
      }
    }
  })
})

describe('coerência entre atlas e limites', () => {
  it('dá amplitude útil a toda técnica que a região declara', () => {
    for (const regionId of REGION_IDS) {
      const region = getRegion(regionId)
      for (const technique of region.techniques) {
        const limits = clampFor(regionId, technique)
        const usable =
          limits.maxAmplitudeIpd > 0 || limits.maxSmoothing > 0
        expect(usable).toBe(true)
      }
    }
  })
})
