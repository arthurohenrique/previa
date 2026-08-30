/**
 * Campo por região — a saída da Fase A/C, consumida pelo filtro de warp na
 * GPU (Fase B) e pela exportação em alta.
 *
 * Geometria: campo INVERSO (backward). Para cada pixel de SAÍDA y ele diz de
 * onde vem a cor, fonte = y + t·disp(y). Obtém-se rasterizando o MLS com os
 * controles trocados (q → p): exato nos landmarks, suave e linear em t.
 *
 * Fotometria (Fase C): quatro canais na mesma grade — `shade` (ganho de
 * luminância lambertiano, sinalizado), `lift` (luminância somada pelo
 * shadow lift), `lip` e `edge` (bandas do vermelhão). Também lineares em t.
 *
 * Rasterizado UMA vez por região na intensidade 1, em unidades normalizadas
 * pela foto, para o mesmo buffer servir a qualquer resolução de saída.
 */

import type { RegionId } from '@/lib/anatomy'
import type { LightDirection } from '@/lib/photometric/light'
import { lipBands } from '@/lib/photometric/lips'
import { boxBlurFloat, type LumaImage } from '@/lib/photometric/luma'
import { heightMap, lambertShade } from '@/lib/photometric/shade'
import { shadowLift } from '@/lib/photometric/shadowLift'
import type { ExecutionProfile } from '@/lib/profile'
import type { Point2 } from '@/lib/quality'
import { boxBlurAlpha, FACE_CLASSES, smoothClassAlpha, type LabelMap } from '@/lib/segmentation/mask'
import { buildFaceFrame, type FaceFrame } from './frame'
import { rasterizeMls, type ControlPoint } from './mls'
import { regionAlpha } from './regionMask'
import { sampleAlpha, sampleField } from './sample'
import { buildControlPoints, REGION_TEMPLATES } from './templates'

/** Canais do buffer fotométrico, intercalados por texel. */
export const PHOTO_CHANNELS = 4

export interface RegionField {
  width: number
  height: number
  /** [dx, dy, …] em fração da largura/altura da foto, intensidade 1, INVERSO. */
  disp: Float32Array
  /** [shade, lift, lip, edge, …] na intensidade 1 (zeros sem fotometria). */
  photo: Float32Array
}

/** Luminância da foto e direção de luz, ambas por foto (não por região). */
export interface PhotometricInput {
  /** Na resolução do campo. */
  luma: LumaImage
  light: LightDirection
}

/** Lado maior da grade do campo por perfil de execução. */
export const FIELD_MAX_SIDE: Record<ExecutionProfile, number> = {
  alto: 512,
  medio: 512,
  baixo: 256,
}

/**
 * Strain (|∂d/∂x| em px/px) acima do qual a textura esticada/comprimida
 * fica visível — guardrail estético dos templates, medido pelos testes.
 */
export const MAX_STRAIN = 0.5

/** Classes que compõem "rosto" para o confinamento das regiões interiores. */
export const FACE_CONFINEMENT_CLASSES = [
  FACE_CLASSES.skin,
  FACE_CLASSES.nose,
  FACE_CLASSES.u_lip,
  FACE_CLASSES.l_lip,
  FACE_CLASSES.mouth,
  FACE_CLASSES.l_eye,
  FACE_CLASSES.r_eye,
  FACE_CLASSES.l_brow,
  FACE_CLASSES.r_brow,
  FACE_CLASSES.eye_g,
]

/** Raio do blur da máscara de confinamento (× interocular, em px da máscara). */
const CONFINEMENT_BLUR = 0.08
/** Quanto a silhueta pode avançar sobre o fundo nas regiões livres (× interocular). */
const FREE_DILATION = 0.2
/** Alcance da influência de uma região além da sua própria máscara (× interocular). */
const INFLUENCE_DILATION = 0.4
/** Raios do shadow lift (× interocular): baixa frequência local e vizinhança. */
const LIFT_SMALL = 0.04
const LIFT_LARGE = 0.12
/** Largura da banda de borda do vermelhão (× interocular). */
const LIP_EDGE = 0.02

