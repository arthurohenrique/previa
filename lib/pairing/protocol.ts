/**
 * Protocolo do canal de dados entre celular e computador.
 *
 * Uma mensagem de controle em JSON, os pedaços binários da foto, e uma mensagem
 * de fim. O canal é ordenado e confiável, então não há número de sequência: o
 * que sai em ordem chega em ordem.
 */

/** 16 KB é o pedaço que o SCTP entrega sem fragmentar em todo navegador. */
export const CHUNK_SIZE = 16 * 1024

/**
 * Teto do que o computador aceita receber.
 *
 * A foto já chega preparada — JPEG com o lado maior em 2048 px —, então doze
 * megabytes é folga larga. O limite existe porque do outro lado do canal pode
 * haver alguém que não é o celular do profissional: sem teto, uma sequência
 * infinita de pedaços derruba a aba por consumo de memória.
 */
export const MAX_PHOTO_BYTES = 12 * 1024 * 1024

export interface PhotoMeta {
  kind: 'photo-meta'
  size: number
  mime: string
  width: number
  height: number
}

export interface PhotoEnd {
  kind: 'photo-end'
}

export type ControlMessage = PhotoMeta | PhotoEnd

export function isControlMessage(value: unknown): value is ControlMessage {
  if (typeof value !== 'object' || value === null) return false
  const kind = (value as { kind?: unknown }).kind
  return kind === 'photo-meta' || kind === 'photo-end'
}

export function parseControlMessage(raw: string): ControlMessage | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    return isControlMessage(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function isPhotoMeta(message: ControlMessage): message is PhotoMeta {
  return message.kind === 'photo-meta'
}

/** Valida o cabeçalho antes de alocar qualquer coisa. */
export function validateMeta(meta: PhotoMeta): string | null {
  if (!Number.isFinite(meta.size) || meta.size <= 0) return 'Tamanho inválido.'
  if (meta.size > MAX_PHOTO_BYTES) return 'A foto excede o tamanho aceito.'
  if (!/^image\/(jpeg|png|webp)$/.test(meta.mime)) return 'Formato de imagem não aceito.'
  if (!Number.isInteger(meta.width) || meta.width <= 0) return 'Largura inválida.'
  if (!Number.isInteger(meta.height) || meta.height <= 0) return 'Altura inválida.'
  return null
}

export function splitIntoChunks(buffer: ArrayBuffer, chunkSize = CHUNK_SIZE): ArrayBuffer[] {
  const chunks: ArrayBuffer[] = []
  for (let offset = 0; offset < buffer.byteLength; offset += chunkSize) {
    chunks.push(buffer.slice(offset, Math.min(offset + chunkSize, buffer.byteLength)))
  }
  return chunks
}

/** Acumulador de pedaços com o teto aplicado a cada chegada. */
export class PhotoAssembler {
  private readonly chunks: ArrayBuffer[] = []
  private received = 0

  constructor(private readonly meta: PhotoMeta) {}

  /** Devolve mensagem de erro, ou `null` se o pedaço foi aceito. */
  push(chunk: ArrayBuffer): string | null {
    if (this.received + chunk.byteLength > this.meta.size) {
      return 'A transferência excedeu o tamanho anunciado.'
    }
    this.chunks.push(chunk)
    this.received += chunk.byteLength
    return null
  }

  get progress(): number {
    return this.meta.size > 0 ? this.received / this.meta.size : 0
  }

  get complete(): boolean {
    return this.received === this.meta.size
  }

  finish(): { blob: Blob; width: number; height: number } | { error: string } {
    if (!this.complete) return { error: 'A transferência terminou incompleta.' }
    return {
      blob: new Blob(this.chunks, { type: this.meta.mime }),
      width: this.meta.width,
      height: this.meta.height,
    }
  }
}
