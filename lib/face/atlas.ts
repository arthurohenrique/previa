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
  symmetric: boolean
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
    symmetric: false,
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
    symmetric: false,
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
    symmetric: true,
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
    symmetric: true,
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
    symmetric: true,
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
    symmetric: false,
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
    symmetric: false,
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
    symmetric: false,
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
    symmetric: false,
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
    symmetric: true,
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
 */
export function buildRegionInstances(landmarks: readonly Landmark[]): RegionInstance[] {
  const instances: RegionInstance[] = []

  for (const region of ATLAS) {
    const sides: Array<{ side: Side; indices: readonly number[] }> = region.symmetric
      ? [
          { side: 'right', indices: region.right },
          { side: 'left', indices: region.left },
        ]
      : [{ side: 'center', indices: region.right }]

    for (const { side, indices } of sides) {
      const points = collect(landmarks, indices)
      if (points.length < 3) continue
      const polygon = convexHull(points)
      instances.push({
        region,
        side,
        polygon,
        centroid: centroidOf(polygon),
        key: side === 'center' ? region.id : `${region.id}:${side}`,
      })
    }
  }

  return instances
}

export function anchorIndexFor(region: RegionDefinition, side: Side): number {
  return side === 'left' ? region.anchorLeft : region.anchorRight
}