/** Grade proporcional à foto com o lado maior = maxSide. */
export function fieldDimensions(
  photoWidth: number,
  photoHeight: number,
  maxSide: number,
): { width: number; height: number } {
  const scale = maxSide / Math.max(photoWidth, photoHeight)
  return {
    width: Math.max(2, Math.round(photoWidth * scale)),
    height: Math.max(2, Math.round(photoHeight * scale)),
  }
}

/**
 * Dilata um alpha por `radius` px (qualquer cobertura dentro da janela vira
 * 1 — dilatação exata em distância de Chebyshev, válida também para formas
 * finas como o vermelhão) e suaviza a borda com um blur de radius/2: platô
 * até ~radius/2 fora da forma original, zero a ~1,5·radius.
 */
export function dilateAlpha(
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
): Uint8ClampedArray {
  const source = new Float32Array(alpha.length)
  for (let i = 0; i < alpha.length; i++) source[i] = alpha[i] > 0 ? 1 : 0
  const coverage = boxBlurFloat(source, width, height, radius)
  const wide = new Uint8ClampedArray(alpha.length)
  for (let i = 0; i < wide.length; i++) wide[i] = coverage[i] > 1e-6 ? 255 : 0
  return boxBlurAlpha(wide, width, height, Math.max(1, Math.round(radius / 2)))
}

/** Multiplica o campo por um alpha na resolução da máscara. */
function multiplyByAlpha(field: RegionField, alpha: Uint8ClampedArray, map: LabelMap): void {
  for (let j = 0; j < field.height; j++) {
    const v = (j + 0.5) / field.height
    for (let i = 0; i < field.width; i++) {
      const u = (i + 0.5) / field.width
      const weight = sampleAlpha(alpha, map.width, map.height, u, v)
      const offset = (j * field.width + i) * 2
      field.disp[offset] *= weight
      field.disp[offset + 1] *= weight
    }
  }
}

/**
 * Confinamento ao rosto. Regiões interiores ('rosto'): alpha suavizado do
 * rosto — fundo, cabelo e roupa nunca se movem. Regiões livres ('livre',
 * mento e malar): o mesmo alpha DILATADO — a silhueta pode avançar sobre o
 * fundo próximo, mas cabelo, orelha e roupa distantes ficam parados.
 */
export function confineToFace(
  field: RegionField,
  map: LabelMap,
  frame: FaceFrame,
  mode: 'rosto' | 'livre' = 'rosto',
): void {
  const interocularMapPx = (frame.scale / frame.width) * map.width
  const radius = Math.max(1, Math.round(interocularMapPx * CONFINEMENT_BLUR))
  let alpha = smoothClassAlpha(map, FACE_CONFINEMENT_CLASSES, radius)
  if (mode === 'livre') {
    alpha = dilateAlpha(alpha, map.width, map.height, Math.max(2, Math.round(interocularMapPx * FREE_DILATION)))
  }
  multiplyByAlpha(field, alpha, map)
}

/**
 * Influência: o MLS tem cauda longa (pesos 1/d²), e um deslocamento
 * sub-pixel espalhado pelo rosto inteiro aparece como "respiração" na
 * comparação antes/depois. Zera o campo além da máscara da região dilatada.
 */
export function limitInfluence(
  field: RegionField,
  alpha: Uint8ClampedArray,
  map: LabelMap,
  frame: FaceFrame,
): void {
  const interocularMapPx = (frame.scale / frame.width) * map.width
  const dilated = dilateAlpha(alpha, map.width, map.height, Math.max(2, Math.round(interocularMapPx * INFLUENCE_DILATION)))
  multiplyByAlpha(field, dilated, map)
}

/** Controles do warp inverso: o destino vira origem. */
export function invertControls(controls: readonly ControlPoint[]): ControlPoint[] {
  return controls.map((control) => ({ p: control.q, q: control.p }))
}

/** Reamostra um alpha da resolução da máscara para a grade do campo. */
function resampleAlpha(
  alpha: Uint8ClampedArray,
  map: LabelMap,
  width: number,
  height: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height)
  for (let j = 0; j < height; j++) {
    const v = (j + 0.5) / height
    for (let i = 0; i < width; i++) {
      out[j * width + i] = Math.round(sampleAlpha(alpha, map.width, map.height, (i + 0.5) / width, v) * 255)
    }
  }
  return out
}

/**
 * Canais fotométricos da região na grade do campo. `interocular` em px do
 * campo define todas as escalas.
 */
