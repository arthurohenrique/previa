'use client'

import {
  Application,
  BlurFilter,
  Container,
  defaultFilterVert,
  Filter,
  GlProgram,
  ImageSource,
  RenderTexture,
  Sprite,
  Texture,
  UniformGroup,
} from 'pixi.js'
import type { RegionInstance } from '@/lib/face/atlas'
import { DisplacementField } from './displacement'
import { FIELD_SCALE } from './filters/constants'
import { SMOOTH_FRAGMENT } from './filters/smooth.frag'
import { WARP_FRAGMENT } from './filters/warp.frag'
import { buildMaskAtlas, createMaskTextures } from './masks'
import type { ResolvedApplication } from './types'

/**
 * Orquestra os passes do Pixi.
 *
 * Regras que sustentam os 16 ms:
 *
 * - A textura da foto é carregada uma vez. Nunca `texture.update()` por frame.
 * - O campo só é reconstruído quando uma aplicação muda (dirty flag).
 * - Ajustar intensidade troca uniform; não recria textura, não recria filtro.
 * - Durante o arrasto o render cai para meia resolução e volta no `pointerup`.
 * - O ticker do Pixi fica desligado: quem manda desenhar é a interação.
 */

/** Realce especular do preenchedor. Entre 3% e 8%; acima disso vira maquiagem. */
const SPECULAR_MIN = 0.03
const SPECULAR_MAX = 0.08

/** Raios dos dois borrões da separação de frequência, em fração de DIP. */
const BLUR_DETAIL_IPD = 0.035
const BLUR_BASE_IPD = 0.13

export interface PipelineOptions {
  container: HTMLElement
  photo: ImageBitmap
  ipdPx: number
  regionInstances: readonly RegionInstance[]
  /** Chamado quando o contexto WebGL é perdido e depois restaurado pelo Safari. */
  onContextRestored?: () => void
}

export class WarpPipeline {
  private app: Application | null = null
  private field: DisplacementField | null = null
  private maskTextures: Texture[] = []
  private photoTexture: Texture | null = null
  private stage: Container | null = null
  private photoSprite: Sprite | null = null

  private warpFilter: Filter | null = null
  private smoothFilter: Filter | null = null
  private warpUniforms: UniformGroup | null = null

  private blurDetail: RenderTexture | null = null
  private blurBase: RenderTexture | null = null
  private blurDirty = true

  private readonly photoWidth: number
  private readonly photoHeight: number
  private readonly ipdPx: number

  private dragging = false
  private frameRequested = false
  private destroyed = false
  private contextLost = false

  private readonly onContextRestored: (() => void) | undefined
  private detachContextHandlers: (() => void) | null = null

  private constructor(options: PipelineOptions) {
    this.photoWidth = options.photo.width
    this.photoHeight = options.photo.height
    this.ipdPx = options.ipdPx
    this.onContextRestored = options.onContextRestored
  }

  static async create(options: PipelineOptions): Promise<WarpPipeline> {
    const pipeline = new WarpPipeline(options)
    await pipeline.init(options)
    return pipeline
  }

