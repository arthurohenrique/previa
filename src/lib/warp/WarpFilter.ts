/**
 * Filtro do Pixi v8 que aplica o campo inverso e a fotometria por pixel.
 *
 * Para cada pixel de saída: uv da foto → textura do campo (half-float:
 * dx, dy, shade, lift) → cor da foto em uv + disp → luminância ajustada
 * `Y' = Y·(1+shade) + lift` preservando crominância → saturação leve e
 * definição de borda onde a textura de máscara (lip, edge) manda. Uma
 * amostragem principal, sem malha, na resolução da foto. Funciona em WebGL2
 * e WebGPU (mesmo padrão do DisplacementFilter embutido).
 */

import {
  BufferImageSource,
  Filter,
  GlProgram,
  GpuProgram,
  UniformGroup,
} from 'pixi.js'
import { packField, packMask } from './halfFloat'

/** Saturação extra no vermelhão (fração) e ganho da definição de borda. */
const LIP_SATURATION = 0.12
const LIP_EDGE_GAIN = 0.2

const VERTEX_GL = `
in vec2 aPosition;
out vec2 vTextureCoord;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

vec4 filterVertexPosition(void) {
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  return vec4(position, 0.0, 1.0);
}

void main(void) {
  gl_Position = filterVertexPosition();
  vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
}
`

// highp obrigatório: um uniform usado nos dois estágios precisa da MESMA
// precisão nos dois (o vertex é highp por padrão), senão o programa não
// linka — e coordenadas de textura em 1/4096 exigem highp de qualquer modo.
const FRAGMENT_GL = `
precision highp float;

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform sampler2D uField;
uniform sampler2D uMask;

uniform highp vec4 uInputSize;
uniform highp vec4 uInputClamp;
uniform highp vec4 uOutputFrame;
uniform highp vec4 uPhoto;
uniform highp vec4 uLips;
uniform highp vec4 uCompare;

const vec3 LUMA = vec3(0.299, 0.587, 0.114);

vec2 clampCoord(vec2 coord) {
  return clamp(coord, uInputClamp.xy, uInputClamp.zw);
}

void main(void) {
  // Coordenada da textura de entrada → px do palco → uv da foto.
  vec2 worldPx = vTextureCoord * uInputSize.xy + uOutputFrame.xy;
  vec2 uv = worldPx * uPhoto.zw;
  // Antes/depois: x = 0 mostra o original; no modo dividido, à esquerda do
  // divisor (uv.x < y) também.
  float weight = uCompare.x;
  if (uCompare.z > 0.5 && uv.x < uCompare.y) weight = 0.0;
  vec4 field = texture(uField, uv) * weight;
  vec2 sourcePx = (uv + field.xy) * uPhoto.xy;
  vec2 coord = clampCoord((sourcePx - uOutputFrame.xy) * uInputSize.zw);
  vec4 color = texture(uTexture, coord);

  float luma = dot(color.rgb, LUMA);
  float adjusted = luma * (1.0 + field.z) + field.w;
  vec3 rgb = color.rgb * (adjusted / max(luma, 1e-3));

  vec2 mask = texture(uMask, uv).rg * weight;
  rgb = mix(vec3(adjusted), rgb, 1.0 + uLips.x * mask.r);
  if (mask.g > 0.002) {
    vec2 step = uInputSize.zw * 1.5;
    float around = 0.25 * (
      dot(texture(uTexture, clampCoord(coord + vec2(step.x, 0.0))).rgb, LUMA) +
      dot(texture(uTexture, clampCoord(coord - vec2(step.x, 0.0))).rgb, LUMA) +
      dot(texture(uTexture, clampCoord(coord + vec2(0.0, step.y))).rgb, LUMA) +
      dot(texture(uTexture, clampCoord(coord - vec2(0.0, step.y))).rgb, LUMA));
    float detail = uLips.y * mask.g * (luma - around);
    rgb *= (adjusted + detail) / max(adjusted, 1e-3);
  }

  finalColor = vec4(clamp(rgb, 0.0, 1.0), color.a);
}
`

