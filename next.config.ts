import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // COOP/COEP habilitam SharedArrayBuffer (crossOriginIsolated), exigido
  // pelo runtime ONNX multithread da geração local. Todos os assets são
  // servidos do próprio domínio, então require-corp não bloqueia nada.
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
        ],
      },
    ]
  },
}

export default nextConfig
