import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import type { NextConfig } from 'next'

// Cabeçalhos: a câmera é liberada só na própria origem e nada mais. O resto das
// permissions policies fica negado — o Prévia não usa geolocalização, microfone
// nem sensores, e negar explicitamente reduz o que um script injetado poderia
// alcançar num tablet compartilhado da clínica.
const PERMISSIONS_POLICY = [
  'camera=(self)',
  'microphone=()',
  'geolocation=()',
  'accelerometer=()',
  'gyroscope=()',
  'magnetometer=()',
  'usb=()',
  'payment=()',
  'interest-cohort=()',
].join(', ')

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Sem isto o Turbopack sobe a árvore procurando um lockfile e adota o
  // diretório do usuário como raiz do projeto — o que muda o que entra no
  // bundle dependendo da máquina.
  turbopack: { root: dirname(fileURLToPath(import.meta.url)) },

  // O modelo .task e o runtime WASM são imutáveis por versão de deploy: cache
  // agressivo é o que permite a PWA abrir offline num Wi-Fi ruim.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Permissions-Policy', value: PERMISSIONS_POLICY },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
      {
        source: '/models/:path*.task',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
          { key: 'Content-Type', value: 'application/octet-stream' },
        ],
      },
      {
        source: '/mediapipe/wasm/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        // O service worker precisa poder controlar toda a origem e nunca pode
        // ficar preso em cache — senão a clínica trava numa versão antiga.
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ]
  },
}

export default nextConfig
