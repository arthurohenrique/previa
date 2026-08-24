import { describe, expect, it } from 'vitest'
import type { Point2 } from '@/lib/quality'
import { FACE_CLASSES, type LabelMap } from '@/lib/segmentation/mask'
import {
  composeVertices,
  computeRegionField,
  falloff,
  REGION_DEFORM,
  sampleAlpha,
} from './field'
import { buildGridMesh, isBorderVertex } from './mesh'

/* ------------------------------------------------------------------ */
/* Fixtures: foto 1000×1000, máscara 200×200, interocular 0.2 (200px)  */
/* ------------------------------------------------------------------ */

function syntheticLandmarks(): Point2[] {
  const landmarks: Point2[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }))
  const set = (indices: readonly number[], x: number, y: number) => {
    for (const index of indices) landmarks[index] = { x, y }
  }
  set([468], 0.4, 0.4)
  set([473], 0.6, 0.4)
  set([13, 14], 0.5, 0.69) // linha da boca (eixo dos lábios)
  set([78, 191, 80, 81, 82, 312, 311, 310, 415, 308, 324, 318, 402, 317, 87, 178, 88, 95], 0.5, 0.69)
  set(REGION_DEFORM['malar-direito'].kind === 'translate' ? REGION_DEFORM['malar-direito'].centerIndices : [], 0.35, 0.55)
  set(REGION_DEFORM.mento.kind === 'translate' ? REGION_DEFORM.mento.centerIndices : [], 0.5, 0.85)
  return landmarks
}

function syntheticMap(): LabelMap {
  const width = 200
  const height = 200
  const labels = new Uint8Array(width * height)
  const fill = (x0: number, y0: number, x1: number, y1: number, classId: number) => {
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) labels[y * width + x] = classId
  }
  fill(60, 40, 160, 180, FACE_CLASSES.skin) // rosto: x 0.3–0.8, y 0.2–0.9
  fill(80, 128, 120, 138, FACE_CLASSES.u_lip) // y 0.64–0.69
  fill(80, 138, 120, 148, FACE_CLASSES.l_lip) // y 0.69–0.74
  return { labels, width, height }
}

const landmarks = syntheticLandmarks()
const map = syntheticMap()
const mesh = buildGridMesh(1000, 1000, 40)

/** Índice do vértice da grade mais próximo de (x, y) em px. */
function nearestVertex(x: number, y: number): number {
  let best = 0
  let bestDist = Infinity
  for (let i = 0; i < mesh.vertices.length / 2; i++) {
    const dist = Math.hypot(mesh.vertices[i * 2] - x, mesh.vertices[i * 2 + 1] - y)
    if (dist < bestDist) {
      bestDist = dist
      best = i
    }
  }
  return best
}

/* ------------------------------------------------------------------ */

describe('falloff', () => {
  it('1 no centro, 0 na borda, monotônica e suave na saída', () => {
    expect(falloff(0)).toBe(1)
    expect(falloff(1)).toBe(0)
    expect(falloff(2)).toBe(0)
    let previous = 1
    for (let t = 0.05; t <= 1; t += 0.05) {
      const value = falloff(t)
      expect(value).toBeLessThanOrEqual(previous)
      previous = value
    }
    expect(falloff(0.99)).toBeLessThan(0.002)
  })
})

describe('sampleAlpha', () => {
  it('interpola bilinearmente e normaliza para 0..1', () => {
    const alpha = new Uint8ClampedArray([0, 255, 0, 255]) // 2×2
    expect(sampleAlpha(alpha, 2, 2, 0, 0)).toBeCloseTo(0)
    expect(sampleAlpha(alpha, 2, 2, 1, 0)).toBeCloseTo(1)
    expect(sampleAlpha(alpha, 2, 2, 0.5, 0.5)).toBeCloseTo(0.5)
  })
})

describe('computeRegionField — modelo anatômico', () => {
  const upperField = computeRegionField(mesh, landmarks, 'labio-superior', map)
  const lowerField = computeRegionField(mesh, landmarks, 'labio-inferior', map)
  const malarField = computeRegionField(mesh, landmarks, 'malar-direito', map)

  it('lábio superior sobe (eversão), lábio inferior desce', () => {
    const upper = nearestVertex(500, 650)
    expect(upperField[upper * 2 + 1]).toBeLessThan(0)

    const lower = nearestVertex(500, 725)
    expect(lowerField[lower * 2 + 1]).toBeGreaterThan(0)
  })

  it('linha da boca (dentes) permanece praticamente imóvel', () => {
    const axisVertex = nearestVertex(500, 700)
    const magnitude = Math.hypot(
      lowerField[axisVertex * 2],
      lowerField[axisVertex * 2 + 1],
    )
    const lower = nearestVertex(500, 725)
    const lipMagnitude = Math.hypot(lowerField[lower * 2], lowerField[lower * 2 + 1])
    expect(magnitude).toBeLessThan(4)
    expect(magnitude).toBeLessThan(lipMagnitude)
  })

  it('pele fora da máscara do lábio não é arrastada pelo preenchimento labial', () => {
    // Bochecha: dentro do rosto, longe do lábio.
    const cheek = nearestVertex(700, 550)
    expect(upperField[cheek * 2]).toBe(0)
    expect(upperField[cheek * 2 + 1]).toBe(0)
  })

  it('malar faz lift (sobe) na pele e NADA se move no fundo', () => {
    const skinVertex = nearestVertex(425, 550)
    expect(malarField[skinVertex * 2 + 1]).toBeLessThan(0)

    // Dentro da elipse de influência, mas fora do rosto (fundo).
    const background = nearestVertex(275, 550)
    expect(malarField[background * 2]).toBe(0)
    expect(malarField[background * 2 + 1]).toBe(0)
  })

  it('respeita o teto de deslocamento da região', () => {
    for (const [region, field] of [
      ['labio-superior', upperField],
      ['labio-inferior', lowerField],
      ['malar-direito', malarField],
    ] as const) {
      const maxPx = REGION_DEFORM[region].maxDeltaFactor * 0.2 * 1000
      for (let i = 0; i < field.length; i += 2) {
        expect(Math.hypot(field[i], field[i + 1])).toBeLessThanOrEqual(maxPx + 1e-4)
      }
    }
  })

  it('borda da imagem fica fixa', () => {
    const field = computeRegionField(mesh, landmarks, 'mento', map)
    for (let i = 0; i < field.length / 2; i++) {
      if (isBorderVertex(mesh, i)) {
        expect(field[i * 2]).toBe(0)
        expect(field[i * 2 + 1]).toBe(0)
      }
    }
  })
})

describe('composeVertices', () => {
  it('base intacta com intensidade zero; soma escalada com intensidade', () => {
    const field = computeRegionField(mesh, landmarks, 'mento', map)
    const fields = new Map([['mento' as const, field]])
    const out = new Float32Array(mesh.vertices.length)

    composeVertices(mesh.vertices, fields, {}, out)
    expect(Array.from(out)).toEqual(Array.from(mesh.vertices))

    composeVertices(mesh.vertices, fields, { mento: 0.5 }, out)
    let changed = 0
    for (let i = 0; i < out.length; i++) {
      const delta = out[i] - mesh.vertices[i]
      expect(delta).toBeCloseTo(field[i] * 0.5, 3)
      if (delta !== 0) changed++
    }
    expect(changed).toBeGreaterThan(0)
  })
})
