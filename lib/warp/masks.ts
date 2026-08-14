import { ImageSource, Texture } from 'pixi.js'
import type { RegionInstance } from '@/lib/face/atlas'
import type { Point2 } from '@/lib/face/types'
import { MASK_FEATHER_IPD, MAX_MASK_SLOTS, MAX_MASK_TEXTURES } from './filters/constants'

/**
 * Máscara de região com feather.
 *
 * Cada instância de região vira um canal de uma textura RGBA: quatro regiões por
 * textura, quatro texturas, dezesseis vagas. O atlas produz no máximo quinze
 * instâncias, então tudo cabe e sobra uma.
 *
 * O feather é analítico, não borrão. Como o polígono é o fecho convexo do
 * conjunto de landmarks (ver lib/face/atlas.ts), a distância com sinal até a
 * borda é o máximo dos produtos escalares com as normais das arestas — exato,
 * barato e sem depender de `ctx.filter`, que só existe no Safari 17 em diante.
 *
 * O feather cresce para dentro. Máscara que vaza para fora arrasta fundo e
 * cabelo junto com a pele, e é o artefato que mais denuncia simulação.
 */

interface HalfPlane {
  nx: number
  ny: number
  /** dot(n, p0) — a aresta passa por p0. */
  d: number
}

/** Meios-planos externos do polígono convexo, em pixels da foto. */
function halfPlanes(polygon: readonly Point2[], width: number, height: number): HalfPlane[] {
  const points = polygon.map((p) => ({ x: p.x * width, y: p.y * height }))
  if (points.length < 3) return []

  let signedArea = 0
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i] as Point2
    const b = points[(i + 1) % points.length] as Point2
    signedArea += a.x * b.y - b.x * a.y
  }
  const orientation = signedArea >= 0 ? 1 : -1

  const planes: HalfPlane[] = []
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i] as Point2
    const b = points[(i + 1) % points.length] as Point2
    const ex = b.x - a.x
    const ey = b.y - a.y
    const length = Math.hypot(ex, ey)
    if (length < 1e-6) continue

    // Normal externa: depende do sentido em que o fecho foi construído, então a
    // orientação é medida e não presumida.
    const nx = (ey / length) * orientation
    const ny = (-ex / length) * orientation
    planes.push({ nx, ny, d: nx * a.x + ny * a.y })
  }
  return planes
}

/** Distância com sinal até o polígono convexo. Negativa dentro. */
function signedDistance(planes: readonly HalfPlane[], x: number, y: number): number {
  let maximum = Number.NEGATIVE_INFINITY
  for (const plane of planes) {
    const value = plane.nx * x + plane.ny * y - plane.d
    if (value > maximum) maximum = value
  }
  return maximum
}

export interface MaskAtlas {
  /** Uma ImageData RGBA por textura de máscara. */
  textures: ImageData[]
  /** Chave da instância de região → vaga 0..15. */
  slots: Map<string, number>
  width: number
  height: number
}

/**
 * Constrói o atlas de máscaras na resolução do campo.
 *
 * Roda uma vez por sessão, logo depois da detecção. Custa uma varredura de
 * `fieldWidth × fieldHeight` por região — alguns milissegundos, fora do caminho
 * dos 16 ms de interação.
 */
export function buildMaskAtlas(
  instances: readonly RegionInstance[],
  photoWidth: number,
  photoHeight: number,
  ipdPx: number,
  fieldWidth: number,
  fieldHeight: number,
): MaskAtlas {
  const used = instances.slice(0, MAX_MASK_SLOTS)
  const textureCount = Math.max(1, Math.ceil(used.length / 4))
  const textures: ImageData[] = []
  for (let i = 0; i < textureCount; i += 1) {
    textures.push(new ImageData(fieldWidth, fieldHeight))
  }

  const slots = new Map<string, number>()
  const feather = Math.max(2, MASK_FEATHER_IPD * ipdPx)

  used.forEach((instance, slot) => {
    slots.set(instance.key, slot)

    const texture = textures[Math.floor(slot / 4)]
    if (!texture) return
    const channel = slot % 4
    const planes = halfPlanes(instance.polygon, photoWidth, photoHeight)
    if (planes.length === 0) return

    for (let row = 0; row < fieldHeight; row += 1) {
      const y = ((row + 0.5) / fieldHeight) * photoHeight
      for (let col = 0; col < fieldWidth; col += 1) {
        const x = ((col + 0.5) / fieldWidth) * photoWidth
        const distance = signedDistance(planes, x, y)
        if (distance >= 0) continue

        const t = Math.min(1, -distance / feather)
        // smoothstep: borda sem degrau, miolo cheio.
        const alpha = t * t * (3 - 2 * t)
        texture.data[(row * fieldWidth + col) * 4 + channel] = Math.round(alpha * 255)
      }
    }
  })

  return { textures, slots, width: fieldWidth, height: fieldHeight }
}

/**
 * Sobe o atlas para a GPU.
 *
 * O canal alfa aqui é dado, não transparência — é a quarta região da textura.
 * Por isso o bitmap nasce com `premultiplyAlpha: 'none'` e a fonte com
 * `alphaMode: 'no-premultiply-alpha'`. Sem os dois, o navegador multiplica RGB
 * por A no upload e apaga três das quatro regiões de cada textura.
 */
export async function createMaskTextures(atlas: MaskAtlas): Promise<Texture[]> {
  const textures: Texture[] = []

  for (let i = 0; i < MAX_MASK_TEXTURES; i += 1) {
    const imageData = atlas.textures[i]
    if (!imageData) {
      textures.push(Texture.EMPTY)
      continue
    }

    const bitmap = await createImageBitmap(imageData, { premultiplyAlpha: 'none' })
    const source = new ImageSource({
      resource: bitmap,
      width: atlas.width,
      height: atlas.height,
      alphaMode: 'no-premultiply-alpha',
      scaleMode: 'linear',
      autoGenerateMipmaps: false,
    })
    textures.push(new Texture({ source }))
  }

  return textures
}
