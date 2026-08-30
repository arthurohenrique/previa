import { describe, expect, it } from 'vitest'
import type { RegionId } from '@/lib/anatomy'
import { composeFields } from './compose'
import type { RegionField } from './field'

function field(disp: number[], photo: number[]): RegionField {
  return { width: disp.length / 2, height: 1, disp: new Float32Array(disp), photo: new Float32Array(photo) }
}

describe('composeFields', () => {
  const fields = new Map<RegionId, RegionField>([
    ['labio-superior', field([1, 2, 3, 4], [0.1, 0, 1, 0, 0, 0, 0, 0])],
    ['mento', field([10, 20, 30, 40], [0, 0.2, 0, 0, -0.1, 0, 0, 0])],
  ])

  it('sem intensidade tudo é zero', () => {
    const disp = new Float32Array(4).fill(9)
    const photo = new Float32Array(8).fill(9)
    composeFields(fields, {}, disp, photo)
    expect(Array.from(disp)).toEqual([0, 0, 0, 0])
    expect(Array.from(photo)).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
  })

  it('soma ponderada pelas intensidades nos dois buffers', () => {
    const disp = new Float32Array(4)
    const photo = new Float32Array(8)
    composeFields(fields, { 'labio-superior': 0.5, mento: 0.1 }, disp, photo)
    expect(Array.from(disp)).toEqual([1.5, 3, 4.5, 6])
    expect(photo[0]).toBeCloseTo(0.05)
    expect(photo[1]).toBeCloseTo(0.02)
    expect(photo[2]).toBeCloseTo(0.5)
    expect(photo[4]).toBeCloseTo(-0.01)
  })

  it('intensidade zero ou negativa é ignorada', () => {
    const disp = new Float32Array(4)
    const photo = new Float32Array(8)
    composeFields(fields, { 'labio-superior': 0, mento: -1 }, disp, photo)
    expect(disp.every((v) => v === 0)).toBe(true)
    expect(photo.every((v) => v === 0)).toBe(true)
  })

  it('rejeita campos com dimensão diferente', () => {
    const mixed = new Map<RegionId, RegionField>([['mento', field([1, 2], [0, 0, 0, 0])]])
    expect(() => composeFields(mixed, { mento: 1 }, new Float32Array(4), new Float32Array(8))).toThrow()
  })
})
