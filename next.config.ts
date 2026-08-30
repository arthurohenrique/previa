import type { NextConfig } from 'next'

// A prévia generativa é EXPERIMENTAL e desligada por padrão (Fase E): o
// pipeline nunca operou em produção e tem bugs conhecidos registrados em
// docs/plano-reconstrucao.md. Ligue com NEXT_PUBLIC_ENABLE_GENERATIVE=1.
const generativeEnabled = process.env.NEXT_PUBLIC_ENABLE_GENERATIVE === '1'

const nextConfig: NextConfig = {
  // O modelo generativo (~2,2GB) não cabe no git nem no deploy da Vercel.
  // Em produção, GENERATIVE_MODELS_URL aponta para um storage próprio
  // (R2/Vercel Blob); o rewrite proxeia sob o MESMO domínio — o navegador
  // nunca fala com terceiro e a restrição de assets locais é preservada.
  // Sem a env (dev), os arquivos vêm de public/models/generative.
  async rewrites() {
    const modelsUrl = process.env.GENERATIVE_MODELS_URL
    if (!generativeEnabled || !modelsUrl) return []
    return [
      {
        source: '/models/generative/:path*',
        destination: `${modelsUrl.replace(/\/$/, '')}/:path*`,
      },
    ]
  },

  // COOP/COEP habilitam SharedArrayBuffer (crossOriginIsolated), exigido
  // apenas pelo runtime ONNX multithread da geração local — por isso os
  // headers só existem com a flag ligada (isolar a origem inteira por causa
  // de um recurso experimental custa caro em integrações).
  async headers() {
    if (!generativeEnabled) return []
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
