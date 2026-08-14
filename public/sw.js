// Service worker do Prévia.
//
// A clínica precisa funcionar com Wi-Fi ruim: o modelo `.task` tem 3,6 MB e o
// runtime WASM passa de 11 MB. Baixar isso no meio de uma consulta é o mesmo
// que não funcionar.
//
// O que NÃO é cacheado, de propósito: qualquer resposta da API do Supabase.
// Metadado de paciente em cache do navegador é dado pessoal sobrevivendo à
// sessão, e a foto nunca passa por aqui porque nunca vai à rede (D-01).

const VERSION = 'previa-v1'
const SHELL_CACHE = `${VERSION}-shell`
const MODEL_CACHE = `${VERSION}-model`

const SHELL = ['/', '/pacientes', '/manifest.webmanifest', '/icons/icon-192.png']

// Imutáveis por deploy: valem cache-first e vida longa.
const IMMUTABLE = [/^\/models\/.*\.task$/, /^\/mediapipe\/wasm\//, /^\/_next\/static\//]

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE)
      await Promise.allSettled(SHELL.map((url) => cache.add(url)))
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key)),
      )
      await self.clients.claim()
    })(),
  )
})

function isImmutable(pathname) {
  return IMMUTABLE.some((pattern) => pattern.test(pathname))
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Nada da API entra em cache.
  if (url.pathname.startsWith('/api/')) return

  if (isImmutable(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(MODEL_CACHE)
        const hit = await cache.match(request)
        if (hit) return hit
        const response = await fetch(request)
        if (response.ok) cache.put(request, response.clone())
        return response
      })(),
    )
    return
  }

  // Navegação: rede primeiro, cache como rede de segurança.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request)
          const cache = await caches.open(SHELL_CACHE)
          cache.put(request, response.clone())
          return response
        } catch {
          const cache = await caches.open(SHELL_CACHE)
          return (await cache.match(request)) ?? (await cache.match('/')) ?? Response.error()
        }
      })(),
    )
  }
})
