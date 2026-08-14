'use client'

import { forwardRef } from 'react'

type Variant = 'primary' | 'secondary' | 'plain' | 'destructive'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
}

// Cápsula para ação, alvo de 44pt sempre. A cor vem só de papel semântico.
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-on',
  secondary: 'bg-fill-secondary text-label',
  plain: 'text-accent',
  // `critical` não é um segundo acento: só aparece em destrutivo, e nunca ao
  // lado do acento na mesma tela.
  destructive: 'text-critical',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', className = '', type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={[
        'inline-flex touch-44 items-center justify-center gap-1 rounded-capsule px-2',
        'text-headline transition-[background-color,opacity] duration-[var(--duration-fast)]',
        'ease-[var(--ease-out)] active:opacity-70 disabled:opacity-30',
        VARIANTS[variant],
        className,
      ].join(' ')}
      {...props}
    />
  )
})
