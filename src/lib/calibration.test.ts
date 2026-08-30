import { describe, expect, it } from 'vitest'
import { REGIONS, type RegionId } from './anatomy'
import { anatomicalCeiling, CLINICAL_SCALE, volumeAt, volumeLabel } from './calibration'

const regionIds = Object.keys(REGIONS) as RegionId[]

describe('volumeAt', () => {
  it('é monotônico e limitado ao máximo da região', () => {
    for (const region of regionIds) {
      let previous = -1
      for (let t = 0; t <= 1.0001; t += 0.05) {
        const volume = volumeAt(region, t)
        expect(volume).toBeGreaterThanOrEqual(previous)
        expect(volume).toBeLessThanOrEqual(CLINICAL_SCALE[region].max + 1e-9)
        previous = volume
      }
      expect(volumeAt(region, 1)).toBeCloseTo(CLINICAL_SCALE[region].max)
      expect(volumeAt(region, 0)).toBe(0)
      expect(volumeAt(region, 2)).toBeCloseTo(CLINICAL_SCALE[region].max)
    }
  })
})

describe('volumeLabel', () => {
  it('formata em pt-BR com vírgula e a unidade', () => {
    expect(volumeLabel('mento', 1)).toBe('≈ 1,5 mL')
    expect(volumeLabel('labio-superior', 0.5)).toBe('≈ 0,3 mL')
    expect(volumeLabel('labio-superior', 0)).toBe('0 mL')
  })
})

describe('anatomicalCeiling', () => {
  it('toda região tem teto positivo vindo do template', () => {
    for (const region of regionIds) expect(anatomicalCeiling(region)).toBeGreaterThan(0)
  })
})
