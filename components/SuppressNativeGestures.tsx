'use client'

import { useEffect } from 'react'

/**
 * Bloqueia o zoom nativo do Safari no iPad.
 *
 * O meta viewport sozinho não basta: o iPadOS ignora `user-scalable=no` desde o
 * iOS 10 e continua respondendo a pinch e a duplo toque. Sem isto, o gesto de
 * ampliar a foto move a página inteira sob o dedo e o ponto de aplicação cai
 * dezenas de pixels fora. O pinch de zoom é do canvas (E-03).
 */
export function SuppressNativeGestures() {
  useEffect(() => {
    const stop = (event: Event) => {
      event.preventDefault()
    }

    // `gesturestart` é WebKit-only e não existe no lib.dom padrão.
    document.addEventListener('gesturestart', stop, { passive: false })
    document.addEventListener('gesturechange', stop, { passive: false })
    document.addEventListener('gestureend', stop, { passive: false })

    let lastTouchEnd = 0
    const blockDoubleTapZoom = (event: TouchEvent) => {
      const now = event.timeStamp
      if (now - lastTouchEnd <= 320) event.preventDefault()
      lastTouchEnd = now
    }
    document.addEventListener('touchend', blockDoubleTapZoom, { passive: false })

    return () => {
      document.removeEventListener('gesturestart', stop)
      document.removeEventListener('gesturechange', stop)
      document.removeEventListener('gestureend', stop)
      document.removeEventListener('touchend', blockDoubleTapZoom)
    }
  }, [])

  return null
}
