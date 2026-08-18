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

  // Testar no celular apontando para o computador da clínica é o fluxo normal
  // de desenvolvimento deste produto — a webcam de monitor não serve para foto
  // de rosto. Sem liberar a origem, o dev server responde 403 para todo
  // `/_next/*` vindo do IP da rede e a página abre sem JavaScript nenhum.
  //
  // Vale só em desenvolvimento; em produção o Next ignora esta chave.
  // O casamento é por segmento separado por ponto, com curinga — não aceita
  // CIDR. Faixas privadas e nomes .local do Bonjour.
  allowedDevOrigins: ['192.168.*.*', '10.*.*.*', '172.*.*.*', '*.local'],

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
