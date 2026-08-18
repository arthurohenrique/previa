'use client'

import { useCallback, useId, useRef, useSyncExternalStore } from 'react'
import { Button } from '@/components/ui/Button'
import type { QualityIssue } from '@/lib/face/quality'

const COARSE_POINTER = '(any-pointer: coarse)'

export type CaptureProblem =
  | { kind: 'message'; message: string }
  | { kind: 'quality'; issues: QualityIssue[] }

interface PhotoCaptureProps {
  /** Ausente quando não há paciente: o simulador rodando solto, em teste. */
  patientName?: string
  /** Bloqueia as ações: carregando a sessão local ou analisando a foto. */
  busy: boolean
  /** Só a análise troca o rótulo do botão — carregar não é um estado a anunciar. */
  analyzing: boolean
  problem: CaptureProblem | null
  onFile: (file: File) => void
  /**
   * Ausente quando não há pareamento possível: a captura pelo celular precisa de
   * um paciente e de um profissional autenticado para abrir o pareamento, e o
   * simulador rodando solto não tem nem um nem outro.
   */
  onUsePhone?: (() => void) | undefined
}

/**
 * Captura e enquadramento.
 *
 * A silhueta não é decoração: ela é o que faz o profissional entregar uma foto
 * frontal na primeira tentativa, em vez de descobrir o ângulo errado depois da
 * detecção. O bloqueio de qualidade vem em seguida (E-04) e diz o que corrigir.
 */
export function PhotoCapture({
  patientName,
  busy,
  analyzing,
  problem,
  onFile,
  onUsePhone,
}: PhotoCaptureProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const inputId = useId()

  // Aparelho sem nenhum apontador grosso é computador com mouse. Não é detecção
  // de sistema operacional: o que importa é que ali a câmera, quando existe, é
  // uma webcam de monitor — e ninguém fotografa um rosto de perto com ela. Nesse
  // caso o celular vira a ação principal.
  const subscribe = useCallback((notify: () => void) => {
    const query = window.matchMedia(COARSE_POINTER)
    query.addEventListener('change', notify)
    return () => query.removeEventListener('change', notify)
  }, [])

  const onDesktop = useSyncExternalStore(
    subscribe,
    () => !window.matchMedia(COARSE_POINTER).matches,
    // No servidor não há apontador para consultar; o padrão é o tablet, que é o
    // aparelho do produto.
    () => false,
  )

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 safe-x safe-b safe-t">
      <div className="relative flex aspect-3/4 w-full max-w-50 items-center justify-center overflow-hidden rounded-lg bg-elevated">
        <svg
          viewBox="0 0 300 400"
          className="absolute inset-0 h-full w-full text-label-tertiary"
          aria-hidden="true"
        >
          <ellipse
            cx="150"
            cy="190"
            rx="92"
            ry="122"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeDasharray="10 8"
          />
          <line x1="150" y1="52" x2="150" y2="330" stroke="currentColor" strokeWidth="1" />
          <line x1="58" y1="175" x2="242" y2="175" stroke="currentColor" strokeWidth="1" />
        </svg>
        <p className="relative max-w-40 px-2 text-center text-body text-label-secondary">
          Alinhe os olhos na linha horizontal e o nariz na vertical.
        </p>
      </div>

      <div className="flex w-full max-w-50 flex-col gap-2">
        <h1 className="text-large-title text-label">
          {patientName ? `Prévia de ${patientName}` : 'Prévia'}
        </h1>

        {problem ? (
          <div role="alert" className="flex flex-col gap-0.5">
            {problem.kind === 'message' ? (
              <p className="text-body text-critical">{problem.message}</p>
            ) : (
              problem.issues.map((issue) => (
                <p key={issue.code} className="text-body text-critical">
                  {issue.message}
                </p>
              ))
            )}
          </div>
        ) : (
          <p className="text-body text-label-secondary">
            Fotografe o paciente para começar. A foto fica neste aparelho.
          </p>
        )}

        <label htmlFor={inputId} className="sr-only">
          Foto do paciente
        </label>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept="image/*"
          capture="user"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0]
            // Limpa o valor para que escolher a mesma foto de novo dispare o
            // change — sem isto, refazer a captura falha em silêncio.
            event.target.value = ''
            if (file) onFile(file)
          }}
        />

        <div className="flex flex-col gap-1">
          <Button
            variant={onDesktop && onUsePhone ? 'secondary' : 'primary'}
            disabled={busy}
            className="w-full"
            onClick={() => inputRef.current?.click()}
          >
            {analyzing ? 'Analisando' : onUsePhone ? 'Fotografar aqui' : 'Fotografar'}
          </Button>

          {onUsePhone ? (
            <Button
              variant={onDesktop ? 'primary' : 'secondary'}
              disabled={busy}
              className="w-full"
              onClick={onUsePhone}
            >
              Fotografar pelo celular
            </Button>
          ) : null}
        </div>

        {onDesktop && onUsePhone ? (
          <p className="text-footnote text-label-secondary">
            Webcam de monitor não enquadra rosto de perto. Pelo celular, a foto vem direto para
            esta tela.
          </p>
        ) : null}
      </div>
    </div>
  )
}
