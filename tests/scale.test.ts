import { describe, expect, it } from 'vitest'
import {
  applyIpdOffset,
  IRIS_LEFT_CENTER,
  IRIS_RIGHT_CENTER,
  ipdToPx,
  measureIpdPx,
  offsetToIpd,
  poseFromMatrix,
  pxToIpd,
  ScaleError,
} from '@/lib/face/scale'
import type { Landmark } from '@/lib/face/types'

function landmarks(overrides: Record<number, Landmark>, length = 478): Landmark[] {
  const list: Landmark[] = Array.from({ length }, () => ({ x: 0.5, y: 0.5, z: 0 }))
  for (const [index, value] of Object.entries(overrides)) list[Number(index)] = value
  return list
}

describe('distância interpupilar', () => {
  it('mede a distância entre os centros de íris em pixels da foto', () => {
    const points = landmarks({
      [IRIS_RIGHT_CENTER]: { x: 0.4, y: 0.5, z: 0 },
      [IRIS_LEFT_CENTER]: { x: 0.6, y: 0.5, z: 0 },
    })

    expect(measureIpdPx(points, 1000, 800)).toBeCloseTo(200, 6)
  })

  it('cai para os cantos dos olhos quando as íris não vêm no resultado', () => {
    // Modelo sem refinamento de íris: 468 pontos.
    const points = landmarks(
      {
        33: { x: 0.3, y: 0.5, z: 0 },
        133: { x: 0.4, y: 0.5, z: 0 },
        362: { x: 0.6, y: 0.5, z: 0 },
        263: { x: 0.7, y: 0.5, z: 0 },
      },
      468,
    )

    // Ponto médio de cada olho: 0.35 e 0.65 → 0.30 da largura.
    expect(measureIpdPx(points, 1000, 800)).toBeCloseTo(300, 6)
  })

  it('recusa geometria degenerada em vez de devolver escala inválida', () => {
    const points = landmarks({
      [IRIS_RIGHT_CENTER]: { x: 0.5, y: 0.5, z: 0 },
      [IRIS_LEFT_CENTER]: { x: 0.5, y: 0.5, z: 0 },
    })

    expect(() => measureIpdPx(points, 1000, 800)).toThrow(ScaleError)
  })
})

describe('conversões em fração de DIP', () => {
  it('faz o caminho de ida e volta sem perder valor', () => {
    expect(pxToIpd(ipdToPx(0.037, 240), 240)).toBeCloseTo(0.037, 12)
  })

  it('mede o offset de um ponto em relação à âncora', () => {
    const offset = offsetToIpd({ x: 0.5, y: 0.5 }, { x: 0.55, y: 0.45 }, 1000, 1000, 200)
    expect(offset.x).toBeCloseTo(0.25, 10)
    expect(offset.y).toBeCloseTo(-0.25, 10)
  })

  it('reaplica o offset e volta ao ponto original', () => {
    const anchor = { x: 0.42, y: 0.61 }
    const point = { x: 0.5, y: 0.5 }
    const offset = offsetToIpd(anchor, point, 1600, 1200, 260)
    const back = applyIpdOffset(anchor, offset, 1600, 1200, 260)

    expect(back.x).toBeCloseTo(point.x, 12)
    expect(back.y).toBeCloseTo(point.y, 12)
  })

  it('reposiciona a aplicação quando a foto muda de escala', () => {
    // Mesma âncora, mesma fração de DIP, foto maior: o ponto acompanha.
    const anchor = { x: 0.5, y: 0.5 }
    const offset = { x: 0.5, y: 0 }

    const small = applyIpdOffset(anchor, offset, 1000, 1000, 200)
    const large = applyIpdOffset(anchor, offset, 2000, 2000, 400)

    expect(small.x).toBeCloseTo(large.x, 12)
    expect(small.y).toBeCloseTo(large.y, 12)
  })
})

describe('ângulo da cabeça', () => {
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

  it('devolve zero para a matriz identidade', () => {
    const pose = poseFromMatrix(identity)
    expect(pose.yaw).toBeCloseTo(0, 10)
    expect(pose.pitch).toBeCloseTo(0, 10)
    expect(pose.roll).toBeCloseTo(0, 10)
  })

  it('extrai a rolagem de uma rotação conhecida', () => {
    const angle = Math.PI / 12 // 15°
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    // Rotação em torno de X, coluna-major.
    const matrix = [1, 0, 0, 0, 0, cos, sin, 0, 0, -sin, cos, 0, 0, 0, 0, 1]

    const pose = poseFromMatrix(matrix)
    expect(pose.roll).toBeCloseTo(15, 6)
    expect(pose.yaw).toBeCloseTo(0, 6)
  })

  it('recusa matriz incompleta', () => {
    expect(() => poseFromMatrix([1, 0, 0])).toThrow(ScaleError)
  })
})
