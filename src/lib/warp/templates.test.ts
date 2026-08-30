import { describe, expect, it } from 'vitest'
import { REGIONS, type RegionId } from '@/lib/anatomy'
import { buildFaceFrame } from './frame'
import {
  buildControlPoints,
  clampDelta,
  isMouthOpen,
  lipProfile,
  LOWER_LIP_INNER,
  REGION_TEMPLATES,
  UPPER_LIP_OUTER,
} from './templates'
import {
  FIXTURE_HEIGHT,
  FIXTURE_INDICES,
  FIXTURE_WIDTH,
  syntheticFace,
} from './__fixtures__/face'

const landmarks = syntheticFace()
const frame = buildFaceFrame(landmarks, FIXTURE_WIDTH, FIXTURE_HEIGHT)
const regionIds = Object.keys(REGIONS) as RegionId[]

describe('REGION_TEMPLATES — definições', () => {
  it('existe template para toda região do mapa anatômico', () => {
    for (const region of regionIds) expect(REGION_TEMPLATES[region]).toBeDefined()
  })

  it('todos os índices são válidos e posicionados de propósito na fixture', () => {
    for (const region of regionIds) {
      const template = REGION_TEMPLATES[region]
      const indices = [
        ...template.moving(landmarks, frame).map((spec) => spec.index),
        ...template.pins,
      ]
      for (const index of indices) {
        expect(index).toBeGreaterThanOrEqual(0)
        expect(index).toBeLessThan(478)
        expect(FIXTURE_INDICES.has(index), `índice ${index} em ${region}`).toBe(true)
      }
    }
  })

  it('tetos são positivos e nenhum mover os ultrapassa depois do clamp', () => {
    for (const region of regionIds) {
      const template = REGION_TEMPLATES[region]
      expect(template.maxDeltaFactor).toBeGreaterThan(0)
      for (const control of buildControlPoints(region, landmarks, frame)) {
        const magnitude = Math.hypot(control.q.x - control.p.x, control.q.y - control.p.y)
        expect(magnitude / frame.scale).toBeLessThanOrEqual(template.maxDeltaFactor + 1e-9)
      }
    }
  })

  it('nenhum ponto de controle repete a posição de outro', () => {
    for (const region of regionIds) {
      const seen = new Set<string>()
      for (const control of buildControlPoints(region, landmarks, frame)) {
        const key = `${control.p.x.toFixed(3)},${control.p.y.toFixed(3)}`
        expect(seen.has(key), `${region}: controle duplicado em ${key}`).toBe(false)
        seen.add(key)
      }
    }
  })
})

