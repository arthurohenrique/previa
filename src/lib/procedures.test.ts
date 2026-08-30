import { describe, expect, it } from 'vitest'
import { REGIONS, type RegionId } from './anatomy'
import {
  applyProcedure,
  PROCEDURE_ORDER,
  PROCEDURES,
  procedureIntensity,
  procedureLines,
  procedureVolumeLabel,
  regionToProcedure,
} from './procedures'

describe('definições', () => {
  it('toda região do mapa anatômico pertence a exatamente um procedimento (filtro → lábios)', () => {
    for (const region of Object.keys(REGIONS) as RegionId[]) {
      const owners = PROCEDURE_ORDER.filter((id) => PROCEDURES[id].ratio[region] !== undefined)
      if (region === 'filtro') {
        expect(owners).toHaveLength(0)
        expect(regionToProcedure(region)).toBe('labios')
      } else {
        expect(owners, region).toHaveLength(1)
        expect(regionToProcedure(region)).toBe(owners[0])
      }
    }
  })

  it('ratios estão em (0, 1]', () => {
    for (const id of PROCEDURE_ORDER) {
      for (const ratio of Object.values(PROCEDURES[id].ratio)) {
        expect(ratio).toBeGreaterThan(0)
        expect(ratio).toBeLessThanOrEqual(1)
      }
    }
  })
})

describe('applyProcedure / procedureIntensity', () => {
  it('distribui pela proporção e lê de volta a mesma intensidade', () => {
    const map = applyProcedure('labios', 0.8, {})
    expect(map['labio-superior']).toBeCloseTo(0.72)
    expect(map['labio-inferior']).toBeCloseTo(0.8)
    expect(procedureIntensity('labios', map)).toBeCloseTo(0.8)
  })

  it('não mexe nas regiões de outros procedimentos e satura em [0, 1]', () => {
    const base = applyProcedure('mento', 0.5, {})
    const map = applyProcedure('malar', 2, base)
    expect(map.mento).toBeCloseTo(0.5)
    expect(map['malar-direito']).toBe(1)
    expect(procedureIntensity('malar', applyProcedure('malar', -1, {}))).toBe(0)
  })
})

describe('procedureVolumeLabel', () => {
  it('par simétrico informa por lado; lábios somam as duas regiões', () => {
    expect(procedureVolumeLabel('malar', 1)).toBe('≈ 1,0 mL por lado')
    expect(procedureVolumeLabel('labios', 1)).toBe('≈ 1,0 mL') // 0,9·0,5 ≈ 0,5 + 0,5
    expect(procedureVolumeLabel('mento', 0)).toBe('0 mL')
  })
})

describe('procedureLines', () => {
  it('uma linha por procedimento ativo, na ordem da UI', () => {
    const map = applyProcedure('olheira', 0.6, applyProcedure('labios', 0.5, {}))
    const lines = procedureLines(map)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('labial')
    expect(lines[1]).toContain('olheira')
    expect(procedureLines({})).toHaveLength(0)
  })
})