  private async init(options: PipelineOptions): Promise<void> {
    const app = new Application()
    await app.init({
      // Só existe programa GLSL: forçar WebGL evita que o Pixi escolha WebGPU e
      // caia num shader inexistente.
      preference: 'webgl',
      background: 0x000000,
      antialias: false,
      // DPR 3 do iPad Pro triplica pixels sem ganho visível no julgamento de
      // volume. Dois já satura o que o olho separa a distância de consulta.
      resolution: Math.min(globalThis.devicePixelRatio || 1, 2),
      autoDensity: true,
      resizeTo: options.container,
      powerPreference: 'high-performance',
    })

    // O ticker fica parado: o render é dirigido pela interação, não pelo relógio.
    app.ticker.stop()
    this.app = app
    options.container.appendChild(app.canvas)
    this.attachContextHandlers(app.canvas)

    this.photoTexture = new Texture({
      source: new ImageSource({
        resource: options.photo,
        width: this.photoWidth,
        height: this.photoHeight,
        scaleMode: 'linear',
        autoGenerateMipmaps: false,
      }),
    })

    const atlas = buildMaskAtlas(
      options.regionInstances,
      this.photoWidth,
      this.photoHeight,
      this.ipdPx,
      Math.max(2, Math.round(this.photoWidth * FIELD_SCALE)),
      Math.max(2, Math.round(this.photoHeight * FIELD_SCALE)),
    )
    this.maskTextures = await createMaskTextures(atlas)

    this.field = new DisplacementField(
      { photoWidth: this.photoWidth, photoHeight: this.photoHeight, ipdPx: this.ipdPx },
      atlas,
      this.maskTextures,
    )

    this.blurDetail = RenderTexture.create({
      width: Math.max(2, Math.round(this.photoWidth / 2)),
      height: Math.max(2, Math.round(this.photoHeight / 2)),
      resolution: 1,
      scaleMode: 'linear',
    })
    this.blurBase = RenderTexture.create({
      width: Math.max(2, Math.round(this.photoWidth / 2)),
      height: Math.max(2, Math.round(this.photoHeight / 2)),
      resolution: 1,
      scaleMode: 'linear',
    })

    this.warpUniforms = new UniformGroup({
      uEncodeScale: { value: this.field.encodeScaleValue, type: 'f32' },
      uSpecular: { value: 0, type: 'f32' },
      uFieldTexel: {
        value: new Float32Array([1 / this.field.width, 1 / this.field.height]),
        type: 'vec2<f32>',
      },
    })

    this.warpFilter = new Filter({
      glProgram: GlProgram.from({
        vertex: defaultFilterVert,
        fragment: WARP_FRAGMENT,
        name: 'previa-warp',
        // Ver a nota em displacement.ts: sem isto o programa não liga.
        preferredFragmentPrecision: 'highp',
      }),
      resources: {
        warpUniforms: this.warpUniforms,
        uField: this.field.texture.source,
      },
      padding: 0,
      antialias: 'off',
    })

    this.smoothFilter = new Filter({
      glProgram: GlProgram.from({
        vertex: defaultFilterVert,
        fragment: SMOOTH_FRAGMENT,
        name: 'previa-smooth',
        preferredFragmentPrecision: 'highp',
      }),
      resources: {
        uField: this.field.texture.source,
        uBlurSmall: this.blurDetail.source,
        uBlurLarge: this.blurBase.source,
      },
      padding: 0,
      antialias: 'off',
    })
    this.smoothFilter.enabled = false

    this.photoSprite = new Sprite(this.photoTexture)
    this.photoSprite.filters = [this.warpFilter, this.smoothFilter]

    this.stage = new Container()
    this.stage.addChild(this.photoSprite)
    app.stage.addChild(this.stage)

    this.layout()
    this.field.setApplications([])
    this.requestRender()
  }

  // -------------------------------------------------------------------------
  // Contexto WebGL
  // -------------------------------------------------------------------------

  /**
   * O Safari derruba o contexto quando a aba vai para o fundo. Sem tratar, o
   * retorno é tela branca e o profissional perde a sessão na frente do paciente.
   */
  private attachContextHandlers(canvas: HTMLCanvasElement): void {
    const onLost = (event: Event) => {
      // Sem preventDefault o navegador nunca dispara o restored.
      event.preventDefault()
      this.contextLost = true
    }
    const onRestored = () => {
      this.contextLost = false
      this.onContextRestored?.()
    }

    canvas.addEventListener('webglcontextlost', onLost, false)
    canvas.addEventListener('webglcontextrestored', onRestored, false)

    this.detachContextHandlers = () => {
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('webglcontextrestored', onRestored)
    }
  }

  // -------------------------------------------------------------------------
  // Layout
  // -------------------------------------------------------------------------

  /** Encaixa a foto no container preservando a proporção (`object-fit: contain`). */
  layout(): void {
    const app = this.app
    const sprite = this.photoSprite
    const stage = this.stage
    if (!app || !sprite || !stage) return

    const width = app.screen.width
    const height = app.screen.height
    const scale = Math.min(width / this.photoWidth, height / this.photoHeight)

    sprite.width = this.photoWidth * scale
    sprite.height = this.photoHeight * scale
    stage.x = (width - sprite.width) / 2
    stage.y = (height - sprite.height) / 2
  }

  /** Retângulo ocupado pela foto dentro do canvas, em CSS pixels. */
  get photoRect(): { x: number; y: number; width: number; height: number } {
    const app = this.app
    if (!app) return { x: 0, y: 0, width: 0, height: 0 }
    const scale = Math.min(app.screen.width / this.photoWidth, app.screen.height / this.photoHeight)
    const width = this.photoWidth * scale
    const height = this.photoHeight * scale
    return { x: (app.screen.width - width) / 2, y: (app.screen.height - height) / 2, width, height }
  }

  get canvas(): HTMLCanvasElement | null {
    return this.app?.canvas ?? null
  }

  // -------------------------------------------------------------------------
  // Estado
  // -------------------------------------------------------------------------

