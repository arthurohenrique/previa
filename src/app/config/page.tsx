'use client'

import Link from 'next/link'
import { useEffect } from 'react'
import {
  detectCapabilities,
  pickProfile,
  PROFILE_PARAMS,
  type ExecutionProfile,
} from '@/lib/profile'
import type { SegmentationStrategy } from '@/lib/segmentation/types'
import { selectEffectiveProfile, useSession } from '@/store/session'

const PROFILES: ExecutionProfile[] = ['alto', 'medio', 'baixo']

const STRATEGIES: Array<{ value: SegmentationStrategy; label: string; detail: string }> = [
  { value: 'auto', label: 'Automática', detail: 'landmarks (a IA reprovou no portão de desempenho)' },
  { value: 'ia', label: 'IA (SegFormer)', detail: 'máscara mais fiel; modelo de 89 MB, ~20s por foto' },
  { value: 'landmarks', label: 'Landmarks', detail: 'polígonos dos 478 pontos; instantânea' },
]

export default function ConfigPage() {
  const capabilities = useSession((s) => s.capabilities)
  const detectedProfile = useSession((s) => s.detectedProfile)
  const profileOverride = useSession((s) => s.profileOverride)
  const effectiveProfile = useSession(selectEffectiveProfile)
  const setCapabilities = useSession((s) => s.setCapabilities)
  const setProfileOverride = useSession((s) => s.setProfileOverride)
  const segmentationStrategy = useSession((s) => s.segmentationStrategy)
  const setSegmentationStrategy = useSession((s) => s.setSegmentationStrategy)

  // Quem chega direto nesta rota também precisa da detecção.
  useEffect(() => {
    if (useSession.getState().capabilities) return
    let cancelled = false
    void detectCapabilities().then((caps) => {
      if (!cancelled) setCapabilities(caps, pickProfile(caps))
    })
    return () => {
      cancelled = true
    }
  }, [setCapabilities])

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-6 p-4 pt-safe pb-safe sm:p-8">
      <header className="flex items-center gap-2">
        <Link
          href="/"
          aria-label="Voltar para a captura"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-xl text-zinc-500 transition hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          <svg
            aria-hidden
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Configuração</h1>
      </header>

      <section aria-labelledby="capacidade">
        <h2 id="capacidade" className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Capacidade detectada
        </h2>
        <dl className="flex flex-col gap-1 rounded-xl bg-zinc-100 p-4 text-sm dark:bg-zinc-900">
          <div className="flex justify-between">
            <dt className="text-zinc-500 dark:text-zinc-400">WebGPU</dt>
            <dd>{capabilities === null ? '…' : capabilities.webgpu ? 'Disponível' : 'Indisponível'}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-zinc-500 dark:text-zinc-400">Núcleos lógicos</dt>
            <dd className="tabular-nums">{capabilities?.cores ?? '…'}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-zinc-500 dark:text-zinc-400">Memória (quando exposta)</dt>
            <dd className="tabular-nums">
              {capabilities === null
                ? '…'
                : capabilities.memoryGB !== null
                  ? `${capabilities.memoryGB} GB`
                  : 'não exposta'}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-zinc-500 dark:text-zinc-400">Perfil detectado</dt>
            <dd className="font-semibold">
              {detectedProfile !== null ? PROFILE_PARAMS[detectedProfile].label : '…'}
            </dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="perfil">
        <h2 id="perfil" className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Perfil de execução
        </h2>
        <div role="radiogroup" aria-label="Perfil de execução" className="flex flex-col gap-2">
          <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-zinc-300 px-4 py-2 has-checked:border-teal-700 has-checked:bg-teal-700/5 dark:border-zinc-700 dark:has-checked:border-teal-400">
            <input
              type="radio"
              name="perfil"
              checked={profileOverride === null}
              onChange={() => setProfileOverride(null)}
              className="accent-teal-700 dark:accent-teal-400"
            />
            <span className="text-sm">
              <span className="font-semibold">Automático</span>
              <span className="text-zinc-500 dark:text-zinc-400">
                {' '}
                — segue a detecção
                {detectedProfile !== null && ` (${PROFILE_PARAMS[detectedProfile].label})`}
              </span>
            </span>
          </label>

          {PROFILES.map((profile) => {
            const params = PROFILE_PARAMS[profile]
            return (
              <label
                key={profile}
                className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-zinc-300 px-4 py-2 has-checked:border-teal-700 has-checked:bg-teal-700/5 dark:border-zinc-700 dark:has-checked:border-teal-400"
              >
                <input
                  type="radio"
                  name="perfil"
                  checked={profileOverride === profile}
                  onChange={() => setProfileOverride(profile)}
                  className="accent-teal-700 dark:accent-teal-400"
                />
                <span className="text-sm">
                  <span className="font-semibold">{params.label}</span>
                  <span className="text-zinc-500 dark:text-zinc-400">
                    {' '}
                    — inferência a {params.inferencePx}px, malha {params.meshDensity}
                    {params.segmentation ? '' : ', sem segmentação'}
                  </span>
                </span>
              </label>
            )
          })}
        </div>
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          Perfil em uso: <strong>{PROFILE_PARAMS[effectiveProfile].label}</strong>.
          A escolha vale para esta sessão e afeta fotos processadas a partir de agora.
        </p>
      </section>

      <section aria-labelledby="estrategia">
        <h2
          id="estrategia"
          className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
        >
          Estratégia de segmentação
        </h2>
        <div role="radiogroup" aria-label="Estratégia de segmentação" className="flex flex-col gap-2">
          {STRATEGIES.map((strategy) => (
            <label
              key={strategy.value}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-zinc-300 px-4 py-2 has-checked:border-teal-700 has-checked:bg-teal-700/5 dark:border-zinc-700 dark:has-checked:border-teal-400"
            >
              <input
                type="radio"
                name="estrategia"
                checked={segmentationStrategy === strategy.value}
                onChange={() => setSegmentationStrategy(strategy.value)}
                className="accent-teal-700 dark:accent-teal-400"
              />
              <span className="text-sm">
                <span className="font-semibold">{strategy.label}</span>
                <span className="text-zinc-500 dark:text-zinc-400"> — {strategy.detail}</span>
              </span>
            </label>
          ))}
        </div>
      </section>
    </main>
  )
}
