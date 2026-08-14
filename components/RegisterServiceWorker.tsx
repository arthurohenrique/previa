'use client'

import { useEffect } from 'react'

/**
 * PWA instalável. O service worker guarda o shell, o modelo `.task` e o runtime
 * WASM — a clínica precisa funcionar com Wi-Fi ruim, e a detecção não pode
 * depender de rede no meio de uma consulta.
 */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    if (!('serviceWorker' in navigator)) return

    const register = () => {
      void navigator.serviceWorker.register('/sw.js', { scope: '/' })
    }

    if (document.readyState === 'complete') register()
    else window.addEventListener('load', register, { once: true })
  }, [])

  return null
}
