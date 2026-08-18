'use client'

import Dexie, { type EntityTable } from 'dexie'
import type { RegionId, Side } from '@/lib/face/atlas'
import type { FaceGeometry } from '@/lib/face/types'
import type { Technique } from '@/lib/supabase/types'

/**
 * Banco local do dispositivo.
 *
 * A foto do paciente vive aqui e em nenhum outro lugar (D-01). O Supabase
 * conhece o UUID desta linha — `local_image_ref` — e nada além disso.
 *
 * `localStorage` está proibido para imagem: é síncrono, tem cota de poucos MB e
 * guarda string, o que forçaria base64 e inflaria a foto em 33%.
 */

export interface LocalPhoto {
  /** É o `local_image_ref` da sessão no Supabase. */
  id: string
  sessionId: string
  /** JPEG já reduzido e sem EXIF. */
  blob: Blob
  width: number
  height: number
  createdAt: number
}

/**
 * Como a foto é gravada de verdade: bytes + tipo, não Blob.
 *
 * O WebKit tem modos — navegação privada, o build headless — em que o IndexedDB
 * aceita ArrayBuffer mas recusa Blob ("Error preparing Blob/File data to be
 * stored"). Bytes gravam em todo lugar, e o Blob é reconstruído na leitura, com
 * o mesmo tipo. O resto do app continua vendo `LocalPhoto` com Blob.
 */
interface StoredPhoto {
  id: string
  sessionId: string
  bytes: ArrayBuffer
  type: string
  /** Linhas gravadas antes da troca para bytes ainda têm o Blob. */
  blob?: Blob
  width: number
  height: number
  createdAt: number
}

/** Reconstrói o Blob de uma linha, seja ela do formato novo ou do antigo. */
function toLocalPhoto(stored: StoredPhoto): LocalPhoto {
  const { bytes, type, blob, ...rest } = stored
  return {
    ...rest,
    blob: blob instanceof Blob ? blob : new Blob([bytes], { type: type || 'image/jpeg' }),
  }
}

export interface LocalSession {
  id: string
  patientId: string
  localImageRef: string
  /** Resultado congelado da detecção, para reabrir a sessão sem redetectar. */
  geometry: FaceGeometry
  createdAt: number
  /** `null` enquanto os metadados não subiram para o Supabase. */
  syncedAt: number | null
}

export interface LocalApplication {
  id: string
  sessionId: string
  regionId: RegionId
  side: Side
  technique: Technique
  pointU: number
  pointV: number
  anchorLandmark: number
  anchorOffsetU: number
  anchorOffsetV: number
  /** Adimensional 0..1. Não é dose. */
  intensity: number
  /** Fração de DIP. Nunca pixel. */
  radiusIpd: number
  createdAt: number
  syncedAt: number | null
}

class PreviaDatabase extends Dexie {
  photos!: EntityTable<StoredPhoto, 'id'>
  sessions!: EntityTable<LocalSession, 'id'>
  applications!: EntityTable<LocalApplication, 'id'>

  constructor() {
    super('previa')
    this.version(1).stores({
      photos: 'id, sessionId, createdAt',
      sessions: 'id, patientId, createdAt, syncedAt',
      applications: 'id, sessionId, createdAt, syncedAt',
    })
  }
}

let database: PreviaDatabase | null = null

export function db(): PreviaDatabase {
  database ??= new PreviaDatabase()
  return database
}

// ---------------------------------------------------------------------------
// Operações
// ---------------------------------------------------------------------------

export async function putPhoto(photo: LocalPhoto): Promise<void> {
  const { blob, ...rest } = photo
  await db().photos.put({ ...rest, bytes: await blob.arrayBuffer(), type: blob.type })
}

export async function getPhoto(id: string): Promise<LocalPhoto | undefined> {
  const stored = await db().photos.get(id)
  return stored ? toLocalPhoto(stored) : undefined
}

export async function getSession(id: string): Promise<LocalSession | undefined> {
  return db().sessions.get(id)
}

export async function putSession(session: LocalSession): Promise<void> {
  await db().sessions.put(session)
}

export async function listApplications(sessionId: string): Promise<LocalApplication[]> {
  return db().applications.where('sessionId').equals(sessionId).sortBy('createdAt')
}

/**
 * Substitui as aplicações locais da sessão pelo conjunto atual.
 *
 * O estado da sessão é uma lista, não um log de eventos: o undo/redo já vive no
 * store (zundo), e persistir o delta duplicaria a mesma verdade em dois lugares
 * que podem divergir.
 */
export async function replaceApplications(
  sessionId: string,
  applications: readonly LocalApplication[],
): Promise<void> {
  const database_ = db()
  await database_.transaction('rw', database_.applications, async () => {
    await database_.applications.where('sessionId').equals(sessionId).delete()
    if (applications.length > 0) await database_.applications.bulkPut([...applications])
  })
}

/**
 * Apaga a sessão e a foto do dispositivo. É a única forma de a imagem sumir —
 * não existe cópia em servidor para apagar depois.
 */
export async function purgeSession(sessionId: string): Promise<void> {
  const database_ = db()
  await database_.transaction(
    'rw',
    database_.photos,
    database_.sessions,
    database_.applications,
    async () => {
      await database_.photos.where('sessionId').equals(sessionId).delete()
      await database_.applications.where('sessionId').equals(sessionId).delete()
      await database_.sessions.delete(sessionId)
    },
  )
}

/** Fotos mais antigas que `days` dias. Base da limpeza periódica do tablet. */
export async function listStalePhotos(days: number): Promise<LocalPhoto[]> {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  const stale = await db().photos.where('createdAt').below(cutoff).toArray()
  return stale.map(toLocalPhoto)
}
