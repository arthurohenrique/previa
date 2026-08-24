/**
 * Declarações locais para @aislamov/diffusers.js 0.9.x: o pacote publica
 * .d.ts, mas o "exports" do package.json não os expõe — o TS não resolve.
 * Tipamos aqui apenas a superfície usada pelo worker de geração.
 */

declare module '@aislamov/diffusers.js' {
  export interface ProgressDownloadStatus {
    file: string
    size: number
    downloaded: number
  }

  export interface ProgressCallbackPayload {
    status: 'Downloading' | 'Ready' | 'Error' | 'EncodingImg2Img' | 'EncodingPrompt' | 'RunningUnet' | 'RunningVae' | 'Done'
    downloadStatus?: ProgressDownloadStatus
    statusText?: string
    unetTotalSteps?: number
    unetTimestep?: number
  }

  export type ProgressCallback = (payload: ProgressCallbackPayload) => Promise<void>

  export interface PretrainedOptions {
    revision?: string
    progressCallback?: ProgressCallback
  }

  export interface StableDiffusionInput {
    prompt: string
    negativePrompt?: string
    guidanceScale?: number
    seed?: string
    width?: number
    height?: number
    numInferenceSteps: number
    sdV1?: boolean
    progressCallback?: ProgressCallback
    runVaeOnEachStep?: boolean
    img2imgFlag?: boolean
    inputImage?: Float32Array
    strength?: number
  }

  export interface GeneratedImage {
    data: Float32Array
    dims: number[]
  }

  /** Superfície comum aos pipelines devolvidos pelo dispatcher. */
  export interface ImagePipeline {
    run(input: StableDiffusionInput): Promise<GeneratedImage[]>
  }

  /** Dispatcher: lê model_index.json e instancia o pipeline correto (SD/LCM). */
  export class DiffusionPipeline {
    static fromPretrained(
      modelRepoOrPath: string,
      options?: PretrainedOptions,
    ): Promise<ImagePipeline>
  }

  export function setModelCacheDir(dir: string): void
}

declare module '@aislamov/onnxruntime-web64' {
  export const env: {
    wasm: {
      wasmPaths: string
      numThreads?: number
      proxy?: boolean
    }
  }
}