const SOURCE_WGSL = `
struct GlobalFilterUniforms {
  uInputSize: vec4<f32>,
  uInputPixel: vec4<f32>,
  uInputClamp: vec4<f32>,
  uOutputFrame: vec4<f32>,
  uGlobalFrame: vec4<f32>,
  uOutputTexture: vec4<f32>,
};

struct WarpUniforms {
  uPhoto: vec4<f32>,
  uLips: vec4<f32>,
  uCompare: vec4<f32>,
};

@group(0) @binding(0) var<uniform> gfu: GlobalFilterUniforms;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var uSampler: sampler;

@group(1) @binding(0) var<uniform> warpUniforms: WarpUniforms;
@group(1) @binding(1) var uField: texture_2d<f32>;
@group(1) @binding(2) var uFieldSampler: sampler;
@group(1) @binding(3) var uMask: texture_2d<f32>;
@group(1) @binding(4) var uMaskSampler: sampler;

struct VSOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

const LUMA = vec3<f32>(0.299, 0.587, 0.114);

fn clampCoord(coord: vec2<f32>) -> vec2<f32> {
  return clamp(coord, gfu.uInputClamp.xy, gfu.uInputClamp.zw);
}

fn lumaAt(coord: vec2<f32>) -> f32 {
  return dot(textureSample(uTexture, uSampler, clampCoord(coord)).rgb, LUMA);
}

@vertex
fn mainVertex(@location(0) aPosition: vec2<f32>) -> VSOutput {
  var position = aPosition * gfu.uOutputFrame.zw + gfu.uOutputFrame.xy;
  position.x = position.x * (2.0 / gfu.uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * gfu.uOutputTexture.z / gfu.uOutputTexture.y) - gfu.uOutputTexture.z;
  return VSOutput(vec4(position, 0.0, 1.0), aPosition * (gfu.uOutputFrame.zw * gfu.uInputSize.zw));
}

@fragment
fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let worldPx = uv * gfu.uInputSize.xy + gfu.uOutputFrame.xy;
  let photoUv = worldPx * warpUniforms.uPhoto.zw;
  var weight = warpUniforms.uCompare.x;
  if (warpUniforms.uCompare.z > 0.5 && photoUv.x < warpUniforms.uCompare.y) { weight = 0.0; }
  let field = textureSample(uField, uFieldSampler, photoUv) * weight;
  let sourcePx = (photoUv + field.xy) * warpUniforms.uPhoto.xy;
  let coord = clampCoord((sourcePx - gfu.uOutputFrame.xy) * gfu.uInputSize.zw);
  let color = textureSample(uTexture, uSampler, coord);

  let luma = dot(color.rgb, LUMA);
  let adjusted = luma * (1.0 + field.z) + field.w;
  var rgb = color.rgb * (adjusted / max(luma, 1e-3));

  let mask = textureSample(uMask, uMaskSampler, photoUv).rg * weight;
  rgb = mix(vec3<f32>(adjusted), rgb, 1.0 + warpUniforms.uLips.x * mask.r);
  let step = gfu.uInputSize.zw * 1.5;
  let around = 0.25 * (
    lumaAt(coord + vec2<f32>(step.x, 0.0)) + lumaAt(coord - vec2<f32>(step.x, 0.0)) +
    lumaAt(coord + vec2<f32>(0.0, step.y)) + lumaAt(coord - vec2<f32>(0.0, step.y)));
  let detail = warpUniforms.uLips.y * mask.g * (luma - around);
  rgb = rgb * ((adjusted + detail) / max(adjusted, 1e-3));

  return vec4<f32>(clamp(rgb, vec3<f32>(0.0), vec3<f32>(1.0)), color.a);
}
`

