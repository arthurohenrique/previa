/**
 * Relay efêmero do QR (emenda à restrição nº 1 no CLAUDE.md): o celular
 * envia a foto CIFRADA (POST) e o computador a busca UMA vez (GET). A chave
 * nunca passa por aqui — vive só no fragmento da URL do QR. Nada persiste
 * além do TTL; nenhum log de conteúdo.
 */

import { RELAY_ID_PATTERN } from '@/lib/relay/crypto'
import { getRelayStore, RELAY_MAX_BYTES } from '@/lib/relay/store'

type Context = { params: Promise<{ id: string }> }

function invalidId(id: string): boolean {
  return !RELAY_ID_PATTERN.test(id)
}

export async function POST(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params
  if (invalidId(id)) return new Response(null, { status: 400 })

  const declared = Number(request.headers.get('content-length') ?? 0)
  if (declared > RELAY_MAX_BYTES) return new Response(null, { status: 413 })

  const data = new Uint8Array(await request.arrayBuffer())
  if (data.length === 0) return new Response(null, { status: 400 })
  if (data.length > RELAY_MAX_BYTES) return new Response(null, { status: 413 })

  const result = await getRelayStore().put(id, data)
  if (result === 'too-large') return new Response(null, { status: 413 })
  if (result === 'exists') return new Response(null, { status: 409 })
  return new Response(null, { status: 201 })
}

export async function GET(_request: Request, context: Context): Promise<Response> {
  const { id } = await context.params
  if (invalidId(id)) return new Response(null, { status: 400 })

  const data = await getRelayStore().take(id)
  // 204 (e não 404): "ainda nada" é o caso normal do polling — 404 faria o
  // navegador poluir o console com erro a cada tentativa.
  if (data === null) return new Response(null, { status: 204 })
  return new Response(new Blob([data as BlobPart]), {
    status: 200,
    headers: {
      'content-type': 'application/octet-stream',
      'cache-control': 'no-store',
    },
  })
}
