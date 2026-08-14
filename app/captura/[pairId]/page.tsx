import type { Metadata } from 'next'
import { PhoneCapture } from './PhoneCapture'

export const metadata: Metadata = {
  title: 'Fotografar · Prévia',
  robots: { index: false, follow: false },
}

/**
 * Tela do celular.
 *
 * Rota pública: quem escaneia o QR não faz login. A autorização é a posse do
 * identificador — 128 bits aleatórios, cinco minutos de validade, queimado
 * quando o pareamento se completa.
 *
 * A foto tirada aqui não é gravada neste aparelho e não sobe para servidor
 * nenhum: ela existe em memória o tempo de atravessar o canal de dados até o
 * computador que mostrou o QR.
 */
export default async function CapturePage({
  params,
}: {
  params: Promise<{ pairId: string }>
}) {
  const { pairId } = await params
  return <PhoneCapture pairId={pairId} />
}
