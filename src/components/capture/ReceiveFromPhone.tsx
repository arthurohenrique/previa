'use client'

import QRCode from 'qrcode'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  channelFragment,
  createChannel,
  decryptPayload,
  type RelayChannel,
} from '@/lib/relay/crypto'
import { RELAY_TTL_MS } from '@/lib/relay/store'

const POLL_INTERVAL_MS = 2500

const secondaryButton =
  'flex min-h-11 items-center justify-center rounded-xl border border-zinc-300 px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:text-zinc-100'

interface ReceiveFromPhoneProps {
  /** Recebe a foto já decifrada (JPEG sanitizado no celular). */
  onPhoto: (photo: Blob) => void
  disabled?: boolean
  /** Estilo do botão que abre o painel (herda o do CaptureScreen). */
  buttonClassName: string
}

interface OpenPanel {
  channel: RelayChannel
  url: string
  qrDataUrl: string
  expiresAt: number
}

type PanelStatus = 'aguardando' | 'recebendo' | 'expirado' | 'erro'

/**
 * "Receber do celular": mostra um QR cuja URL carrega, no FRAGMENTO, o id do
 * canal e a chave de decifração — o servidor nunca vê a chave. Fica em
 * polling até o celular enviar; decifra aqui e entrega ao fluxo normal.
 */
export default function ReceiveFromPhone({
  onPhoto,
  disabled,
  buttonClassName,
}: ReceiveFromPhoneProps) {
  const [panel, setPanel] = useState<OpenPanel | null>(null)
  const [status, setStatus] = useState<PanelStatus>('aguardando')
  const [copied, setCopied] = useState(false)
  const busyRef = useRef(false)

  const open = async () => {
    const channel = await createChannel()
    const url = `${window.location.origin}/enviar#${channelFragment(channel)}`
    const qrDataUrl = await QRCode.toDataURL(url, {
      width: 480,
      margin: 1,
      errorCorrectionLevel: 'M',
    })
    setStatus('aguardando')
    setCopied(false)
    setPanel({ channel, url, qrDataUrl, expiresAt: Date.now() + RELAY_TTL_MS })
  }

  const close = useCallback(() => {
    setPanel(null)
    setStatus('aguardando')
  }, [])

  // Polling: 404 = ainda nada; 200 = ciphertext pronto para decifrar.
  useEffect(() => {
    if (panel === null || status !== 'aguardando') return
    const interval = setInterval(() => {
      void (async () => {
        if (busyRef.current) return
        if (Date.now() > panel.expiresAt) {
          setStatus('expirado')
          return
        }
        busyRef.current = true
        try {
          const response = await fetch(`/api/relay/${panel.channel.id}`, {
            cache: 'no-store',
          })
          if (response.status === 204) return
          if (!response.ok) {
            setStatus('erro')
            return
          }
          setStatus('recebendo')
          const payload = new Uint8Array(await response.arrayBuffer())
          const plain = await decryptPayload(payload, panel.channel.keyBase64)
          onPhoto(new Blob([plain as BlobPart], { type: 'image/jpeg' }))
          close()
        } catch {
          setStatus('erro')
        } finally {
          busyRef.current = false
        }
      })()
    }, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [panel, status, onPhoto, close])

  const localOnly =
    typeof window !== 'undefined' &&
    ['localhost', '127.0.0.1'].includes(window.location.hostname)

  return (
    <>
      <button
        type="button"
        onClick={() => void open()}
        disabled={disabled}
        className={buttonClassName}
      >
        Receber do celular
      </button>

      {panel !== null && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Receber foto do celular"
          className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/60 p-4"
        >
          <div className="flex w-full max-w-sm flex-col gap-3 rounded-2xl bg-white p-5 dark:bg-zinc-900">
            <h2 className="text-lg font-bold tracking-tight">Receber do celular</h2>

            {status !== 'expirado' && status !== 'erro' && (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element -- data URL local */}
                <img
                  src={panel.qrDataUrl}
                  alt="QR code para abrir a página de envio no celular"
                  data-relay-url={panel.url}
                  className="mx-auto aspect-square w-full max-w-64 rounded-xl border border-zinc-200 dark:border-zinc-700"
                />
                <p aria-live="polite" className="text-sm text-zinc-600 dark:text-zinc-300">
                  {status === 'recebendo'
                    ? 'Recebendo a foto…'
                    : 'Aponte a câmera do celular para o QR. A foto é cifrada no celular e só este computador consegue abri-la; nada fica em servidor.'}
                </p>
                {localOnly && (
                  <p className="rounded-xl border border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
                    Você está acessando por &quot;localhost&quot; — o celular não
                    alcança este endereço. Abra o app pelo IP da máquina na rede
                    (ex.: http://192.168.x.x:3000) e gere o QR de novo.
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(panel.url)
                    setCopied(true)
                  }}
                  className={secondaryButton}
                >
                  {copied ? 'Link copiado' : 'Copiar link (enviar por mensagem)'}
                </button>
              </>
            )}

            {status === 'expirado' && (
              <p className="text-sm text-zinc-600 dark:text-zinc-300">
                O QR expirou (validade de 2 minutos). Gere um novo.
              </p>
            )}
            {status === 'erro' && (
              <p
                role="alert"
                className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
              >
                Não foi possível receber a foto. Gere um novo QR e tente de novo.
              </p>
            )}

            <div className="flex gap-2">
              {(status === 'expirado' || status === 'erro') && (
                <button type="button" onClick={() => void open()} className={`${secondaryButton} flex-1`}>
                  Gerar novo QR
                </button>
              )}
              <button type="button" onClick={close} className={`${secondaryButton} flex-1`}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
