'use client'

import Link from 'next/link'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from 'react'
import CameraView, { type CameraViewHandle } from './CameraView'
import ReceiveFromPhone from './ReceiveFromPhone'
import { preprocessPhoto } from '@/lib/image'
import { detectCapabilities, pickProfile, PROFILE_PARAMS } from '@/lib/profile'
import { selectEffectiveProfile, useSession } from '@/store/session'

type Mode = 'idle' | 'camera'

const primaryButton =
  'flex min-h-11 items-center justify-center rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white transition hover:bg-teal-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:opacity-40 dark:bg-teal-400 dark:text-zinc-950 dark:hover:bg-teal-300'

const secondaryButton =
  'flex min-h-11 items-center justify-center rounded-xl border border-zinc-300 px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:text-zinc-100'

export default function CaptureScreen() {
  const [mode, setMode] = useState<Mode>('idle')
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cameraSupported, setCameraSupported] = useState(false)
  const [panelOpen, setPanelOpen] = useState(true)

  const cameraRef = useRef<CameraViewHandle>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const workingPhotoUrl = useSession((s) => s.workingPhotoUrl)
  const photoWidth = useSession((s) => s.photoWidth)
  const photoHeight = useSession((s) => s.photoHeight)
  const detectedProfile = useSession((s) => s.detectedProfile)
  const effectiveProfile = useSession(selectEffectiveProfile)
  const setPhoto = useSession((s) => s.setPhoto)
  const setCapabilities = useSession((s) => s.setCapabilities)

  // Detecção de capacidade uma vez por sessão (runtime, nunca marca/modelo).
  useEffect(() => {
    setCameraSupported(Boolean(navigator.mediaDevices?.getUserMedia))
    if (useSession.getState().capabilities) return
    let cancelled = false
    void detectCapabilities().then((caps) => {
      if (!cancelled) setCapabilities(caps, pickProfile(caps))
    })
    return () => {
      cancelled = true
    }
  }, [setCapabilities])

  const processBlob = useCallback(
    async (blob: Blob) => {
      setProcessing(true)
      setError(null)
      try {
        const profile = selectEffectiveProfile(useSession.getState())
        setPhoto(await preprocessPhoto(blob, profile))
        setMode('idle')
      } catch {
        setError('Não foi possível processar a foto. Tente outra imagem.')
      } finally {
        setProcessing(false)
      }
    },
    [setPhoto],
  )

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) void processBlob(file)
    event.target.value = ''
  }

  const handleCapture = async () => {
    try {
      const frame = await cameraRef.current?.capture()
      if (frame) await processBlob(frame)
    } catch {
      setError('Falha ao capturar a foto. Tente novamente.')
    }
  }

  const handleCameraError = useCallback((message: string) => {
    setMode('idle')
    setError(message)
  }, [])

  const hasPhoto = workingPhotoUrl !== null

  return (
    <main className="flex h-dvh flex-col sm:flex-row">
      {/* Palco: elemento primário, nunca menor que 50% da viewport. */}
      <section className="relative min-h-0 flex-1 bg-zinc-100 dark:bg-zinc-900">
        {mode === 'camera' ? (
          <CameraView ref={cameraRef} onError={handleCameraError} />
        ) : hasPhoto ? (
          // eslint-disable-next-line @next/next/no-img-element -- object URL local
          <img
            src={workingPhotoUrl}
            alt="Foto do paciente, pronta para a simulação"
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="flex h-full items-center justify-center p-8">
            <p className="max-w-xs text-center text-sm text-zinc-500 dark:text-zinc-400">
              A foto do paciente aparecerá aqui. Ela é processada apenas neste
              dispositivo e nunca é enviada a nenhum servidor.
            </p>
          </div>
        )}

        {processing && (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/50">
            <p className="rounded-xl bg-zinc-900 px-4 py-3 text-sm font-medium text-zinc-100">
              Processando foto…
            </p>
          </div>
        )}

        {/* Recolher/expandir painel — só faz sentido no breakpoint médio. */}
        <button
          type="button"
          onClick={() => setPanelOpen((open) => !open)}
          aria-label={panelOpen ? 'Recolher painel' : 'Expandir painel'}
          className="absolute right-3 top-3 hidden min-h-11 min-w-11 items-center justify-center rounded-xl border border-zinc-300 bg-white/90 text-zinc-700 sm:flex lg:hidden dark:border-zinc-700 dark:bg-zinc-900/90 dark:text-zinc-300"
        >
          {panelOpen ? '›' : '‹'}
        </button>
      </section>

      {/* Controles: bottom sheet no celular, painel lateral do sm para cima. */}
      <aside
        className={`flex shrink-0 flex-col gap-4 border-t border-zinc-200 bg-white p-4 pb-safe sm:w-80 sm:border-l sm:border-t-0 sm:p-6 dark:border-zinc-800 dark:bg-zinc-950 ${
          panelOpen ? '' : 'sm:hidden'
        }`}
      >
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight">Prévia</h1>
          <Link
            href="/config"
            aria-label="Configurações e informações do dispositivo"
            className="flex min-h-11 min-w-11 items-center justify-center rounded-xl text-zinc-500 transition hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            <svg
              aria-hidden
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.03-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09c0 .68.4 1.3 1.03 1.56a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.26.63.88 1.03 1.56 1.03H21a2 2 0 1 1 0 4h-.09c-.68 0-1.3.4-1.51.97Z" />
            </svg>
          </Link>
        </header>

        {error && (
          <p
            role="alert"
            className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
          >
            {error}
          </p>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          className="hidden"
        />

        {mode === 'camera' ? (
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => void handleCapture()}
              disabled={processing}
              className={primaryButton}
            >
              Capturar
            </button>
            <button
              type="button"
              onClick={() => setMode('idle')}
              disabled={processing}
              className={secondaryButton}
            >
              Cancelar
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {hasPhoto && (
              <Link href="/simular" className={primaryButton}>
                Continuar para a análise
              </Link>
            )}
            {cameraSupported && (
              <button
                type="button"
                onClick={() => {
                  setError(null)
                  setMode('camera')
                }}
                disabled={processing}
                className={hasPhoto ? secondaryButton : primaryButton}
              >
                {hasPhoto ? 'Tirar outra foto' : 'Usar câmera'}
              </button>
            )}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={processing}
              className={cameraSupported || hasPhoto ? secondaryButton : primaryButton}
            >
              {hasPhoto ? 'Trocar arquivo' : 'Escolher arquivo'}
            </button>
            <ReceiveFromPhone
              onPhoto={(photo) => void processBlob(photo)}
              disabled={processing}
              buttonClassName={secondaryButton}
            />
          </div>
        )}

        {hasPhoto && photoWidth !== null && photoHeight !== null && (
          <dl className="flex flex-col gap-1 rounded-xl bg-zinc-100 p-3 text-sm dark:bg-zinc-900">
            <div className="flex justify-between">
              <dt className="text-zinc-500 dark:text-zinc-400">Imagem de trabalho</dt>
              <dd className="tabular-nums">
                {photoWidth} × {photoHeight}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-500 dark:text-zinc-400">Perfil de execução</dt>
              <dd>
                {PROFILE_PARAMS[effectiveProfile].label}
                {detectedProfile === null && ' (padrão)'}
              </dd>
            </div>
          </dl>
        )}

        <p className="mt-auto text-xs text-zinc-500 dark:text-zinc-400">
          A foto vive apenas na memória deste dispositivo e é descartada ao
          fechar a página. Metadados (incluindo GPS) são removidos na captura.
        </p>
      </aside>
    </main>
  )
}
