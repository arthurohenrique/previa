/**
 * Armazenamento efêmero do relay — SÓ bytes cifrados transitam por aqui
 * (a chave nunca chega ao servidor; ver crypto.ts e a emenda no CLAUDE.md).
 *
 * Duas implementações:
 *  - memória: dev e auto-hospedagem (`next start`, um processo);
 *  - Vercel Blob: produção serverless (instâncias não compartilham memória),
 *    selecionada automaticamente quando BLOB_READ_WRITE_TOKEN existe.
 *
 * Contrato comum: TTL curto, leitura ÚNICA (apaga ao entregar), tamanho
 * limitado.
 */

import { del, list, put } from '@vercel/blob'

/** Vida máxima de um envio aguardando o computador buscar. */
export const RELAY_TTL_MS = 2 * 60 * 1000
/** Foto sanitizada a 4096px cabe folgado; acima disso é abuso. */
export const RELAY_MAX_BYTES = 15 * 1024 * 1024

export type PutResult = 'ok' | 'exists' | 'too-large'

export interface RelayStore {
  put(id: string, data: Uint8Array): Promise<PutResult>
  /** Devolve e APAGA; null se não existe (ou expirou). */
  take(id: string): Promise<Uint8Array | null>
}

/* ------------------------------------------------------------------ */
/* Memória (dev / auto-hospedagem em processo único)                   */
/* ------------------------------------------------------------------ */

interface MemoryEntry {
  data: Uint8Array
  expiresAt: number
}

const MAX_ENTRIES = 50

export class MemoryRelayStore implements RelayStore {
  private readonly entries = new Map<string, MemoryEntry>()

  constructor(private readonly now: () => number = Date.now) {}

  private sweep(): void {
    const cutoff = this.now()
    for (const [id, entry] of this.entries) {
      if (entry.expiresAt <= cutoff) this.entries.delete(id)
    }
  }

  put(id: string, data: Uint8Array): Promise<PutResult> {
    this.sweep()
    if (data.length > RELAY_MAX_BYTES) return Promise.resolve('too-large')
    if (this.entries.has(id)) return Promise.resolve('exists')
    if (this.entries.size >= MAX_ENTRIES) {
      // Sob abuso, sacrifica o mais antigo — canal legítimo gera outro QR.
      const oldest = this.entries.keys().next().value
      if (oldest !== undefined) this.entries.delete(oldest)
    }
    this.entries.set(id, { data, expiresAt: this.now() + RELAY_TTL_MS })
    return Promise.resolve('ok')
  }

  take(id: string): Promise<Uint8Array | null> {
    this.sweep()
    const entry = this.entries.get(id)
    if (entry === undefined) return Promise.resolve(null)
    this.entries.delete(id)
    return Promise.resolve(entry.data)
  }
}

/* ------------------------------------------------------------------ */
/* Vercel Blob (produção serverless)                                   */
/* ------------------------------------------------------------------ */

const BLOB_PREFIX = 'relay/'

/**
 * O conteúdo é ciphertext AES-GCM e a URL do blob tem sufixo aleatório —
 * mesmo pública, é ilegível e inencontrável. TTL verificado no `uploadedAt`
 * e limpeza dos expirados feita de carona em cada put.
 */
export class BlobRelayStore implements RelayStore {
  async put(id: string, data: Uint8Array): Promise<PutResult> {
    if (data.length > RELAY_MAX_BYTES) return 'too-large'
    const existing = await list({ prefix: BLOB_PREFIX + id, limit: 1 })
    if (existing.blobs.length > 0) {
      if (Date.now() - existing.blobs[0].uploadedAt.getTime() < RELAY_TTL_MS) return 'exists'
      await del(existing.blobs[0].url)
    }
    await put(BLOB_PREFIX + id, Buffer.from(data), {
      access: 'public',
      contentType: 'application/octet-stream',
      cacheControlMaxAge: 0,
      addRandomSuffix: true,
    })
    void this.cleanupExpired()
    return 'ok'
  }

  async take(id: string): Promise<Uint8Array | null> {
    const found = await list({ prefix: BLOB_PREFIX + id, limit: 1 })
    const blob = found.blobs[0]
    if (blob === undefined) return null
    if (Date.now() - blob.uploadedAt.getTime() >= RELAY_TTL_MS) {
      await del(blob.url)
      return null
    }
    const response = await fetch(blob.url, { cache: 'no-store' })
    if (!response.ok) return null
    const data = new Uint8Array(await response.arrayBuffer())
    await del(blob.url)
    return data
  }

  private async cleanupExpired(): Promise<void> {
    try {
      const all = await list({ prefix: BLOB_PREFIX, limit: 100 })
      const cutoff = Date.now() - RELAY_TTL_MS
      const expired = all.blobs.filter((blob) => blob.uploadedAt.getTime() < cutoff)
      if (expired.length > 0) await del(expired.map((blob) => blob.url))
    } catch {
      // Limpeza é melhor esforço; o TTL no take garante a correção.
    }
  }
}

/* ------------------------------------------------------------------ */

let instance: RelayStore | null = null

/** Blob quando o token existe (Vercel); memória no dev/auto-hospedagem. */
export function getRelayStore(): RelayStore {
  if (instance === null) {
    instance = process.env.BLOB_READ_WRITE_TOKEN ? new BlobRelayStore() : new MemoryRelayStore()
  }
  return instance
}
