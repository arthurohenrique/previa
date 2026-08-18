import type { Technique } from '@/lib/supabase/types'
import type { Landmark, Point2 } from './types'

/**
 * Atlas clínico: região → índices de landmark do FaceLandmarker.
 *
 * O polígono de cada região é o **fecho convexo** do conjunto de índices, não
 * uma lista ordenada à mão. Lista ordenada quebra de forma silenciosa quando um
 * índice entra fora de ordem: o polígono se auto-intersecta, o point-in-polygon
 * passa a mentir e o toque cai na região errada sem nenhum erro aparecer. O
 * fecho convexo é indiferente à ordem e sempre produz um polígono simples.
 *
 * As regiões faciais tratáveis são convexas ou quase, então o fecho é uma
 * aproximação boa. Onde não é — a linha mandibular, que é côncava —, o excesso
 * fica contido pelo clamp de amplitude da própria região (lib/warp/clamps.ts).
 *
 * VALIDAÇÃO VISUAL: os índices precisam ser conferidos sobre um rosto real antes
 * de uso clínico. A tela do simulador tem o modo "Índices", que desenha cada
 * ponto com o seu número sobre a foto — é a ferramenta para essa conferência.
 */

export const REGION_IDS = [
  'glabella',
  'frontal',
  'periorbital',
  'malar',
  'nasolabial_fold',
  'nasal_dorsum',
  'upper_lip',
  'lower_lip',
  'chin',
  'jawline',
] as const

export type RegionId = (typeof REGION_IDS)[number]

/** Lado, para as regiões simétricas. */
export type Side = 'left' | 'right' | 'center'

export interface RegionDefinition {
  id: RegionId
  label: string
  bilateral: boolean
  /** Técnicas que fazem sentido clínico nesta região. */
  techniques: readonly Technique[]
  /** Índices do lado direito do paciente (esquerda da imagem) ou do centro. */
  right: readonly number[]
  /** Índices do lado esquerdo do paciente. Vazio quando a região é central. */
  left: readonly number[]
  /** Landmark de ancoragem por lado, usado quando a marcação não tem âncora. */
  anchorRight: number
  anchorLeft: number
  /** Ordem de cascata na entrada do atlas: de baixo para cima. */
  cascadeOrder: number
}

export const ATLAS: readonly RegionDefinition[] = [
  {
    id: 'glabella',
    label: 'Glabela',
    bilateral: false,
    techniques: ['toxin', 'filler'],
    right: [9, 8, 168, 6, 55, 285, 107, 336, 65, 295],
    left: [],
    anchorRight: 9,
    anchorLeft: 9,
    cascadeOrder: 9,
  },
  {
    id: 'frontal',
    label: 'Frontal',
    bilateral: false,
    techniques: ['toxin'],
    right: [10, 67, 109, 338, 297, 103, 332, 105, 334, 66, 296, 107, 336, 9, 21, 251],
    left: [],
    anchorRight: 10,
    anchorLeft: 10,
    cascadeOrder: 10,
  },
  {
    id: 'periorbital',
    label: 'Periorbital',
    bilateral: true,
    techniques: ['toxin', 'filler'],
    right: [
      33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7, 226, 25, 110,
      24, 23, 22, 26, 112, 130,
    ],
    left: [
      263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249, 446, 255,
      339, 254, 253, 252, 256, 341, 359,
    ],
    anchorRight: 33,
    anchorLeft: 263,
    cascadeOrder: 8,
  },
  {
    id: 'malar',
    label: 'Malar',
    bilateral: true,
    techniques: ['filler', 'biostimulator'],
    right: [116, 117, 118, 119, 100, 126, 142, 36, 205, 187, 123, 50, 101, 207],
    left: [345, 346, 347, 348, 329, 355, 371, 266, 425, 411, 352, 280, 330, 427],
    anchorRight: 205,
    anchorLeft: 425,
    cascadeOrder: 5,
  },
  {
    id: 'nasolabial_fold',
    label: 'Sulco nasogeniano',
    bilateral: true,
    techniques: ['filler', 'biostimulator'],
    right: [64, 129, 203, 206, 216, 212, 57, 61, 92, 165, 98],
    left: [294, 358, 423, 426, 436, 432, 287, 291, 322, 391, 327],
    anchorRight: 206,
    anchorLeft: 426,
    cascadeOrder: 4,
  },
  {
    id: 'nasal_dorsum',
    label: 'Dorso nasal',
    bilateral: false,
    techniques: ['rhinomodeling', 'filler'],
    right: [168, 6, 197, 195, 5, 4, 45, 275, 51, 281, 248, 3, 1, 19],
    left: [],
    anchorRight: 195,
    anchorLeft: 195,
    cascadeOrder: 6,
  },
  {
    id: 'upper_lip',
    label: 'Lábio superior',
    bilateral: false,
    techniques: ['filler'],
    right: [61, 291, 0, 13, 37, 267, 39, 269, 40, 270, 185, 409, 164, 165, 391, 78, 308],
    left: [],
    anchorRight: 0,
    anchorLeft: 0,
    cascadeOrder: 3,
  },
  {
    id: 'lower_lip',
    label: 'Lábio inferior',
    bilateral: false,
    techniques: ['filler'],
    right: [61, 291, 17, 14, 84, 314, 181, 405, 91, 321, 146, 375, 87, 317, 178, 402, 88, 318],
    left: [],
    anchorRight: 17,
    anchorLeft: 17,
    cascadeOrder: 2,
  },
  {
    id: 'chin',
    label: 'Mento',
    bilateral: false,
    techniques: ['filler', 'toxin', 'biostimulator'],
    right: [152, 175, 199, 200, 18, 83, 313, 148, 377, 176, 400, 32, 262, 421, 201],
    left: [],
    anchorRight: 152,
    anchorLeft: 152,
    cascadeOrder: 0,
  },
  {
    id: 'jawline',
    label: 'Linha mandibular',
    bilateral: true,
    techniques: ['filler', 'biostimulator'],
    right: [172, 136, 150, 149, 176, 148, 152, 58, 132, 93, 234, 138, 135, 169, 170, 140, 171],
    left: [397, 365, 379, 378, 400, 377, 152, 288, 361, 323, 454, 367, 364, 394, 395, 369, 396],
    anchorRight: 172,
    anchorLeft: 397,
    cascadeOrder: 1,
  },
]

