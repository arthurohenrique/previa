import { describe, expect, it } from 'vitest'
import { REGIONS, type RegionId } from '@/lib/anatomy'
import {
  buildRegionField,
  fieldDimensions,
  invertControls,
  MAX_STRAIN,
  maxStrain,
  sourceOffsetAt,
  type RegionField,
} from './field'
import { buildFaceFrame } from './frame'
import type { LumaImage } from '@/lib/photometric/luma'
import { SHADE_MAX, SHADE_MIN } from '@/lib/photometric/shade'
import { buildControlPoints } from './templates'
import { FIXTURE_HEIGHT, FIXTURE_WIDTH, syntheticFace, syntheticMap } from './__fixtures__/face'

const landmarks = syntheticFace()
const map = syntheticMap()
const frame = buildFaceFrame(landmarks, FIXTURE_WIDTH, FIXTURE_HEIGHT)
const MAX_SIDE = 256 // perfil baixo: o caso mais grosseiro

const fields = new Map<RegionId, RegionField>()
for (const region of Object.keys(REGIONS) as RegionId[]) {
  fields.set(region, buildRegionField(region, landmarks, map, FIXTURE_WIDTH, FIXTURE_HEIGHT, MAX_SIDE))
}

const atPx = (field: RegionField, x: number, y: number) =>
  sourceOffsetAt(field, FIXTURE_WIDTH, FIXTURE_HEIGHT, { x: x / FIXTURE_WIDTH, y: y / FIXTURE_HEIGHT })
const atLandmark = (field: RegionField, index: number) =>
  sourceOffsetAt(field, FIXTURE_WIDTH, FIXTURE_HEIGHT, landmarks[index])
const landmarkPx = (index: number) => ({
  x: landmarks[index].x * FIXTURE_WIDTH,
  y: landmarks[index].y * FIXTURE_HEIGHT,
})

describe('fieldDimensions', () => {
  it('lado maior = maxSide, proporção da foto preservada', () => {
    expect(fieldDimensions(768, 1024, 256)).toEqual({ width: 192, height: 256 })
    expect(fieldDimensions(1024, 768, 512)).toEqual({ width: 512, height: 384 })
  })
})

describe('campo inverso', () => {
  it('invertControls troca origem e destino', () => {
    const inverted = invertControls([{ p: { x: 1, y: 2 }, q: { x: 3, y: 4 } }])
    expect(inverted).toEqual([{ p: { x: 3, y: 4 }, q: { x: 1, y: 2 } }])
  })

  it('no destino de cada mover, a cor vem da posição original (erro < 1px)', () => {
    for (const region of ['labio-superior', 'labio-inferior', 'mento', 'malar-direito'] as const) {
      const field = fields.get(region)!
      for (const control of buildControlPoints(region, landmarks, frame)) {
        const moved = Math.hypot(control.q.x - control.p.x, control.q.y - control.p.y)
        if (moved < 1) continue
        const offset = atPx(field, control.q.x, control.q.y)
        expect(
          Math.hypot(control.q.x + offset.x - control.p.x, control.q.y + offset.y - control.p.y),
          `${region} controle em (${control.p.x}, ${control.p.y})`,
        ).toBeLessThan(1)
      }
    }
  })
})

