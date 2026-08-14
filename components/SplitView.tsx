'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import { IconPeople, IconProtocol, IconSidebar } from '@/components/icons'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'

const DESTINATIONS = [
  { href: '/pacientes', label: 'Pacientes', Icon: IconPeople },
  { href: '/presets', label: 'Protocolos', Icon: IconProtocol },
] as const

interface SplitViewProps {
  professionalName: string
  council: string | null
  children: React.ReactNode
}

/**
 * Padrão de split view do iPadOS: lista à esquerda, conteúdo à direita, coluna
 * colapsável. A tela do simulador ocupa a largura inteira — a coluna some
 * sozinha porque lá o conteúdo é a foto.
 */
export function SplitView({ professionalName, council, children }: SplitViewProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [open, setOpen] = useState(true)

  const isSimulator = pathname.startsWith('/sessao/')
  const showSidebar = open && !isSimulator

  async function signOut() {
    await getSupabaseBrowserClient().auth.signOut()
    router.replace('/login')
    router.refresh()
  }

  return (
    <div className="flex h-dvh w-dvw overflow-hidden bg-background">
      {showSidebar ? (
        <nav
          aria-label="Seções"
          className="flex w-36 shrink-0 flex-col justify-between bg-grouped safe-t safe-b"
          style={{ paddingInlineStart: 'max(8px, env(safe-area-inset-left))' }}
        >
          <div className="flex flex-col gap-0.5 px-1 pt-2">
            {DESTINATIONS.map(({ href, label, Icon }) => {
              const active = pathname.startsWith(href)
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={[
                    'flex min-h-(--touch-target) items-center gap-1.5 rounded-sm px-1.5',
                    'text-body transition-colors duration-[var(--duration-fast)]',
                    active ? 'bg-fill-secondary text-label' : 'text-label-secondary',
                  ].join(' ')}
                >
                  <Icon className="shrink-0" />
                  <span className="truncate">{label}</span>
                </Link>
              )
            })}
          </div>

          <div className="flex flex-col gap-0.5 px-2 pb-2">
            <span className="truncate text-subhead text-label">{professionalName}</span>
            {council ? (
              <span className="truncate text-footnote text-label-secondary" data-numeric>
                {council}
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => void signOut()}
              className="mt-0.5 flex min-h-(--touch-target) items-center text-subhead text-accent"
            >
              Sair
            </button>
          </div>
        </nav>
      ) : null}

      <main className="relative min-w-0 flex-1">
        {!isSimulator ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? 'Ocultar a lista de seções' : 'Mostrar a lista de seções'}
            aria-expanded={open}
            className="absolute top-0 left-0 z-30 flex touch-44 items-center justify-center text-label-secondary safe-t"
          >
            <IconSidebar />
          </button>
        ) : null}
        {children}
      </main>
    </div>
  )
}
