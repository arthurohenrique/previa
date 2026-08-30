import { describe, expect, it } from 'vitest'
import type { Point2 } from '@/lib/quality'
import { mlsSimilarity, rasterizeMls, type ControlPoint } from './mls'

/** Gerador determinístico (LCG) para fixtures reproduzíveis. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function randomControls(count: number, seed: number, maxDelta: number): ControlPoint[] {
  const random = makeRandom(seed)
  return Array.from({ length: count }, () => {
    const p = { x: 50 + random() * 900, y: 50 + random() * 900 }
    return {
      p,
      q: { x: p.x + (random() - 0.5) * 2 * maxDelta, y: p.y + (random() - 0.5) * 2 * maxDelta },
    }
  })
}

const controls = randomControls(12, 7, 20)

describe('mlsSimilarity', () => {
  it('interpola exatamente os controles: f(p_i) = q_i', () => {
    for (const control of controls) {
      const f = mlsSimilarity(control.p, controls)
      expect(f.x).toBeCloseTo(control.q.x, 6)
      expect(f.y).toBeCloseTo(control.q.y, 6)
    }
  })

  it('pinos (q = p) ficam parados mesmo com movers ao redor', () => {
    const pinned: ControlPoint[] = [
      ...controls,
      { p: { x: 500, y: 500 }, q: { x: 500, y: 500 } },
    ]
    const f = mlsSimilarity({ x: 500, y: 500 }, pinned)
    expect(f.x).toBeCloseTo(500, 6)
    expect(f.y).toBeCloseTo(500, 6)
  })

  it('identidade quando nenhum controle se move', () => {
    const still = controls.map((control) => ({ p: control.p, q: control.p }))
    const random = makeRandom(3)
    for (let i = 0; i < 50; i++) {
      const v = { x: random() * 1000, y: random() * 1000 }
      const f = mlsSimilarity(v, still)
      expect(f.x).toBeCloseTo(v.x, 8)
      expect(f.y).toBeCloseTo(v.y, 8)
    }
  })

  it('é linear na intensidade: f(v; t) − v = t · (f(v; 1) − v)', () => {
    const at = (t: number): ControlPoint[] =>
      controls.map((control) => ({
        p: control.p,
        q: {
          x: control.p.x + t * (control.q.x - control.p.x),
          y: control.p.y + t * (control.q.y - control.p.y),
        },
      }))
    const random = makeRandom(11)
    for (let i = 0; i < 30; i++) {
      const v = { x: random() * 1000, y: random() * 1000 }
      const full = mlsSimilarity(v, at(1))
      for (const t of [0.25, 0.5, 0.8]) {
        const partial = mlsSimilarity(v, at(t))
        expect(Math.abs(partial.x - v.x - t * (full.x - v.x))).toBeLessThan(1e-9)
        expect(Math.abs(partial.y - v.y - t * (full.y - v.y))).toBeLessThan(1e-9)
      }
    }
  })

  it('translação global de todos os controles → campo constante', () => {
    const shifted = controls.map((control) => ({
      p: control.p,
      q: { x: control.p.x + 7, y: control.p.y - 3 },
    }))
    const f = mlsSimilarity({ x: 321, y: 654 }, shifted)
    expect(f.x).toBeCloseTo(328, 8)
    expect(f.y).toBeCloseTo(651, 8)
  })

  it('influência é local: longe do mover, entre pinos, quase nada se move', () => {
    const local: ControlPoint[] = [
      { p: { x: 500, y: 500 }, q: { x: 500, y: 480 } }, // mover: 20px para cima
      { p: { x: 450, y: 500 }, q: { x: 450, y: 500 } },
      { p: { x: 550, y: 500 }, q: { x: 550, y: 500 } },
      { p: { x: 500, y: 440 }, q: { x: 500, y: 440 } },
      { p: { x: 500, y: 560 }, q: { x: 500, y: 560 } },
      { p: { x: 0, y: 0 }, q: { x: 0, y: 0 } },
      { p: { x: 1000, y: 0 }, q: { x: 1000, y: 0 } },
      { p: { x: 0, y: 1000 }, q: { x: 0, y: 1000 } },
      { p: { x: 1000, y: 1000 }, q: { x: 1000, y: 1000 } },
    ]
    const near = mlsSimilarity({ x: 500, y: 490 }, local)
    const far = mlsSimilarity({ x: 800, y: 800 }, local)
    expect(Math.abs(near.y - 490)).toBeGreaterThan(5)
    expect(Math.hypot(far.x - 800, far.y - 800)).toBeLessThan(2.5)
  })

  it('sem controles é a identidade', () => {
    const f = mlsSimilarity({ x: 1, y: 2 }, [])
    expect(f).toEqual({ x: 1, y: 2 })
  })
})

describe('rasterizeMls', () => {
  const width = 64
  const height = 64
  const out = new Float32Array(width * height * 2)
  rasterizeMls(controls, width, height, 1000, 1000, 1.5, out)

  it('cada célula guarda (f(v) − v) normalizado pela foto', () => {
    const i = 20
    const j = 33
    const v: Point2 = { x: ((i + 0.5) / width) * 1000, y: ((j + 0.5) / height) * 1000 }
    const f = mlsSimilarity(v, controls, 1.5)
    const offset = (j * width + i) * 2
    expect(out[offset]).toBeCloseTo((f.x - v.x) / 1000, 5)
    expect(out[offset + 1]).toBeCloseTo((f.y - v.y) / 1000, 5)
  })

  it('campo é suave: células vizinhas (15px) diferem menos que o maior delta', () => {
    let worst = 0
    for (let j = 0; j < height; j++) {
      for (let i = 0; i + 1 < width; i++) {
        const a = (j * width + i) * 2
        const b = a + 2
        worst = Math.max(worst, Math.hypot(out[b] - out[a], out[b + 1] - out[a + 1]) * 1000)
      }
    }
    expect(worst).toBeLessThan(20)
  })

  it('rejeita buffer pequeno e zera sem controles', () => {
    expect(() => rasterizeMls(controls, 8, 8, 100, 100, 1, new Float32Array(10))).toThrow()
    const empty = new Float32Array(8 * 8 * 2).fill(1)
    rasterizeMls([], 8, 8, 100, 100, 1, empty)
    expect(empty.every((value) => value === 0)).toBe(true)
  })
})