describe('lábio superior', () => {
  const field = fields.get('labio-superior')!

  it('a borda avançada mostra o vermelhão original (vem de baixo); linha molhada e nariz ficam', () => {
    const border = landmarkPx(0)
    const offset = atPx(field, border.x, border.y - 0.035 * frame.scale)
    expect(offset.y).toBeGreaterThan(0.035 * frame.scale * 0.8)
    expect(Math.abs(offset.x)).toBeLessThan(1)
    const wet = atLandmark(field, 13)
    expect(Math.hypot(wet.x, wet.y)).toBeLessThan(1)
    const nose = atLandmark(field, 2)
    expect(Math.hypot(nose.x, nose.y)).toBeLessThan(1)
  })

  it('a pele do filtro é comprimida: desloca menos que a borda do lábio', () => {
    const border = landmarkPx(0)
    const borderOffset = atPx(field, border.x, border.y - 0.035 * frame.scale)
    const philtrum = atPx(field, 384, 630)
    expect(philtrum.y).toBeGreaterThan(0)
    expect(philtrum.y).toBeLessThan(borderOffset.y)
  })

  it('fora do rosto nada se move (confinamento)', () => {
    const background = atPx(field, 40, 512)
    expect(Math.hypot(background.x, background.y)).toBe(0)
    const hair = atPx(field, 384, 200)
    expect(Math.hypot(hair.x, hair.y)).toBe(0)
  })

  it('bochecha longe do lábio quase não se move', () => {
    const cheek = atLandmark(field, 50)
    expect(Math.hypot(cheek.x, cheek.y)).toBeLessThan(2)
  })
})

describe('mento (silhueta livre)', () => {
  const field = fields.get('mento')!

  it('cabelo e fundo distante não se movem mesmo na região livre', () => {
    for (const region of ['mento', 'malar-direito'] as const) {
      const free = fields.get(region)!
      const hair = atPx(free, 384, 200)
      expect(Math.hypot(hair.x, hair.y), `${region} cabelo`).toBe(0)
      const background = atPx(free, 40, 512)
      expect(Math.hypot(background.x, background.y), `${region} fundo`).toBe(0)
      const shoulder = atPx(free, 600, 1000)
      expect(Math.hypot(shoulder.x, shoulder.y), `${region} ombro`).toBe(0)
    }
  })

  it('a influência de uma região não chega ao outro lado do rosto', () => {
    const malar = fields.get('malar-direito')!
    const otherCheek = atLandmark(malar, 280)
    expect(Math.hypot(otherCheek.x, otherCheek.y)).toBeLessThan(0.15)
    const lips = fields.get('labio-superior')!
    const forehead = atLandmark(lips, 151)
    expect(Math.hypot(forehead.x, forehead.y)).toBeLessThan(0.15)
  })

  it('abaixo do queixo original aparece a pele do queixo (vem de cima); mandíbula fica', () => {
    const chin = landmarkPx(152)
    const offset = atPx(field, chin.x, chin.y + 0.08 * frame.scale)
    expect(-offset.y).toBeGreaterThan(0.08 * frame.scale * 0.8)
    const jaw = atLandmark(field, 172)
    expect(Math.hypot(jaw.x, jaw.y)).toBeLessThan(1)
  })

  it('a borda da imagem fica praticamente fixa', () => {
    const bottom = atPx(field, 384, FIXTURE_HEIGHT - 1)
    expect(Math.abs(bottom.y)).toBeLessThan(0.5)
  })
})

describe('guardrails de todas as regiões', () => {
  it(`strain máximo abaixo de ${MAX_STRAIN} (textura esticada invisível)`, () => {
    for (const [region, field] of fields) {
      expect(maxStrain(field), region).toBeLessThan(MAX_STRAIN)
    }
  })

  it('o guardrail vale também na grade de 512 (perfis alto/médio) nos lábios', () => {
    for (const region of ['labio-superior', 'labio-inferior'] as const) {
      const field = buildRegionField(region, landmarks, map, FIXTURE_WIDTH, FIXTURE_HEIGHT, 512)
      expect(maxStrain(field), region).toBeLessThan(MAX_STRAIN)
    }
  })

  it('íris nunca se movem', () => {
    for (const [region, field] of fields) {
      for (const index of [468, 473]) {
        const iris = atLandmark(field, index)
        expect(Math.hypot(iris.x, iris.y), `${region} íris ${index}`).toBeLessThan(0.5)
      }
    }
  })
})

