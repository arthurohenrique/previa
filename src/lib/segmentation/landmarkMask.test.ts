import { describe, expect, it } from 'vitest'
import { labelsFromCoverage, polygonFromLandmarks, REGION_POLYGONS } from './landmarkMask'
import { FACE_CLASSES } from './mask'

describe('REGION_POLYGONS', () => {
  it('todos os índices existem no espaço dos 478 landmarks', () => {
    for (const region of REGION_POLYGONS) {
      expect(region.indices.length).toBeGreaterThanOrEqual(3)
      for (const index of region.indices) {
        expect(index).toBeGreaterThanOrEqual(0)
        expect(index).toBeLessThan(478)
      }
    }
  })

  it('cobre as regiões mínimas da Fase 3', () => {
    const ids = REGION_POLYGONS.map((r) => r.classId)
    expect(ids).toContain(FACE_CLASSES.skin)
    expect(ids).toContain(FACE_CLASSES.u_lip)
    expect(ids).toContain(FACE_CLASSES.l_lip)
  })

  it('ids de classe cabem em um byte do labelmap', () => {
    for (const region of REGION_POLYGONS) {
      expect(region.classId).toBeGreaterThan(0)
      expect(region.classId).toBeLessThan(256)
    }
  })
})

describe('labelsFromCoverage', () => {
  it('borda anti-aliased nunca vira classe intermediária; a última classe vence', () => {
    const skin = new Uint8ClampedArray([255, 255, 255, 255])
    const lip = new Uint8ClampedArray([0, 60, 128, 255]) // borda parcial
    const labels = labelsFromCoverage(
      [
        { classId: FACE_CLASSES.skin, coverage: skin },
        { classId: FACE_CLASSES.u_lip, coverage: lip },
      ],
      4,
    )
    expect(Array.from(labels)).toEqual([
      FACE_CLASSES.skin,
      FACE_CLASSES.skin,
      FACE_CLASSES.u_lip,
      FACE_CLASSES.u_lip,
    ])
  })
})

describe('polygonFromLandmarks', () => {
  it('escala coordenadas normalizadas para a resolução pedida', () => {
    const landmarks = Array.from({ length: 478 }, (_, i) => ({
      x: (i % 10) / 10,
      y: Math.floor(i / 10) / 48,
    }))
    const polygon = polygonFromLandmarks(landmarks, [0, 11, 22], 100, 200)
    expect(polygon).toHaveLength(3)
    expect(polygon[0]).toEqual([0, 0])
    expect(polygon[1][0]).toBeCloseTo(10)
    expect(polygon[2][0]).toBeCloseTo(20)
    expect(polygon[1][1]).toBeCloseTo((1 / 48) * 200)
  })
})
