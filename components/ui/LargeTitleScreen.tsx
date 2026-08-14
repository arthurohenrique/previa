'use client'

import { useEffect, useRef, useState } from 'react'

interface LargeTitleScreenProps {
  title: string
  /** Ações da barra. Uma, no máximo duas. */
  actions?: React.ReactNode
  children: React.ReactNode
}

/**
 * Tela principal no padrão do iPadOS: large title de 34pt Bold no topo,
 * colapsando para o título inline de 17pt Semibold na barra ao rolar.
 *
 * A transição é dirigida por IntersectionObserver sobre o próprio título — sem
 * listener de `scroll` e sem `setState` por frame. É essa transição que faz a
 * interface parecer nativa.
 */
export function LargeTitleScreen({ title, actions, children }: LargeTitleScreenProps) {
  const sentinelRef = useRef<HTMLDivElement>(null)
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry) setCollapsed(!entry.isIntersecting)
      },
      { threshold: 0 },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [])

  return (
    <div className="flex h-full min-h-0 flex-col bg-grouped">
      <header
        className={[
          'sticky top-0 z-20 safe-t safe-x',
          collapsed ? 'material hairline-b' : 'bg-transparent',
          'transition-[background-color,border-color] duration-[var(--duration-fast)]',
          'ease-[var(--ease-out)]',
        ].join(' ')}
      >
        {/* O espaço à esquerda é do botão que colapsa a coluna (SplitView). */}
        <div className="flex min-h-(--touch-target) items-center justify-between gap-1 ps-(--touch-target)">
          <span
            aria-hidden="true"
            className={[
              'truncate text-headline text-label',
              'transition-opacity duration-[var(--duration-fast)] ease-[var(--ease-out)]',
              collapsed ? 'opacity-100' : 'opacity-0',
            ].join(' ')}
          >
            {title}
          </span>
          <div className="flex shrink-0 items-center gap-1">{actions}</div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto safe-x safe-b">
        <div ref={sentinelRef} aria-hidden="true" className="h-px" />
        <h1 className="pt-2 pb-3 text-large-title text-label">{title}</h1>
        {children}
      </div>
    </div>
  )
}
