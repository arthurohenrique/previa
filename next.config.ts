import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // O modelo generativo (~2,2GB) não cabe no git nem no deploy da Vercel.
  // Em produção, GENERATIVE_MODELS_URL aponta para um storage próprio
  // (R2/Vercel Blob); o rewrite proxeia sob o MESMO domínio — o navegador
  // nunca fala com terceiro e a restrição de assets locais é preservada.
  // Sem a env (dev), os arquivos vêm de public/models/generative.
  async rewrites() {
    const modelsUrl = process.env.GENERATIVE_MODELS_URL
    if (!modelsUrl) return []
    return [
      {
        source: '/models/generative/:path*',
        destination: `${modelsUrl.replace(/\/$/, '')}/:path*`,
      },
    ]
  },

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
