import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LoginForm } from './LoginForm'

export const metadata: Metadata = { title: 'Entrar · Prévia' }

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center safe-x safe-b safe-t">
      <div className="w-full max-w-45">
        <h1 className="pb-1 text-large-title text-label">Prévia</h1>
        <p className="pb-4 text-body text-label-secondary">
          Simulação de procedimentos estéticos faciais. A foto do paciente não sai deste
          dispositivo.
        </p>
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  )
}