  setApplications(applications: readonly ResolvedApplication[]): void {
    const field = this.field
    if (!field || !this.warpUniforms || !this.smoothFilter) return

    const hadToxin = field.requiresSmoothing
    field.setApplications(applications)

    const uniforms = this.warpUniforms.uniforms as { uEncodeScale: number; uSpecular: number }
    uniforms.uEncodeScale = field.encodeScaleValue

    // O especular é do preenchedor. Ele acompanha a maior intensidade em uso,
    // dentro da faixa estreita de 3% a 8%.
    const strongestFiller = applications.reduce(
      (peak, app) =>
        app.technique === 'filler' || app.technique === 'rhinomodeling'
          ? Math.max(peak, app.intensity)
          : peak,
      0,
    )
    uniforms.uSpecular =
      strongestFiller > 0 ? SPECULAR_MIN + (SPECULAR_MAX - SPECULAR_MIN) * strongestFiller : 0
    this.warpUniforms.update()

    this.smoothFilter.enabled = field.requiresSmoothing
    if (field.requiresSmoothing && !hadToxin) this.blurDirty = true

    this.requestRender()
  }

  /** Meia resolução durante o arrasto; volta ao normal no `pointerup`. */
  setDragging(dragging: boolean): void {
    if (this.dragging === dragging) return
    this.dragging = dragging

    const app = this.app
    if (!app) return

    const full = Math.min(globalThis.devicePixelRatio || 1, 2)
    const target = dragging ? Math.max(1, full / 2) : full
    app.renderer.resize(app.screen.width, app.screen.height, target)
    this.layout()
    this.field?.markDirty()
    this.blurDirty = true
    this.requestRender()
  }

  resize(): void {
    const app = this.app
    if (!app) return
    app.resize()
    this.layout()
    this.requestRender()
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  /**
   * Agenda um frame. Chamadas repetidas dentro do mesmo frame colapsam numa só —
   * é isso que permite chamar à vontade durante o `pointermove` sem estourar.
   */
  requestRender(): void {
    if (this.frameRequested || this.destroyed) return
    this.frameRequested = true
    requestAnimationFrame(() => {
      this.frameRequested = false
      this.renderNow()
    })
  }

  private rebuildBlurs(): void {
    const app = this.app
    const photo = this.photoTexture
    if (!app || !photo || !this.blurDetail || !this.blurBase) return
    if (!this.field?.requiresSmoothing || !this.blurDirty) return

    const halfScale = 0.5
    const sprite = new Sprite(photo)
    sprite.scale.set(halfScale)

    const detailStrength = Math.max(1, BLUR_DETAIL_IPD * this.ipdPx * halfScale)
    const baseStrength = Math.max(2, BLUR_BASE_IPD * this.ipdPx * halfScale)

    const detailBlur = new BlurFilter({ strength: detailStrength, quality: 3 })
    sprite.filters = [detailBlur]
    app.renderer.render({ container: sprite, target: this.blurDetail, clear: true })

    const baseBlur = new BlurFilter({ strength: baseStrength, quality: 4 })
    sprite.filters = [baseBlur]
    app.renderer.render({ container: sprite, target: this.blurBase, clear: true })

    detailBlur.destroy()
    baseBlur.destroy()
    sprite.destroy()
    this.blurDirty = false
  }

  private renderNow(): void {
    const app = this.app
    if (!app || this.destroyed || this.contextLost) return

    this.field?.rebuild(app.renderer)
    this.rebuildBlurs()
    app.render()
  }

  /**
   * Extrai o resultado como bitmap, para o antes/depois e para a ficha em PDF.
   * O canvas é lido no cliente e não vai a servidor nenhum (D-01).
   */
  async snapshot(): Promise<Blob> {
    const app = this.app
    if (!app) throw new Error('Pipeline não inicializado.')
    this.renderNow()

    const extracted = app.renderer.extract.canvas({ target: this.stage ?? app.stage })
    const canvas = extracted as unknown as HTMLCanvasElement
    if (typeof canvas.toBlob !== 'function') {
      throw new Error('Este navegador não permite exportar o canvas.')
    }

    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Falha ao gerar a imagem.'))),
        'image/jpeg',
        0.92,
      )
    })
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true

    this.detachContextHandlers?.()
    this.detachContextHandlers = null

    this.field?.destroy()
    this.field = null

    for (const texture of this.maskTextures) {
      if (texture !== Texture.EMPTY) texture.destroy(true)
    }
    this.maskTextures = []

    this.blurDetail?.destroy(true)
    this.blurBase?.destroy(true)
    this.blurDetail = null
    this.blurBase = null

    this.warpFilter?.destroy()
    this.smoothFilter?.destroy()
    this.warpFilter = null
    this.smoothFilter = null

    this.photoTexture?.destroy(true)
    this.photoTexture = null

    this.app?.destroy({ removeView: true }, { children: true })
    this.app = null
  }
}