const BY_ID = new Map<RegionId, RegionDefinition>(ATLAS.map((region) => [region.id, region]))

export function getRegion(id: RegionId): RegionDefinition {
  const region = BY_ID.get(id)
  if (!region) throw new Error(`Região desconhecida no atlas: ${id}`)
  return region
}

/** Uma instância concreta de região: definição + lado. */
export interface RegionInstance {
  region: RegionDefinition
  side: Side
  /** Polígono no espaço normalizado da foto, já em fecho convexo. */
  polygon: Point2[]
  centroid: Point2
  /**
   * Núcleo da região: o ponto mais fundo dentro do polígono (centro de
   * Chebyshev), em coordenada normalizada da foto.
   *
   * É aqui que a aplicação nasce, e não no landmark de ancoragem. O landmark de
   * ancoragem é um **vértice** do fecho convexo — está na borda por
   * construção —, e a máscara da região vale zero na borda. Ancorar ali punha
   * metade do efeito fora da máscara e a outra metade na parte em que ela ainda
   * está subindo: o profissional tocava, o marcador aparecia, e a foto não
   * mudava. O centróide também não serve: em região alongada como a linha
   * mandibular ele cai no meio da bochecha, longe do tecido tratado.
   */
  core: Point2
  /**
   * Raio inscrito da região — a distância do núcleo até a borda mais próxima —
   * em fração da **largura** da foto.
   *
   * É a medida de quanto efeito cabe aqui dentro. O feather da máscara e o raio
   * padrão da aplicação saem dele; sem isso, uma região fina como o vermelhão do
   * lábio recebe um feather maior que ela inteira e nunca chega a máscara cheia.
   */
  inscribedU: number
  key: string
}

/** Fecho convexo por varredura de Andrew. Devolve os pontos em sentido horário. */
export function convexHull(points: readonly Point2[]): Point2[] {
  if (points.length < 3) return [...points]

  const sorted = [...points].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x))

  const cross = (o: Point2, a: Point2, b: Point2) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)

  const build = (list: readonly Point2[]) => {
    const stack: Point2[] = []
    for (const point of list) {
      while (stack.length >= 2) {
        const a = stack[stack.length - 2] as Point2
        const b = stack[stack.length - 1] as Point2
        if (cross(a, b, point) > 0) break
        stack.pop()
      }
      stack.push(point)
    }
    stack.pop()
    return stack
  }

  return [...build(sorted), ...build([...sorted].reverse())]
}

/**
 * Maior círculo que cabe no polígono convexo: centro e raio.
 *
 * O cálculo acontece num espaço de pixels quadrados — `(u, v / aspecto)` —, senão
 * o "mais fundo" sai enviesado para o eixo curto em foto que não é 1:1. O raio
 * volta em fração da largura da foto, que é a unidade de `u`.
 *
 * O método é busca direta: uma grade grossa para achar a bacia certa e um
 * refinamento local que reduz o passo pela metade. Polígono convexo tem um
 * máximo só, então não há bacia errada onde cair. Custa alguns milhares de
 * produtos escalares por região, uma vez por sessão, fora do caminho dos 16 ms.
 */
