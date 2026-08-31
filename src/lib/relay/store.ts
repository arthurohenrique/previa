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

import { BlobNotFoundError, del, get, head, list, put } from '@vercel/blob'

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
 * Store criado com acesso PRIVADO (`vercel blob create-store --access
 * private`): mesmo a URL do blob exige o token — e o conteúdo é, de toda
 * forma, ciphertext AES-GCM. TTL verificado no `uploadedAt` e limpeza dos
 * expirados feita de carona em cada put.
 */
export class BlobRelayStore implements RelayStore {
  async put(id: string, data: Uint8Array): Promise<PutResult> {
    if (data.length > RELAY_MAX_BYTES) return 'too-large'
    const pathname = BLOB_PREFIX + id
    try {
      const existing = await head(pathname)
      if (Date.now() - existing.uploadedAt.getTime() < RELAY_TTL_MS) return 'exists'
      await del(pathname)
    } catch (error) {
      if (!(error instanceof BlobNotFoundError)) throw error
    }
    await put(pathname, Buffer.from(data), {
      access: 'private',
      contentType: 'application/octet-stream',
      cacheControlMaxAge: 0,
      addRandomSuffix: false,
      allowOverwrite: true,
    })
    void this.cleanupExpired()
    return 'ok'
  }

  async take(id: string): Promise<Uint8Array | null> {
    const pathname = BLOB_PREFIX + id
    const result = await get(pathname, { access: 'private', useCache: false })
    if (result === null || result.statusCode !== 200) return null
    if (Date.now() - result.blob.uploadedAt.getTime() >= RELAY_TTL_MS) {
      await del(pathname)
      return null
    }
    const data = new Uint8Array(await new Response(result.stream).arrayBuffer())
    await del(pathname)
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
