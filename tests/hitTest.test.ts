import { describe, expect, it } from 'vitest'
import { buildRegionInstances, type RegionInstance } from '@/lib/face/atlas'
import {
  clientPointToImage,
  distanceToPolygon,
  hitTest,
  imagePointToClient,
  pointInPolygon,
  polygonArea,
} from '@/lib/face/hitTest'
import type { Landmark } from '@/lib/face/types'

const SQUARE = [
  { x: 0.2, y: 0.2 },
  { x: 0.8, y: 0.2 },
  { x: 0.8, y: 0.8 },
  { x: 0.2, y: 0.8 },
]

function rect(x: number, y: number, width: number, height: number): DOMRect {
  return {
    x,
    y,
    width,
    height,
    left: x,
    top: y,
    right: x + width,
    bottom: y + height,
    toJSON: () => ({}),
  } as DOMRect
}

function instance(key: string, polygon: Array<{ x: number; y: number }>): RegionInstance {
  const centroid = polygon.reduce(
    (acc, point) => ({ x: acc.x + point.x / polygon.length, y: acc.y + point.y / polygon.length }),
    { x: 0, y: 0 },
  )
  return {
    key,
    side: 'center',
    polygon,
    centroid,
    core: centroid,
    inscribedU: 0.05,
    region: {
      id: 'chin',
      label: key,
      bilateral: false,
      techniques: ['filler'],
      right: [],
      left: [],
      anchorRight: 152,
      anchorLeft: 152,
      cascadeOrder: 0,
    },
  }
}

describe('point-in-polygon', () => {
  it('acerta dentro e erra fora', () => {
    expect(pointInPolygon({ x: 0.5, y: 0.5 }, SQUARE)).toBe(true)
    expect(pointInPolygon({ x: 0.1, y: 0.5 }, SQUARE)).toBe(false)
    expect(pointInPolygon({ x: 0.5, y: 0.9 }, SQUARE)).toBe(false)
  })

  it('mede a área do polígono', () => {
    expect(polygonArea(SQUARE)).toBeCloseTo(0.36, 12)
  })
})

describe('toque para região', () => {
  const big = instance('grande', SQUARE)
  const small = instance('pequena', [
    { x: 0.45, y: 0.45 },
    { x: 0.55, y: 0.45 },
    { x: 0.55, y: 0.55 },
    { x: 0.45, y: 0.55 },
  ])

  it('vence a região menor quando duas se sobrepõem', () => {
    // Glabela dentro da frontal: o profissional quis tocar a mais específica.
    const hit = hitTest({ x: 0.5, y: 0.5 }, [big, small])
    expect(hit?.instance.key).toBe('pequena')
    expect(hit?.exact).toBe(true)
  })

  it('faz snap quando o toque passa raspando da borda', () => {
    // 0.05 fora da aresta direita do quadrado, dentro do limite padrão.
    const hit = hitTest({ x: 0.85, y: 0.5 }, [big])
    expect(hit?.instance.key).toBe('grande')
    expect(hit?.exact).toBe(false)
  })

  it('não faz snap de um toque distante', () => {
    expect(hitTest({ x: 0.02, y: 0.02 }, [small])).toBeNull()
  })

  it('mede a distância até a borda, não até o centro', () => {
    // Com corte por centróide, um toque rente à borda de uma região grande
    // seria rejeitado — a distância até o centro dela já é enorme.
    expect(distanceToPolygon({ x: 0.5, y: 0.5 }, SQUARE)).toBe(0)
    expect(distanceToPolygon({ x: 0.85, y: 0.5 }, SQUARE)).toBeCloseTo(0.05, 10)
    expect(distanceToPolygon({ x: 0.9, y: 0.9 }, SQUARE)).toBeCloseTo(Math.hypot(0.1, 0.1), 10)
  })
})

describe('coordenada do toque com letterbox', () => {
  // Container 1000×600 e foto 3:4 → a foto ocupa 450×600 centrada, com 275 px
  // de barra de cada lado. Ignorar essas barras desloca o ponto em centenas de
  // pixels — é o erro que mais faz simulador cair no lugar errado.
  const bounds = rect(0, 0, 1000, 600)
  const imageWidth = 1200
  const imageHeight = 1600

  it('desconta a barra lateral', () => {
    const center = clientPointToImage(500, 300, bounds, imageWidth, imageHeight)
    expect(center?.x).toBeCloseTo(0.5, 10)
    expect(center?.y).toBeCloseTo(0.5, 10)
  })

  it('devolve null para toque na barra', () => {
    expect(clientPointToImage(10, 300, bounds, imageWidth, imageHeight)).toBeNull()
  })

  it('desconta a posição do container na página', () => {
    const offset = rect(120, 40, 1000, 600)
    const point = clientPointToImage(620, 340, offset, imageWidth, imageHeight)
    expect(point?.x).toBeCloseTo(0.5, 10)
    expect(point?.y).toBeCloseTo(0.5, 10)
  })

  it('faz o caminho de volta bater com o de ida', () => {
    const original = { x: 0.31, y: 0.72 }
    const client = imagePointToClient(original, bounds, imageWidth, imageHeight)
    const back = clientPointToImage(client.x, client.y, bounds, imageWidth, imageHeight)

    expect(back?.x).toBeCloseTo(original.x, 10)
    expect(back?.y).toBeCloseTo(original.y, 10)
  })

  it('funciona com foto mais larga que o container', () => {
    const wide = rect(0, 0, 400, 900)
    const point = clientPointToImage(200, 450, wide, 1600, 1200)
    expect(point?.x).toBeCloseTo(0.5, 10)
    expect(point?.y).toBeCloseTo(0.5, 10)
  })
})

describe('atlas real', () => {
  it('resolve um toque no centro do rosto para alguma região', () => {
    const landmarks: Landmark[] = Array.from({ length: 478 }, (_, index) => ({
      x: 0.5 + 0.2 * Math.cos((index * 2 * Math.PI) / 478),
      y: 0.5 + 0.3 * Math.sin((index * 2 * Math.PI) / 478),
      z: 0,
    }))

    const instances = buildRegionInstances(landmarks, 0.75)
    expect(hitTest({ x: 0.5, y: 0.5 }, instances)).not.toBeNull()
  })
})