describe('lábios', () => {
  const upper = REGION_TEMPLATES['labio-superior'].moving(landmarks, frame)
  const lower = REGION_TEMPLATES['labio-inferior'].moving(landmarks, frame)
  const magnitude = (delta: { x: number; y: number }) => Math.hypot(delta.x, delta.y)

  it('perfil: 0 nas comissuras, 1 no centro', () => {
    expect(lipProfile(0)).toBeCloseTo(0)
    expect(lipProfile(1)).toBeCloseTo(0)
    expect(lipProfile(0.5)).toBeCloseTo(1)
  })

  it('comissuras não se movem; o centro é o máximo', () => {
    const byIndex = new Map(upper.map((spec) => [spec.index, spec.delta]))
    expect(magnitude(byIndex.get(61)!)).toBeLessThan(1e-6)
    expect(magnitude(byIndex.get(291)!)).toBeLessThan(1e-6)
    const centerMagnitude = magnitude(byIndex.get(0)!)
    for (const spec of upper) {
      if (spec.index === 37 || spec.index === 267) continue // arco do cupido sobe a mais
      expect(magnitude(spec.delta)).toBeLessThanOrEqual(centerMagnitude + 1e-9)
    }
  })

  it('lábio superior avança para cima na normal; inferior para baixo', () => {
    const upperCenter = upper.find((spec) => spec.index === 0)!
    expect(upperCenter.delta.x).toBeCloseTo(0, 6)
    expect(upperCenter.delta.y).toBeLessThan(0)
    const lowerCenter = lower.find((spec) => spec.index === 17)!
    expect(lowerCenter.delta.x).toBeCloseTo(0, 6)
    expect(lowerCenter.delta.y).toBeGreaterThan(0)
  })

  it('arco do cupido sobe mais que os vizinhos', () => {
    const peak = upper.find((spec) => spec.index === 37)!
    const neighbour = upper.find((spec) => spec.index === 39)!
    expect(-peak.delta.y).toBeGreaterThan(-neighbour.delta.y)
  })

  it('linha molhada e base do nariz são pinos do lábio superior', () => {
    const pins = REGION_TEMPLATES['labio-superior'].pins
    expect(pins).toContain(13)
    expect(pins).toContain(2)
    // Comissuras são compartilhadas com o contorno inferior (delta 0 dos dois lados).
    for (const index of UPPER_LIP_OUTER) {
      if (index === 61 || index === 291) continue
      expect(pins).not.toContain(index)
    }
  })

  it('boca aberta reduz o ganho pela metade', () => {
    expect(isMouthOpen(landmarks, frame)).toBe(false)
    const open = landmarks.slice()
    for (const index of LOWER_LIP_INNER) {
      open[index] = { x: open[index].x, y: open[index].y + (0.1 * frame.scale) / FIXTURE_HEIGHT }
    }
    expect(isMouthOpen(open, frame)).toBe(true)
    const reduced = REGION_TEMPLATES['labio-superior'].moving(open, frame)
    const before = magnitude(upper.find((spec) => spec.index === 0)!.delta)
    const after = magnitude(reduced.find((spec) => spec.index === 0)!.delta)
    expect(after).toBeCloseTo(before / 2)
  })
})

describe('malar', () => {
  it('direito e esquerdo são espelhados', () => {
    const right = buildControlPoints('malar-direito', landmarks, frame)
    const left = buildControlPoints('malar-esquerdo', landmarks, frame)
    expect(left).toHaveLength(right.length)
    for (const control of right) {
      const mirrored = left.find(
        (candidate) =>
          Math.abs(candidate.p.x - (2 * 384 - control.p.x)) < 1e-6 &&
          Math.abs(candidate.p.y - control.p.y) < 1e-6,
      )
      expect(mirrored, `sem espelho para (${control.p.x}, ${control.p.y})`).toBeDefined()
      expect(mirrored!.q.x).toBeCloseTo(2 * 384 - control.q.x)
      expect(mirrored!.q.y).toBeCloseTo(control.q.y)
    }
  })

  it('lado direito do paciente se afasta do nariz (x negativo na imagem)', () => {
    const specs = REGION_TEMPLATES['malar-direito'].moving(landmarks, frame)
    const apex = specs.find((spec) => spec.index === 50)!
    expect(apex.delta.x).toBeLessThan(0)
    expect(apex.delta.y).toBeLessThan(0)
  })
})

describe('mento', () => {
  it('ponto mentoniano desce; contorno acompanha com menos', () => {
    const specs = REGION_TEMPLATES.mento.moving(landmarks, frame)
    const chin = specs.find((spec) => spec.index === 152)!
    const side = specs.find((spec) => spec.index === 149)!
    expect(chin.delta.y).toBeGreaterThan(0)
    expect(side.delta.y).toBeGreaterThan(0)
    expect(side.delta.y).toBeLessThan(chin.delta.y)
  })
})

describe('clampDelta', () => {
  it('mantém abaixo do teto e limita acima', () => {
    expect(clampDelta({ x: 0.01, y: 0 }, 0.05)).toEqual({ x: 0.01, y: 0 })
    const clamped = clampDelta({ x: 0.3, y: 0.4 }, 0.05)
    expect(Math.hypot(clamped.x, clamped.y)).toBeCloseTo(0.05)
    expect(clamped.x / clamped.y).toBeCloseTo(0.75)
  })
})
