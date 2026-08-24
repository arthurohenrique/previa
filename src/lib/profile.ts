/**
 * Detecção de capacidade do dispositivo e escolha do perfil de execução.
 *
 * Regra do projeto: detectar CAPACIDADE em runtime (WebGPU, cores lógicos,
 * memória quando exposta), nunca marca/modelo de aparelho. O tempo real da
 * primeira inferência entra como sinal a partir da Fase 2 (ainda não há
 * modelos nesta fase).
 */

export type ExecutionProfile = 'alto' | 'medio' | 'baixo'

export interface DeviceCapabilities {
  /** WebGPU disponível e com adapter real. */
  webgpu: boolean
  /** Núcleos lógicos (navigator.hardwareConcurrency). */
  cores: number
  /** navigator.deviceMemory em GB — só exposto em Chromium; null quando ausente. */
  memoryGB: number | null
}

/** Parâmetros derivados de cada perfil (referência para as próximas fases). */
export const PROFILE_PARAMS: Record<
  ExecutionProfile,
  { label: string; inferencePx: number; meshDensity: 'densa' | 'media' | 'esparsa'; segmentation: boolean }
> = {
  alto: { label: 'Alto', inferencePx: 1280, meshDensity: 'densa', segmentation: true },
  medio: { label: 'Médio', inferencePx: 1024, meshDensity: 'media', segmentation: true },
  baixo: { label: 'Baixo', inferencePx: 720, meshDensity: 'esparsa', segmentation: false },
}

/**
 * Função pura: capacidades -> perfil.
 * - Memória baixa domina (≤ 2 GB não sustenta os modelos, mesmo com GPU).
 * - Alto exige WebGPU + 8 cores; médio exige 4 cores; o resto é baixo.
 */
export function pickProfile(caps: DeviceCapabilities): ExecutionProfile {
  if (caps.memoryGB !== null && caps.memoryGB <= 2) return 'baixo'
  if (caps.webgpu && caps.cores >= 8) return 'alto'
  if (caps.cores >= 4) return 'medio'
  return 'baixo'
}

/** Lê as capacidades reais do navegador. Nunca lança: falha vira capacidade ausente. */
export async function detectCapabilities(): Promise<DeviceCapabilities> {
  const nav = navigator as Navigator & { deviceMemory?: number }

  let webgpu = false
  // navigator.gpu só existe onde há WebGPU (o tipo vem de @webgpu/types).
  const gpu = (navigator as { gpu?: GPU }).gpu
  if (gpu !== undefined) {
    try {
      webgpu = (await gpu.requestAdapter()) !== null
    } catch {
      webgpu = false
    }
  }

  return {
    webgpu,
    cores: nav.hardwareConcurrency ?? 2,
    memoryGB: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
  }
}
