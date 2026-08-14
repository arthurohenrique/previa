'use client'

import {
  Container,
  defaultFilterVert,
  Filter,
  GlProgram,
  RenderTexture,
  Sprite,
  Texture,
  UniformGroup,
  type Renderer,
} from 'pixi.js'
import { amplitudeFor, clampRadius, smoothingFor } from './clamps'
import { FIELD_FRAGMENT } from './filters/field.frag'
import { FIELD_SCALE, MAX_APPLICATIONS } from './filters/constants'
import type { MaskAtlas } from './masks'
import type { ResolvedApplication } from './types'

/**
 * Acumulador do campo de deslocamento.
 *
 * Um `RenderTexture` RG em 1/4 da resolução da foto, reconstruído só quando uma
 * aplicação muda (dirty flag). Ajustar intensidade durante o arrasto reescreve
 * uniforms e refaz um passe de 1/16 dos pixels — é isso que mantém os 16 ms.
 */

export interface FieldGeometryInfo {
  photoWidth: number
  photoHeight: number
  ipdPx: number
}

/** Direção fixa por técnica, quando não é radial. */
function fixedDirection(app: ResolvedApplication): { x: number; y: number } | null {
  if (app.technique !== 'biostimulator') return null

  // Superior-lateral: o bioestimulador sustenta, não projeta. A componente
  // lateral aponta para longe da linha média — para a direita na metade direita
  // da foto, para a esquerda na esquerda.
  const lateral = app.u >= 0.5 ? 1 : -1
  const x = lateral * 0.5
  const y = -0.866
  const length = Math.hypot(x, y)
  return { x: x / length, y: y / length }
}

export class DisplacementField {
  private readonly uniforms: UniformGroup
  private readonly filter: Filter
  private readonly container: Container
  private readonly quad: Sprite
  private readonly maskTextures: Texture[] = []

  readonly texture: RenderTexture
  readonly width: number
  readonly height: number

  private dirty = true
  private encodeScale = 0.05
  private hasToxin = false

  constructor(
    private readonly geometry: FieldGeometryInfo,
    private readonly masks: MaskAtlas,
    maskTextures: readonly Texture[],
  ) {
    this.width = Math.max(2, Math.round(geometry.photoWidth * FIELD_SCALE))
    this.height = Math.max(2, Math.round(geometry.photoHeight * FIELD_SCALE))

    this.texture = RenderTexture.create({
      width: this.width,
      height: this.height,
      resolution: 1,
      antialias: false,
      scaleMode: 'linear',
    })

    this.uniforms = new UniformGroup({
      uApp0: { value: new Float32Array(MAX_APPLICATIONS * 4), type: 'vec4<f32>', size: MAX_APPLICATIONS },
      uApp1: { value: new Float32Array(MAX_APPLICATIONS * 4), type: 'vec4<f32>', size: MAX_APPLICATIONS },
      uApp2: { value: new Float32Array(MAX_APPLICATIONS * 4), type: 'vec4<f32>', size: MAX_APPLICATIONS },
      uCount: { value: 0, type: 'f32' },
      uEncodeScale: { value: this.encodeScale, type: 'f32' },
      uAspect: { value: geometry.photoWidth / geometry.photoHeight, type: 'f32' },
    })

    for (let i = 0; i < 4; i += 1) {
      this.maskTextures.push(maskTextures[i] ?? Texture.EMPTY)
    }

    this.filter = new Filter({
      glProgram: GlProgram.from({
        vertex: defaultFilterVert,
        fragment: FIELD_FRAGMENT,
        name: 'previa-field',
      }),
      resources: {
        fieldUniforms: this.uniforms,
        uMask0: this.maskSource(0),
        uMask1: this.maskSource(1),
        uMask2: this.maskSource(2),
        uMask3: this.maskSource(3),
      },
      padding: 0,
      resolution: 1,
      antialias: 'off',
    })

    // O filtro precisa de algo para ser aplicado. Um retângulo branco do tamanho
    // do campo é o suporte mais barato: o shader ignora a cor de entrada e
    // escreve o campo do zero.
    this.quad = new Sprite(Texture.WHITE)
    this.quad.width = this.width
    this.quad.height = this.height
    this.quad.filters = [this.filter]

    this.container = new Container()
    this.container.addChild(this.quad)
  }