export function inscribedCircle(
  polygon: readonly Point2[],
  aspect: number,
): { center: Point2; radius: number } {
  if (polygon.length < 3) {
    const fallback = centroidOf(polygon)
    return { center: fallback, radius: 0 }
  }

  // Espaço quadrado: y em unidades de largura.
  const points = polygon.map((point) => ({ x: point.x, y: point.y / aspect }))

  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const point of points) {
    if (point.x < minX) minX = point.x
    if (point.x > maxX) maxX = point.x
    if (point.y < minY) minY = point.y
    if (point.y > maxY) maxY = point.y
  }

  // Distância até a borda, positiva dentro. Num convexo, é o mínimo das
  // distâncias até as retas das arestas.
  const depth = (x: number, y: number): number => {
    let best = Number.POSITIVE_INFINITY
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const a = points[j] as Point2
      const b = points[i] as Point2
      const ex = b.x - a.x
      const ey = b.y - a.y
      const length = Math.hypot(ex, ey)
      if (length < 1e-9) continue
      // Sinal resolvido depois: aqui só o módulo, e o ponto de fora é descartado
      // pelo teste de orientação abaixo.
      const cross = (ex * (y - a.y) - ey * (x - a.x)) / length
      if (cross < best) best = cross
    }
    return best
  }

  // O fecho convexo pode vir em qualquer sentido; o sinal de `depth` no
  // centróide diz qual é o lado de dentro.
  const seed = centroidOf(points)
  const orientation = depth(seed.x, seed.y) >= 0 ? 1 : -1
  const inside = (x: number, y: number) => depth(x, y) * orientation

  let bestX = seed.x
  let bestY = seed.y
  let bestDepth = inside(seed.x, seed.y)

  const steps = 16
  for (let row = 0; row <= steps; row += 1) {
    const y = minY + ((maxY - minY) * row) / steps
    for (let col = 0; col <= steps; col += 1) {
      const x = minX + ((maxX - minX) * col) / steps
      const value = inside(x, y)
      if (value > bestDepth) {
        bestDepth = value
        bestX = x
        bestY = y
      }
    }
  }

  let step = Math.max((maxX - minX) / steps, (maxY - minY) / steps)
  for (let iteration = 0; iteration < 24 && step > 1e-6; iteration += 1) {
    let moved = false
    for (const [dx, dy] of [
      [step, 0],
      [-step, 0],
      [0, step],
      [0, -step],
      [step, step],
      [step, -step],
      [-step, step],
      [-step, -step],
    ] as const) {
      const value = inside(bestX + dx, bestY + dy)
      if (value > bestDepth) {
        bestDepth = value
        bestX += dx
        bestY += dy
        moved = true
      }
    }
    if (!moved) step /= 2
  }

  return {
    center: { x: bestX, y: bestY * aspect },
    radius: Math.max(0, bestDepth),
  }
}

export function centroidOf(points: readonly Point2[]): Point2 {
  if (points.length === 0) return { x: 0.5, y: 0.5 }
  let x = 0
  let y = 0
  for (const point of points) {
    x += point.x
    y += point.y
  }
  return { x: x / points.length, y: y / points.length }
}

function collect(landmarks: readonly Landmark[], indices: readonly number[]): Point2[] {
  const points: Point2[] = []
  for (const index of indices) {
    const landmark = landmarks[index]
    if (landmark) points.push({ x: landmark.x, y: landmark.y })
  }
  return points
}

/**
 * Constrói todas as instâncias de região para um rosto detectado. Chamado uma
 * vez por sessão, logo depois da detecção.
 *
 * `aspect` é largura/altura da foto. Ele entra porque o núcleo e o raio inscrito
 * são distâncias, e distância em coordenada normalizada não é distância: numa
 * foto 3:4, um passo de 0.01 em v vale 33% mais pixels que o mesmo passo em u.
 */
export function buildRegionInstances(
  landmarks: readonly Landmark[],
  aspect: number,
): RegionInstance[] {
  const instances: RegionInstance[] = []

  for (const region of ATLAS) {
    const sides: Array<{ side: Side; indices: readonly number[] }> = region.bilateral
      ? [
          { side: 'right', indices: region.right },
          { side: 'left', indices: region.left },
        ]
      : [{ side: 'center', indices: region.right }]

    for (const { side, indices } of sides) {
      const points = collect(landmarks, indices)
      if (points.length < 3) continue
      const polygon = convexHull(points)
      const inscribed = inscribedCircle(polygon, aspect)
      instances.push({
        region,
        side,
        polygon,
        centroid: centroidOf(polygon),
        core: inscribed.center,
        inscribedU: inscribed.radius,
        key: side === 'center' ? region.id : `${region.id}:${side}`,
      })
    }
  }

  return instances
}

export function anchorIndexFor(region: RegionDefinition, side: Side): number {
  return side === 'left' ? region.anchorLeft : region.anchorRight
}
