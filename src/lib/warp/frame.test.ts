import { describe, expect, it } from 'vitest'
import type { Point2 } from '@/lib/quality'
import {
  buildFaceFrame,
  contourNormals,
  faceVectorToPx,
  fromFace,
  IRIS_LEFT_PATIENT,
  IRIS_RIGHT_PATIENT,
  toFace,
} from './frame'
import { FIXTURE_HEIGHT, FIXTURE_WIDTH, syntheticFace } from './__fixtures__/face'

const landmarks = syntheticFace()
const frame = buildFaceFrame(landmarks, FIXTURE_WIDTH, FIXTURE_HEIGHT)

describe('buildFaceFrame', () => {
  it('escala = interocular em px; eixos ortonormais; Y aponta para o queixo', () => {
    expect(frame.scale).toBeCloseTo(208)
    expect(Math.hypot(frame.axisX.x, frame.axisX.y)).toBeCloseTo(1)
    expect(Math.hypot(frame.axisY.x, frame.axisY.y)).toBeCloseTo(1)
    expect(frame.axisX.x * frame.axisY.x + frame.axisX.y * frame.axisY.y).toBeCloseTo(0)
    expect(frame.axisY.y).toBeGreaterThan(0)
  })

  it('íris ficam em (∓0.5, 0) nas unidades do rosto', () => {
    const right = toFace({ x: 280, y: 430 }, frame)
    const left = toFace({ x: 488, y: 430 }, frame)
    expect(right.x).toBeCloseTo(-0.5)
    expect(right.y).toBeCloseTo(0)
    expect(left.x).toBeCloseTo(0.5)
  })

  it('corrige a inclinação da cabeça (roll)', () => {
    const angle = (15 * Math.PI) / 180
    const rotated: Point2[] = landmarks.map((point) => {
      const x = point.x * FIXTURE_WIDTH - 384
      const y = point.y * FIXTURE_HEIGHT - 430
      return {
        x: (384 + x * Math.cos(angle) - y * Math.sin(angle)) / FIXTURE_WIDTH,
        y: (430 + x * Math.sin(angle) + y * Math.cos(angle)) / FIXTURE_HEIGHT,
      }
    })
    const tilted = buildFaceFrame(rotated, FIXTURE_WIDTH, FIXTURE_HEIGHT)
    expect(tilted.scale).toBeCloseTo(208)
    expect(tilted.axisX.x).toBeCloseTo(Math.cos(angle))
    expect(tilted.axisX.y).toBeCloseTo(Math.sin(angle))
    // O queixo continua em (0, +) no referencial do rosto.
    const chin = toFace(
      { x: rotated[152].x * FIXTURE_WIDTH, y: rotated[152].y * FIXTURE_HEIGHT },
      tilted,
    )
    expect(chin.x).toBeCloseTo(0, 5)
    expect(chin.y).toBeCloseTo((885 - 430) / 208)
  })

  it('toFace/fromFace são inversas; vetor (0,1) mede uma interocular para baixo', () => {
    const point = { x: 123.4, y: 567.8 }
    const back = fromFace(toFace(point, frame), frame)
    expect(back.x).toBeCloseTo(point.x)
    expect(back.y).toBeCloseTo(point.y)
    const down = faceVectorToPx({ x: 0, y: 1 }, frame)
    expect(down.x).toBeCloseTo(0)
    expect(down.y).toBeCloseTo(208)
  })

  it('recusa íris coincidentes', () => {
    const broken = landmarks.slice()
    broken[IRIS_LEFT_PATIENT] = broken[IRIS_RIGHT_PATIENT]
    expect(() => buildFaceFrame(broken, FIXTURE_WIDTH, FIXTURE_HEIGHT)).toThrow()
  })
})

describe('contourNormals', () => {
  it('arco acima do centro → normais unitárias apontando para cima', () => {
    const arc: Point2[] = Array.from({ length: 7 }, (_, i) => {
      const angle = Math.PI - (Math.PI * i) / 6
      return { x: Math.cos(angle) * 10, y: -Math.sin(angle) * 6 }
    })
    const normals = contourNormals(arc, { x: 0, y: 0 })
    for (const normal of normals) {
      expect(Math.hypot(normal.x, normal.y)).toBeCloseTo(1)
    }
    // Ápice: normal vertical para cima (y negativo em coordenadas de imagem).
    expect(normals[3].x).toBeCloseTo(0)
    expect(normals[3].y).toBeCloseTo(-1)
  })
})
