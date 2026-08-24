/**
 * Pré-processamento da foto do paciente — tudo em memória, nada sai do
 * dispositivo (restrição de privacidade do projeto).
 *
 * browser-image-compression re-encoda a imagem via canvas: isso aplica a
 * orientação EXIF (a foto aparece "em pé" em qualquer navegador) e descarta
 * TODOS os metadados no processo — inclusive GPS (exigência LGPD).
 */

import imageCompression from 'browser-image-compression'
import type { ExecutionProfile } from './profile'

/** Maior lado da imagem de trabalho, por perfil de execução. */
export const WORKING_MAX_DIMENSION: Record<ExecutionProfile, number> = {
  alto: 1280,
  medio: 1024,
  baixo: 720,
}

/** Teto do "original" sanitizado mantido em memória para exportar em alta. */
const ORIGINAL_MAX_DIMENSION = 4096

const JPEG_QUALITY = 0.92

export interface ProcessedPhoto {
  /** Alta resolução, sem metadados — base da exportação futura. */
  original: Blob
  /** Redimensionada conforme o perfil — base da simulação. */
  working: Blob
  /** Dimensões da imagem de trabalho, já orientada. */
  width: number
  height: number
}

function toFile(input: Blob): File {
  return input instanceof File
    ? input
    : new File([input], 'captura.jpg', { type: input.type || 'image/jpeg' })
}

function sanitize(file: File, maxDimension: number): Promise<File> {
  return imageCompression(file, {
    maxWidthOrHeight: maxDimension,
    useWebWorker: true,
    // Sem libURL o worker da lib baixa o próprio script do jsdelivr em
    // runtime — proibido pela restrição de binários locais. A cópia servida
    // do nosso domínio vive em public/vendor/; recopiar ao atualizar a lib.
    libURL: '/vendor/browser-image-compression.js',
    fileType: 'image/jpeg',
    initialQuality: JPEG_QUALITY,
  })
}

/** Lê as dimensões reais (pós-orientação) de um blob de imagem. */
export async function readImageDimensions(
  blob: Blob,
): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(blob)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('Falha ao decodificar a imagem.'))
      el.src = url
    })
    return { width: img.naturalWidth, height: img.naturalHeight }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Pipeline da Fase 1: orientação corrigida + metadados removidos + duas
 * versões em memória (original em alta, trabalho no tamanho do perfil).
 */
export async function preprocessPhoto(
  input: Blob,
  profile: ExecutionProfile,
): Promise<ProcessedPhoto> {
  const file = toFile(input)
  const [original, working] = await Promise.all([
    sanitize(file, ORIGINAL_MAX_DIMENSION),
    sanitize(file, WORKING_MAX_DIMENSION[profile]),
  ])
  const { width, height } = await readImageDimensions(working)
  return { original, working, width, height }
}