describe('fotometria (Fase C)', () => {
  const dims = fieldDimensions(FIXTURE_WIDTH, FIXTURE_HEIGHT, MAX_SIDE)
  const luma: LumaImage = {
    y: new Float32Array(dims.width * dims.height).fill(0.55),
    width: dims.width,
    height: dims.height,
  }
  const photometric = { luma, light: { x: -0.4, y: -0.5, z: 0.77 } }
  const channel = (field: RegionField, index: number, xPx: number, yPx: number) => {
    const i = Math.round((yPx / FIXTURE_HEIGHT) * dims.height) * dims.width + Math.round((xPx / FIXTURE_WIDTH) * dims.width)
    return field.photo[i * 4 + index]
  }

  it('sem entrada fotométrica os canais ficam zerados', () => {
    expect(fields.get('labio-superior')!.photo.every((v) => v === 0)).toBe(true)
  })

  it('lábio (grade 512): realce na borda superior (luz de cima), bandas lip/edge, limites', () => {
    const big = fieldDimensions(FIXTURE_WIDTH, FIXTURE_HEIGHT, 512)
    const bigLuma: LumaImage = { y: new Float32Array(big.width * big.height).fill(0.55), width: big.width, height: big.height }
    const field = buildRegionField('labio-superior', landmarks, map, FIXTURE_WIDTH, FIXTURE_HEIGHT, 512, { luma: bigLuma, light: photometric.light })
    const bigChannel = (index: number, xPx: number, yPx: number) => {
      const i = Math.round((yPx / FIXTURE_HEIGHT) * big.height) * big.width + Math.round((xPx / FIXTURE_WIDTH) * big.width)
      return field.photo[i * 4 + index]
    }
    expect(bigChannel(0, 384, 668)).toBeGreaterThan(0) // borda superior do vermelhão
    expect(bigChannel(2, 384, 686)).toBeGreaterThan(0.9) // interior do lábio
    expect(bigChannel(3, 384, 686)).toBeLessThan(0.1)
    expect(bigChannel(3, 384, 672)).toBeGreaterThan(0.2) // banda de borda
    expect(bigChannel(1, 384, 686)).toBe(0) // sem shadow lift no lábio
    let low = Infinity
    let high = -Infinity
    for (let i = 0; i < field.photo.length; i += 4) {
      low = Math.min(low, field.photo[i])
      high = Math.max(high, field.photo[i])
    }
    expect(high).toBeLessThanOrEqual(SHADE_MAX + 1e-6)
    expect(low).toBeGreaterThanOrEqual(SHADE_MIN - 1e-6)
  })

  it('sulco: shadow lift só dentro da máscara e nunca negativo', () => {
    const shadowed: LumaImage = { ...luma, y: luma.y.slice() }
    // Escurece uma faixa onde fica o sulco direito (px ≈ 330, 640).
    for (let j = 0; j < dims.height; j++)
      for (let i = 0; i < dims.width; i++) {
        const x = (i / dims.width) * FIXTURE_WIDTH
        const y = (j / dims.height) * FIXTURE_HEIGHT
        if (Math.hypot(x - 330, (y - 645) / 1.5) < 14) shadowed.y[j * dims.width + i] = 0.45
      }
    const field = buildRegionField('sulco-nasogeniano-direito', landmarks, map, FIXTURE_WIDTH, FIXTURE_HEIGHT, MAX_SIDE, { luma: shadowed, light: photometric.light })
    expect(channel(field, 1, 330, 645)).toBeGreaterThan(0.01)
    expect(channel(field, 1, 384, 400)).toBe(0) // testa: fora da máscara
    let lowest = Infinity
    for (let i = 1; i < field.photo.length; i += 4) lowest = Math.min(lowest, field.photo[i])
    expect(lowest).toBeGreaterThanOrEqual(0)
  })

  it('rejeita luminância em resolução diferente da grade', () => {
    const wrong: LumaImage = { y: new Float32Array(4), width: 2, height: 2 }
    expect(() => buildRegionField('mento', landmarks, map, FIXTURE_WIDTH, FIXTURE_HEIGHT, MAX_SIDE, { luma: wrong, light: photometric.light })).toThrow()
  })
})
