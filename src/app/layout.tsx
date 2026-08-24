import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Prévia',
  description:
    'Simulação ilustrativa de procedimentos estéticos, processada inteiramente no dispositivo.',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // viewport-fit=cover libera as safe areas do iOS (notch / home indicator).
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fafafa' },
    { media: '(prefers-color-scheme: dark)', color: '#09090b' },
  ],
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="pt-BR">
      {/* suppressHydrationWarning: extensões de navegador injetam atributos
          no <body> antes da hidratação do React. */}
      <body
        suppressHydrationWarning
        className="h-full bg-zinc-50 text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-100"
      >
        {children}
      </body>
    </html>
  )
}
