import { describe, expect, it } from 'vitest'
import {
  centroid,
  classifyPoint,
  interocularDistance,
  pointInPolygon,
  REGION_ANCHORS,
  PHILTRUM_POLYGON,
  sampleClass,
} from './anatomy'
import { FACE_CLASSES, type LabelMap } from './segmentation/mask'
import type { Point2 } from './quality'

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

/** Rosto sintético centrado: só os índices usados pelo mapa importam. */
function syntheticLandmarks(): Point2[] {
  const landmarks: Point2[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }))
  const set = (index: number, x: number, y: number) => {
    landmarks[index] = { x, y }
  }

  set(1, 0.5, 0.5) // ponta do nariz (eixo central)
  set(468, 0.4, 0.4) // íris direita do paciente (imagem-esquerda)
  set(473, 0.6, 0.4) // íris esquerda do paciente
  set(13, 0.5, 0.7) // centro interno da boca

  // Filtro: quadrilátero entre subnasal (y=0.62) e topo do lábio (y=0.68)
  set(97, 0.47, 0.62)
  set(2, 0.5, 0.61)
  set(326, 0.53, 0.62)
  set(267, 0.52, 0.68)
  set(0, 0.5, 0.67)
  set(37, 0.48, 0.68)

  // Âncoras
  for (const index of [50, 116, 117, 118]) set(index, 0.33, 0.55) // malar direito
  for (const index of [280, 345, 346, 347]) set(index, 0.67, 0.55) // malar esquerdo
  for (const index of [129, 203, 206]) set(index, 0.43, 0.64) // sulco direito
  for (const index of [358, 423, 426]) set(index, 0.57, 0.64) // sulco esquerdo
  for (const index of [152, 175, 199]) set(index, 0.5, 0.85) // mento
  for (const index of [144, 145, 153]) set(index, 0.4, 0.44) // pálpebra inf. direita
  for (const index of [373, 374, 380]) set(index, 0.6, 0.44) // pálpebra inf. esquerda

  return landmarks
}

/** Labelmap 100x100 preenchido por retângulos de classe. */
function syntheticMap(): LabelMap {
  const width = 100
  const height = 100
  const labels = new Uint8Array(width * height)
  const fill = (x0: number, y0: number, x1: number, y1: number, classId: number) => {
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) labels[y * width + x] = classId
  }
  fill(20, 30, 80, 90, FACE_CLASSES.skin) // rosto
  fill(40, 68, 60, 71, FACE_CLASSES.u_lip)
  fill(40, 71, 60, 75, FACE_CLASSES.l_lip)
  fill(35, 38, 45, 42, FACE_CLASSES.l_eye) // olho imagem-esquerda
  fill(55, 38, 65, 42, FACE_CLASSES.r_eye)
  fill(20, 10, 80, 25, FACE_CLASSES.hair)
  return { labels, width, height }
}

const landmarks = syntheticLandmarks()
const map = syntheticMap()

/* ------------------------------------------------------------------ */

describe('pointInPolygon', () => {
  const square: Point2[] = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ]
  it('dentro / fora / longe', () => {
    expect(pointInPolygon({ x: 0.5, y: 0.5 }, square)).toBe(true)
    expect(pointInPolygon({ x: 1.5, y: 0.5 }, square)).toBe(false)
    expect(pointInPolygon({ x: -0.1, y: -0.1 }, square)).toBe(false)
  })
})

describe('helpers geométricos', () => {
  it('centroid é a média dos pontos', () => {
    const c = centroid(landmarks, [468, 473])
    expect(c.x).toBeCloseTo(0.5)
    expect(c.y).toBeCloseTo(0.4)
  })
  it('interocular usa as íris', () => {
    expect(interocularDistance(landmarks)).toBeCloseTo(0.2)
  })
  it('sampleClass lê o pixel certo', () => {
    expect(sampleClass(map, { x: 0.5, y: 0.69 })).toBe(FACE_CLASSES.u_lip)
    expect(sampleClass(map, { x: 0.5, y: 0.15 })).toBe(FACE_CLASSES.hair)
  })
})

describe('classifyPoint — critério de aceite da Fase 3', () => {
  it('tocar no lábio abre labial, não malar', () => {
    expect(classifyPoint({ x: 0.5, y: 0.69 }, map, landmarks)).toBe('labio-superior')
    expect(classifyPoint({ x: 0.5, y: 0.73 }, map, landmarks)).toBe('labio-inferior')
  })

  it('olhos e sobrancelhas viram região orbital do lado do paciente', () => {
    // imagem-esquerda = lado direito do paciente
    expect(classifyPoint({ x: 0.4, y: 0.4 }, map, landmarks)).toBe('orbital-direita')
    expect(classifyPoint({ x: 0.6, y: 0.4 }, map, landmarks)).toBe('orbital-esquerda')
  })

  it('pele perto da âncora malar vira malar do lado correto', () => {
    expect(classifyPoint({ x: 0.33, y: 0.55 }, map, landmarks)).toBe('malar-direito')
    expect(classifyPoint({ x: 0.67, y: 0.55 }, map, landmarks)).toBe('malar-esquerdo')
  })

  it('pele logo abaixo do olho vira orbital (olheira), não malar', () => {
    expect(classifyPoint({ x: 0.4, y: 0.46 }, map, landmarks)).toBe('orbital-direita')
    expect(classifyPoint({ x: 0.6, y: 0.46 }, map, landmarks)).toBe('orbital-esquerda')
  })

  it('queixo vira mento', () => {
    expect(classifyPoint({ x: 0.5, y: 0.85 }, map, landmarks)).toBe('mento')
  })

  it('filtro tem prioridade sobre âncoras na pele', () => {
    expect(classifyPoint({ x: 0.5, y: 0.65 }, map, landmarks)).toBe('filtro')
  })

  it('cabelo e fundo não são regiões', () => {
    expect(classifyPoint({ x: 0.5, y: 0.15 }, map, landmarks)).toBeNull() // cabelo
    expect(classifyPoint({ x: 0.05, y: 0.5 }, map, landmarks)).toBeNull() // fundo
  })

  it('testa (pele longe de qualquer âncora) não vira região', () => {
    expect(classifyPoint({ x: 0.5, y: 0.3 }, map, landmarks)).toBeNull()
  })
})

describe('definições', () => {
  it('índices das âncoras e do filtro são válidos no espaço 478', () => {
    for (const anchor of REGION_ANCHORS) {
      for (const index of anchor.indices) {
        expect(index).toBeGreaterThanOrEqual(0)
        expect(index).toBeLessThan(478)
      }
    }
    for (const index of PHILTRUM_POLYGON) {
      expect(index).toBeGreaterThanOrEqual(0)
      expect(index).toBeLessThan(478)
    }
  })
})
