import type { Metadata, Viewport } from 'next'
import './globals.css'
import { RegisterServiceWorker } from '@/components/RegisterServiceWorker'
import { SuppressNativeGestures } from '@/components/SuppressNativeGestures'

export const metadata: Metadata = {
  title: 'Prévia',
  description:
    'Simulador de procedimentos estéticos faciais para uso clínico. A foto do paciente não sai do dispositivo.',
  applicationName: 'Prévia',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'Prévia',
    statusBarStyle: 'black-translucent',
  },
  formatDetection: { telephone: false, date: false, email: false, address: false },
  robots: { index: false, follow: false },
}

// E-03: zoom nativo desligado. O pinch precisa ser do canvas — zoom do sistema
// durante a marcação move a foto sob o dedo e o ponto cai errado. A mitigação
// obrigatória é o Dynamic Type, que continua funcionando (ver globals.css).
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: 'rgb(255 255 255)' },
    { media: '(prefers-color-scheme: dark)', color: 'rgb(0 0 0)' },
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <SuppressNativeGestures />
        <RegisterServiceWorker />
        {children}
      </body>
    </html>
  )
}
