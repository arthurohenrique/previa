'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useId, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'

export function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const emailId = useId()
  const passwordId = useId()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)

    const supabase = getSupabaseBrowserClient()
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })

    if (signInError) {
      // Erro diz o que corrigir, sem pedir desculpa e sem vaguidade.
      setError('E-mail ou senha não conferem. Verifique e tente de novo.')
      setBusy(false)
      return
    }

    const next = params.get('next')
    router.replace(next && next.startsWith('/') ? next : '/pacientes')
    router.refresh()
  }

  const field =
    'w-full rounded-sm bg-elevated px-2 py-1.5 text-body text-label placeholder:text-label-tertiary'

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <label htmlFor={emailId} className="text-subhead text-label-secondary">
          E-mail
        </label>
        <input
          id={emailId}
          type="email"
          inputMode="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={field}
        />
      </div>

      <div className="flex flex-col gap-0.5">
        <label htmlFor={passwordId} className="text-subhead text-label-secondary">
          Senha
        </label>
        <input
          id={passwordId}
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={field}
        />
      </div>

      {error ? (
        <p role="alert" className="text-subhead text-critical">
          {error}
        </p>
      ) : null}

      <Button type="submit" variant="primary" disabled={busy} className="mt-1 w-full">
        {busy ? 'Entrando' : 'Entrar'}
      </Button>
    </form>
  )
}
