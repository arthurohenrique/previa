'use client'

import { useEffect, useRef, useState } from 'react'
import CameraView, { type CameraViewHandle } from '@/components/capture/CameraView'
import { sanitizePhotoForTransfer } from '@/lib/image'
import {
  encryptPayload,
  parseChannelFragment,
  type RelayChannel,
} from '@/lib/relay/crypto'

type Status =
  | 'sem-canal'
  | 'pronto'
  | 'camera'
  | 'enviando'
  | 'enviada'
  | 'expirado'
  | 'erro'

const primaryButton =
  'flex min-h-11 items-center justify-center rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white transition hover:bg-teal-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:opacity-40 dark:bg-teal-400 dark:text-zinc-950 dark:hover:bg-teal-300'
const secondaryButton =
  'flex min-h-11 items-center justify-center rounded-xl border border-zinc-300 px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300'

/**
 * Página aberta pela câmera do celular ao ler o QR do computador.
 * O canal (id + chave) vem do FRAGMENTO da URL — nunca vai ao servidor.
 * A foto é sanitizada (EXIF/GPS fora) e cifrada AQUI antes de sair.
 */
export default function EnviarScreen() {
  const [status, setStatus] = useState<Status>('sem-canal')
  const [channel, setChannel] = useState<RelayChannel | null>(null)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const cameraRef = useRef<CameraViewHandle>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const parsed = parseChannelFragment(window.location.hash)
    if (parsed !== null) {
      setChannel(parsed)
      setStatus('pronto')
    }
  }, [])

  const send = async (photo: Blob) => {
    if (channel === null) return
    setStatus('enviando')
    setCameraError(null)
    try {
      const sanitized = await sanitizePhotoForTransfer(photo)
      const payload = await encryptPayload(
        new Uint8Array(await sanitized.arrayBuffer()),
        channel.keyBase64,
      )
      const response = await fetch(`/api/relay/${channel.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: new Blob([payload as BlobPart]),
      })
      if (response.status === 201) setStatus('enviada')
      else if (response.status === 409) setStatus('expirado')
      else setStatus('erro')
    } catch {
      setStatus('erro')
    }
  }

  const handleCapture = async () => {
    try {
      const frame = await cameraRef.current?.capture()
      if (frame) await send(frame)
    } catch {
      setCameraError('Falha ao capturar. Tente novamente ou use "Escolher arquivo".')
      setStatus('pronto')
    }
  }

  return (
    <main className="flex h-dvh flex-col bg-zinc-100 pt-safe pb-safe dark:bg-zinc-900">
      <section className="relative min-h-0 flex-1">
        {status === 'camera' && (
          <CameraView
            ref={cameraRef}
            onError={(message) => {
              setCameraError(message)
              setStatus('pronto')
            }}
          />
        )}
        {status !== 'camera' && (
          <div className="flex h-full items-center justify-center p-6">
            <div className="flex max-w-sm flex-col items-center gap-3 text-center">
              {status === 'sem-canal' && (
                <>
                  <h1 className="text-2xl font-bold tracking-tight">Prévia</h1>
                  <p className="text-sm text-zinc-600 dark:text-zinc-300">
                    Este link só funciona lido do QR code mostrado na tela do
                    computador. Gere o QR lá em &quot;Receber do celular&quot; e
                    escaneie de novo.
                  </p>
                </>
              )}
              {status === 'pronto' && (
                <>
                  <h1 className="text-2xl font-bold tracking-tight">Enviar foto</h1>
                  <p className="text-sm text-zinc-600 dark:text-zinc-300">
                    Tire a foto do paciente ou escolha uma da galeria. Os
                    metadados (incluindo GPS) são removidos e a foto é cifrada
                    neste aparelho antes do envio — só o computador que gerou o
                    QR consegue abri-la.
                  </p>
                </>
              )}
              {status === 'enviando' && (
                <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                  Cifrando e enviando…
                </p>
              )}
              {status === 'enviada' && (
                <>
                  <span aria-hidden className="text-4xl">✅</span>
                  <h1 className="text-xl font-bold">Foto enviada</h1>
                  <p className="text-sm text-zinc-600 dark:text-zinc-300">
                    Volte ao computador — a foto já deve ter aparecido lá. Ela
                    não fica guardada em nenhum servidor.
                  </p>
                </>
              )}
              {status === 'expirado' && (
                <>
                  <h1 className="text-xl font-bold">QR expirado ou já usado</h1>
                  <p className="text-sm text-zinc-600 dark:text-zinc-300">
                    Gere um novo QR no computador e escaneie de novo.
                  </p>
                </>
              )}
              {status === 'erro' && (
                <>
                  <h1 className="text-xl font-bold">Não foi possível enviar</h1>
                  <p className="text-sm text-zinc-600 dark:text-zinc-300">
                    Confira se o celular está na mesma rede do computador e
                    tente de novo.
                  </p>
                </>
              )}
            </div>
          </div>
        )}
      </section>

      {(status === 'pronto' || status === 'camera' || status === 'erro') && (
        <aside className="flex shrink-0 flex-col gap-2 border-t border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
          {cameraError !== null && (
            <p
              role="alert"
              className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
            >
              {cameraError}
            </p>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void send(file)
              event.target.value = ''
            }}
          />
          {status === 'camera' ? (
            <>
              <button type="button" onClick={() => void handleCapture()} className={primaryButton}>
                Capturar e enviar
              </button>
              <button type="button" onClick={() => setStatus('pronto')} className={secondaryButton}>
                Cancelar
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  setCameraError(null)
                  setStatus('camera')
                }}
                className={primaryButton}
              >
                Usar câmera
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className={secondaryButton}
              >
                Escolher arquivo
              </button>
            </>
          )}
        </aside>
      )}
    </main>
  )
}
