'use client'

/**
 * Preparo da foto antes de qualquer processamento.
 *
 * Três coisas acontecem aqui, nesta ordem, e nenhuma pode ser pulada:
 *
 * 1. HEIC do iPad vira JPEG. O Safari abre HEIC em `<img>`, mas `createImageBitmap`
 *    e o canvas não aceitam de forma confiável — e é do canvas que a detecção vive.
 * 2. O lado maior cai para 2048 px. O Safari iOS falha em silêncio com canvas
 *    grande: `getImageData` volta preto, ou o contexto morre sem erro.
 * 3. Todo o EXIF morre, GPS incluído. Redesenhar num canvas e reencodar deixa só
 *    os pixels. Foto de paciente com coordenada da clínica embutida é um dado a
 *    mais vazando por descuido.
 */

export const MAX_SIDE_PX = 2048

export interface PreparedPhoto {
  /** JPEG limpo, sem EXIF. Vai para o IndexedDB — e para lugar nenhum além dele. */
  blob: Blob
  width: number
  height: number
}

async function toRenderableBlob(file: File): Promise<Blob> {
  const looksHeic =
    /image\/hei[cf]/i.test(file.type) || /\.(heic|heif)$/i.test(file.name ?? '')

  if (!looksHeic) return file

  // Carregado sob demanda: o decodificador HEIC é grande e a maioria das fotos
  // não precisa dele.
  const { heicTo, isHeic } = await import('heic-to/next')
  if (!(await isHeic(file))) return file

  return heicTo({ blob: file, type: 'image/jpeg', quality: 0.94 })
}

async function decode(blob: Blob): Promise<ImageBitmap> {
  try {
    // `from-image` aplica a orientação do EXIF antes de descartá-lo. Sem isso a
    // foto tirada de lado entra girada e a validação de ângulo reprova por
    // rolagem que não existe.
    return await createImageBitmap(blob, { imageOrientation: 'from-image' })
  } catch {
    return createImageBitmap(blob)
  }
}

function fitWithin(width: number, height: number, maxSide: number) {
  const longest = Math.max(width, height)
  if (longest <= maxSide) return { width, height }
  const scale = maxSide / longest
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

function createCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

async function canvasToBlob(
  canvas: OffscreenCanvas | HTMLCanvasElement,
  quality: number,
): Promise<Blob> {
  if ('convertToBlob' in canvas) {
    return canvas.convertToBlob({ type: 'image/jpeg', quality })
  }
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Não foi possível gerar a imagem.'))),
      'image/jpeg',
      quality,
    )
  })
}

/** Converte, reduz e limpa. O resultado é o único formato que o resto do app vê. */
export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  const renderable = await toRenderableBlob(file)
  const source = await decode(renderable)

  try {
    const { width, height } = fitWithin(source.width, source.height, MAX_SIDE_PX)
    const canvas = createCanvas(width, height)
    const context = canvas.getContext('2d') as
      | OffscreenCanvasRenderingContext2D
      | CanvasRenderingContext2D
      | null

    if (!context) throw new Error('Canvas indisponível neste navegador.')

    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(source, 0, 0, width, height)

    const blob = await canvasToBlob(canvas, 0.92)
    return { blob, width, height }
  } finally {
    source.close()
  }
}

/** Bitmap a partir do blob já preparado. Quem chama é dono de fechar. */
export async function bitmapFromBlob(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob)
}