export class WarpFilter extends Filter {
  /** Texels RGBA half do campo composto (dx, dy, shade, lift). */
  readonly fieldTexels: Uint16Array
  /** Texels RGBA8 da máscara composta (lip, edge). */
  readonly maskTexels: Uint8Array
  readonly fieldWidth: number
  readonly fieldHeight: number
  private readonly fieldSource: BufferImageSource
  private readonly maskSource: BufferImageSource

  constructor(fieldWidth: number, fieldHeight: number, photoWidth: number, photoHeight: number) {
    const texelCount = fieldWidth * fieldHeight
    const fieldTexels = new Uint16Array(texelCount * 4)
    const maskTexels = new Uint8Array(texelCount * 4)
    const fieldSource = new BufferImageSource({
      resource: fieldTexels,
      width: fieldWidth,
      height: fieldHeight,
      format: 'rgba16float',
      scaleMode: 'linear',
      addressMode: 'clamp-to-edge',
      // Dados, não cor: o alpha guarda o lift (≥ 0, quase sempre 0). Com o
      // padrão premultiply-on-upload o navegador zeraria dx/dy onde A = 0.
      alphaMode: 'no-premultiply-alpha',
      autoGenerateMipmaps: false,
      label: 'warp-field',
    })
    const maskSource = new BufferImageSource({
      resource: maskTexels,
      width: fieldWidth,
      height: fieldHeight,
      format: 'rgba8unorm',
      scaleMode: 'linear',
      addressMode: 'clamp-to-edge',
      alphaMode: 'no-premultiply-alpha',
      autoGenerateMipmaps: false,
      label: 'warp-mask',
    })

    const warpUniforms = new UniformGroup({
      uPhoto: {
        value: new Float32Array([photoWidth, photoHeight, 1 / photoWidth, 1 / photoHeight]),
        type: 'vec4<f32>',
      },
      uLips: {
        value: new Float32Array([LIP_SATURATION, LIP_EDGE_GAIN, 0, 0]),
        type: 'vec4<f32>',
      },
      uCompare: {
        value: new Float32Array([1, 0.5, 0, 0]),
        type: 'vec4<f32>',
      },
    })

    super({
      glProgram: GlProgram.from({ vertex: VERTEX_GL, fragment: FRAGMENT_GL, name: 'warp-filter' }),
      gpuProgram: GpuProgram.from({
        vertex: { source: SOURCE_WGSL, entryPoint: 'mainVertex' },
        fragment: { source: SOURCE_WGSL, entryPoint: 'mainFragment' },
      }),
      resources: {
        warpUniforms,
        uField: fieldSource,
        uFieldSampler: fieldSource.style,
        uMask: maskSource,
        uMaskSampler: maskSource.style,
      },
      padding: 0,
      resolution: 1,
      antialias: 'off',
    })

    this.fieldTexels = fieldTexels
    this.maskTexels = maskTexels
    this.fieldWidth = fieldWidth
    this.fieldHeight = fieldHeight
    this.fieldSource = fieldSource
    this.maskSource = maskSource
    this.compareUniform = warpUniforms.uniforms.uCompare as Float32Array
  }

  private readonly compareUniform: Float32Array

  /**
   * Antes/depois sem recompor nada: `showAfter = false` mostra o original;
   * `splitX` (uv 0..1) mostra o original à esquerda do divisor.
   */
  setCompare(options: { showAfter: boolean; splitX: number | null }): void {
    this.compareUniform[0] = options.showAfter ? 1 : 0
    this.compareUniform[1] = options.splitX ?? 0.5
    this.compareUniform[2] = options.splitX === null ? 0 : 1
  }

  /** Empacota o campo composto (geometria + fotometria) e envia à GPU. */
  setField(disp: Float32Array, photo: Float32Array): void {
    const texelCount = this.fieldWidth * this.fieldHeight
    packField(disp, photo, texelCount, this.fieldTexels)
    packMask(photo, texelCount, this.maskTexels)
    this.fieldSource.update()
    this.maskSource.update()
  }

  override destroy(): void {
    super.destroy()
    this.fieldSource.destroy()
    this.maskSource.destroy()
  }
}