  private maskSource(index: number) {
    const texture = this.maskTextures[index]
    return texture ? texture.source : Texture.EMPTY.source
  }

  /** `true` quando existe pelo menos uma aplicação de toxina no conjunto atual. */
  get requiresSmoothing(): boolean {
    return this.hasToxin
  }

  get encodeScaleValue(): number {
    return this.encodeScale
  }

  /**
   * Reescreve os uniforms a partir do conjunto de aplicações.
   *
   * Não desenha nada: só marca sujo. O desenho acontece no `rebuild`, uma vez
   * por frame, e só se algo mudou.
   */
  setApplications(applications: readonly ResolvedApplication[]): void {
    const uniforms = this.uniforms.uniforms as {
      uApp0: Float32Array
      uApp1: Float32Array
      uApp2: Float32Array
      uCount: number
      uEncodeScale: number
      uAspect: number
    }

    const { photoWidth, photoHeight, ipdPx } = this.geometry
    const ipdU = ipdPx / photoWidth
    const ipdV = ipdPx / photoHeight

    let count = 0
    let amplitudeSum = 0
    let toxin = false

    for (const app of applications) {
      if (count >= MAX_APPLICATIONS) break
      const slot = this.masks.slots.get(app.regionKey)
      if (slot === undefined) continue

      const radiusIpd = clampRadius(app.radiusIpd, app.regionId, app.technique)
      const amplitudeIpd = amplitudeFor(app.intensity, app.regionId, app.technique)
      const smoothing = smoothingFor(app.intensity, app.regionId, app.technique)

      // A amplitude é isotrópica em pixels; em UV ela vira o par (ipdU, ipdV).
      const amplitudeU = amplitudeIpd * ipdU
      amplitudeSum += amplitudeU

      const base = count * 4
      uniforms.uApp0[base] = app.u
      uniforms.uApp0[base + 1] = app.v
      uniforms.uApp0[base + 2] = radiusIpd * ipdU
      uniforms.uApp0[base + 3] = radiusIpd * ipdV

      const direction = fixedDirection(app)
      uniforms.uApp1[base] = amplitudeU
      uniforms.uApp1[base + 1] = direction?.x ?? 0
      uniforms.uApp1[base + 2] = direction?.y ?? 0
      uniforms.uApp1[base + 3] = direction ? 1 : 0

      uniforms.uApp2[base] = slot
      uniforms.uApp2[base + 1] = smoothing
      uniforms.uApp2[base + 2] = 0
      uniforms.uApp2[base + 3] = 0

      if (app.technique === 'toxin' && smoothing > 0) toxin = true
      count += 1
    }

    // A escala de codificação acompanha o pior caso do conjunto. Fixa, ela
    // desperdiçaria bits numa sessão leve e cortaria numa carregada.
    this.encodeScale = Math.max(0.01, amplitudeSum * 1.25)

    uniforms.uCount = count
    uniforms.uEncodeScale = this.encodeScale
    this.uniforms.update()

    this.hasToxin = toxin
    this.dirty = true
  }

  /** Redesenha o campo se algo mudou. Devolve `true` quando desenhou. */
  rebuild(renderer: Renderer): boolean {
    if (!this.dirty) return false
    renderer.render({ container: this.container, target: this.texture, clear: true })
    this.dirty = false
    return true
  }

  markDirty(): void {
    this.dirty = true
  }

  /** As texturas de máscara pertencem ao pipeline e não são destruídas aqui. */
  destroy(): void {
    this.quad.destroy()
    this.container.destroy()
    this.filter.destroy()
    this.texture.destroy(true)
    this.maskTextures.length = 0
  }
}