export function buildPhotometric(
  region: RegionId,
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
  interocular: number,
  input: PhotometricInput,
  out: Float32Array,
): void {
  if (input.luma.width !== width || input.luma.height !== height) {
    throw new Error('Luminância precisa estar na resolução do campo.')
  }
  const spec = REGION_TEMPLATES[region].photometric
  const count = width * height

  const shade = new Float32Array(count)
  if (spec.shadeGain > 0) {
    const ramp = Math.max(1, Math.round(spec.heightBlur * interocular))
    lambertShade(heightMap(alpha, width, height, ramp), width, height, input.light, ramp, spec.shadeGain, shade)
  }

  const lift = new Float32Array(count)
  if (spec.liftGain > 0) {
    const mask = new Float32Array(count)
    for (let i = 0; i < count; i++) mask[i] = alpha[i] / 255
    shadowLift(
      input.luma,
      mask,
      Math.max(1, Math.round(LIFT_SMALL * interocular)),
      Math.max(2, Math.round(LIFT_LARGE * interocular)),
      spec.liftGain,
      lift,
    )
  }

  const bands = spec.lips
    ? lipBands(alpha, width, height, Math.max(1, Math.round(LIP_EDGE * interocular)))
    : null

  for (let i = 0; i < count; i++) {
    const offset = i * PHOTO_CHANNELS
    out[offset] = shade[i]
    out[offset + 1] = lift[i]
    out[offset + 2] = bands ? bands.lip[i] : 0
    out[offset + 3] = bands ? bands.edge[i] : 0
  }
}

export function buildRegionField(
  region: RegionId,
  landmarks: readonly Point2[],
  map: LabelMap,
  photoWidth: number,
  photoHeight: number,
  maxSide: number,
  photometric?: PhotometricInput,
): RegionField {
  const frame = buildFaceFrame(landmarks, photoWidth, photoHeight)
  const template = REGION_TEMPLATES[region]
  const controls = invertControls(buildControlPoints(region, landmarks, frame))
  const { width, height } = fieldDimensions(photoWidth, photoHeight, maxSide)
  const disp = new Float32Array(width * height * 2)
  rasterizeMls(controls, width, height, photoWidth, photoHeight, template.alpha, disp)
  const photo = new Float32Array(width * height * PHOTO_CHANNELS)
  const field = { width, height, disp, photo }
  const mapAlpha = regionAlpha(region, landmarks, map)
  confineToFace(field, map, frame, template.confine)
  limitInfluence(field, mapAlpha, map, frame)

  if (photometric !== undefined) {
    const alpha = resampleAlpha(mapAlpha, map, width, height)
    const interocular = (frame.scale / photoWidth) * width
    buildPhotometric(region, alpha, width, height, interocular, photometric, photo)
  }
  return field
}

/**
 * Deslocamento inverso em px no pixel de saída `uv` (intensidade 1):
 * a cor mostrada ali vem de uv·foto + resultado.
 */
export function sourceOffsetAt(
  field: RegionField,
  photoWidth: number,
  photoHeight: number,
  uv: Point2,
): Point2 {
  const out = { x: 0, y: 0 }
  sampleField(field.disp, field.width, field.height, uv.x, uv.y, out)
  return { x: out.x * photoWidth, y: out.y * photoHeight }
}

/**
 * Maior derivada parcial do deslocamento (px por px) entre células vizinhas.
 * Independe da resolução da foto: unidades normalizadas × células da grade.
 */
export function maxStrain(field: RegionField): number {
  const { width, height, disp } = field
  let worst = 0
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const offset = (j * width + i) * 2
      if (i + 1 < width) {
        const right = offset + 2
        // ∂(dx·W)/∂x com espaçamento W/width → Δdx · width; idem dy com H.
        worst = Math.max(
          worst,
          Math.abs(disp[right] - disp[offset]) * width,
          Math.abs(disp[right + 1] - disp[offset + 1]) * width,
        )
      }
      if (j + 1 < height) {
        const below = offset + width * 2
        worst = Math.max(
          worst,
          Math.abs(disp[below] - disp[offset]) * height,
          Math.abs(disp[below + 1] - disp[offset + 1]) * height,
        )
      }
    }
  }
  return worst
}
