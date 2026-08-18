import { describe, expect, it } from 'vitest'
import {
  anchorIndexFor,
  ATLAS,
  buildRegionInstances,
  centroidOf,
  convexHull,
  getRegion,
  REGION_IDS,
} from '@/lib/face/atlas'
import { polygonArea } from '@/lib/face/hitTest'
import type { Landmark } from '@/lib/face/types'

/** Rosto sintético: cada landmark num ponto distinto e determinístico. */
function syntheticFace(): Landmark[] {
  return Array.from({ length: 478 }, (_, index) => ({
    x: 0.5 + 0.28 * Math.cos((index * 2 * Math.PI) / 478),
    y: 0.5 + 0.36 * Math.sin((index * 2 * Math.PI) / 478),
    z: 0,
  }))
}

describe('fecho convexo', () => {
  it('devolve o retângulo e descarta o ponto interno', () => {
    const hull = convexHull([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
      { x: 0.5, y: 0.5 },
    ])

    expect(hull).toHaveLength(4)
    expect(polygonArea(hull)).toBeCloseTo(1, 10)
  })

  it('não depende da ordem de entrada', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
    ]
    const forward = polygonArea(convexHull(points))
    const backward = polygonArea(convexHull([...points].reverse()))

    // É exatamente por isto que o atlas usa fecho convexo e não lista ordenada:
    // um índice fora de ordem não pode produzir polígono auto-intersectado.
    expect(forward).toBeCloseTo(backward, 12)
    expect(forward).toBeCloseTo(4, 12)
  })

  it('devolve a entrada quando não há três pontos', () => {
    expect(convexHull([{ x: 0, y: 0 }])).toHaveLength(1)
    expect(convexHull([])).toHaveLength(0)
  })
})

describe('atlas clínico', () => {
  it('cobre todas as regiões exigidas', () => {
    const required = [
      'glabella',
      'frontal',
      'periorbital',
      'malar',
      'nasolabial_fold',
      'upper_lip',
      'lower_lip',
      'chin',
      'jawline',
    ] as const

    for (const id of required) {
      expect(REGION_IDS).toContain(id)
      expect(() => getRegion(id)).not.toThrow()
    }
  })

  it('mantém índices dentro da faixa dos 478 landmarks', () => {
    for (const region of ATLAS) {
      for (const index of [...region.right, ...region.left]) {
        expect(index).toBeGreaterThanOrEqual(0)
        expect(index).toBeLessThan(478)
      }
      expect(region.anchorRight).toBeLessThan(478)
      expect(region.anchorLeft).toBeLessThan(478)
    }
  })

  it('dá aos lados de uma região simétrica conjuntos distintos e do mesmo tamanho', () => {
    for (const region of ATLAS) {
      if (!region.bilateral) {
        expect(region.left).toHaveLength(0)
        continue
      }
      expect(region.left).toHaveLength(region.right.length)
      expect(region.left).not.toEqual(region.right)
      expect(region.anchorLeft).not.toBe(region.anchorRight)
    }
  })

  it('declara ao menos uma técnica por região', () => {
    for (const region of ATLAS) {
      expect(region.techniques.length).toBeGreaterThan(0)
    }
  })

  it('produz uma instância por lado, com chave única', () => {
    const instances = buildRegionInstances(syntheticFace())
    const keys = instances.map((instance) => instance.key)

    expect(new Set(keys).size).toBe(keys.length)

    const bilateral = ATLAS.filter((region) => region.bilateral).length
    expect(instances).toHaveLength(ATLAS.length + bilateral)
  })

  it('dá a cada instância um polígono com área e um centróide dentro dele', () => {
    for (const instance of buildRegionInstances(syntheticFace())) {
      expect(instance.polygon.length).toBeGreaterThanOrEqual(3)
      expect(polygonArea(instance.polygon)).toBeGreaterThan(0)

      const centroid = centroidOf(instance.polygon)
      expect(centroid.x).toBeCloseTo(instance.centroid.x, 12)
      expect(centroid.y).toBeCloseTo(instance.centroid.y, 12)
    }
  })

  it('escolhe a âncora certa para cada lado', () => {
    const periorbital = getRegion('periorbital')
    expect(anchorIndexFor(periorbital, 'left')).toBe(periorbital.anchorLeft)
    expect(anchorIndexFor(periorbital, 'right')).toBe(periorbital.anchorRight)
    expect(anchorIndexFor(getRegion('glabella'), 'center')).toBe(
      getRegion('glabella').anchorRight,
    )
  })

  it('numera a cascata de baixo para cima, sem empate', () => {
    const orders = ATLAS.map((region) => region.cascadeOrder)
    expect(new Set(orders).size).toBe(orders.length)
    // O mento abre a cascata; a testa fecha.
    expect(getRegion('chin').cascadeOrder).toBeLessThan(getRegion('frontal').cascadeOrder)
  })
})
