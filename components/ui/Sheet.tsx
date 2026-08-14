'use client'

import { useEffect, useRef } from 'react'

interface SheetProps {
  open: boolean
  title: string
  onClose: () => void
  children: React.ReactNode
}

/**
 * Folha modal. `<dialog>` nativo: foco preso, Esc fecha e o backdrop vem do
 * navegador — nenhum dos três precisa ser reimplementado.
 */
export function Sheet({ open, title, onClose, children }: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return

    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        // Clique fora da folha fecha; clique dentro não.
        if (event.target === ref.current) onClose()
      }}
      aria-label={title}
      className={[
        'm-auto w-[min(52ch,calc(100vw-48px))] rounded-xl bg-elevated p-3 text-label',
        'backdrop:bg-scrim',
      ].join(' ')}
    >
      <h2 className="pb-2 text-title3 text-label">{title}</h2>
      {children}
    </dialog>
  )
}
