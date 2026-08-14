import { test as base, expect, type Page, type Request } from '@playwright/test'

/**
 * Guarda de rede: nenhum byte de imagem do paciente pode sair do dispositivo.
 *
 * O limite é pequeno de propósito. Metadado de sessão cabe em poucos kilobytes;
 * qualquer coisa maior é imagem disfarçada. Se este teste falhar, alguém quebrou
 * a regra de ouro do produto (seção 2 da especificação), e nenhuma outra falha
 * importa antes desta.
 */
export const MAX_REQUEST_BYTES = 24 * 1024

const IMAGE_CONTENT_TYPES = /image\/|multipart\/form-data|application\/octet-stream/i

export interface NetworkGuard {
  /** Requisições que violaram o limite. Deve terminar vazia. */
  violations: string[]
  /** Maior payload observado, em bytes. Útil para o relatório. */
  largest: number
}

function describe(request: Request, size: number): string {
  return `${request.method()} ${request.url()} — ${size} bytes`
}

export function installNetworkGuard(page: Page): NetworkGuard {
  const guard: NetworkGuard = { violations: [], largest: 0 }

  page.on('request', (request) => {
    const data = request.postData()
    const size = data ? Buffer.byteLength(data, 'utf8') : 0
    if (size > guard.largest) guard.largest = size

    const contentType = request.headers()['content-type'] ?? ''

    if (size > MAX_REQUEST_BYTES) {
      guard.violations.push(describe(request, size))
    }

    // Nem um payload pequeno pode se declarar imagem.
    if (IMAGE_CONTENT_TYPES.test(contentType) && request.method() !== 'GET') {
      guard.violations.push(`${describe(request, size)} — content-type ${contentType}`)
    }

    // Data URL de imagem embutida num JSON também é imagem saindo.
    if (data && /data:image\/[a-z]+;base64/i.test(data)) {
      guard.violations.push(`${describe(request, size)} — data URL de imagem no corpo`)
    }
  })

  return guard
}

interface Fixtures {
  guard: NetworkGuard
}

export const test = base.extend<Fixtures>({
  guard: async ({ page }, use) => {
    const guard = installNetworkGuard(page)
    await use(guard)
    expect(guard.violations, 'nenhum byte de imagem pode sair do dispositivo').toEqual([])
  },
})

export { expect }

export async function login(page: Page): Promise<void> {
  const email = process.env.E2E_EMAIL ?? 'aurora@previa.test'
  const password = process.env.E2E_PASSWORD ?? 'previa-dev-2026'

  await page.goto('/login')
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Senha').fill(password)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await page.waitForURL(/\/pacientes/, { timeout: 20_000 })
}
