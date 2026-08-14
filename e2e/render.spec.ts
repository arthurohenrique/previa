import { expect, test } from '@playwright/test'

/**
 * Fumaça do caminho de render, num navegador de verdade.
 *
 * Existe porque os dois defeitos que já derrubaram esta tela são invisíveis para
 * o resto da suíte:
 *
 * 1. Programa GLSL que não liga. O Pixi injeta `highp` no vertex e `mediump` no
 *    fragmento; um uniform redeclarado nos dois com precisões diferentes faz o
 *    GLSL ES recusar a ligação. Resultado: tela preta, zero erro de tipo, zero
 *    erro de lint, todos os testes de unidade passando.
 * 2. Animação que sobrescreve posicionamento. Uma animação com `fill-mode: both`
 *    vence estilo inline na cascata do CSS: o último quadro apagava o
 *    `transform` que posiciona os chips e empilhava os quinze no canto da tela.
 *
 * A bancada só existe em modo de demonstração. Rode com:
 *   NEXT_PUBLIC_PREVIA_MOCK=1 pnpm build && NEXT_PUBLIC_PREVIA_MOCK=1 pnpm start
 *   E2E_BASE_URL=http://127.0.0.1:3000 pnpm test:e2e render
 */

const HARNESS = '/diagnostico/render'

test.describe('caminho de render', () => {
  test('desenha a foto e posiciona os chips, sem erro no console', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    page.on('pageerror', (error) => errors.push(error.message))

    const response = await page.goto(HARNESS)
    test.skip(
      response?.status() === 404,
      'a bancada só existe com NEXT_PUBLIC_PREVIA_MOCK=1',
    )

    await page.locator('[data-render-harness="pronto"]').waitFor({ timeout: 30_000 })
    await page.locator('canvas').waitFor({ timeout: 30_000 })
    // O render é dirigido por requestAnimationFrame; um instante para o primeiro
    // frame sair.
    await page.waitForTimeout(2500)

    // 1. Nenhum programa recusado. Sem isto o canvas fica preto em silêncio.
    expect(errors.filter((line) => /shader|program|WebGL/i.test(line))).toEqual([])
    expect(errors).toEqual([])

    // 2. Os chips existem e estão espalhados sobre a foto, não empilhados na
    //    origem.
    const chips = page.locator('button[aria-label*="Aplicar"]')
    const count = await chips.count()
    expect(count).toBeGreaterThan(8)

    const positions: Array<{ x: number; y: number }> = []
    for (let index = 0; index < count; index += 1) {
      const box = await chips.nth(index).boundingBox()
      expect(box, 'chip sem caixa').not.toBeNull()
      if (!box) continue

      // Alvo de toque de 44pt vale também sobre a foto.
      expect(box.width).toBeGreaterThanOrEqual(43.5)
      expect(box.height).toBeGreaterThanOrEqual(43.5)

      expect(box.x + box.width, 'chip fora da tela').toBeGreaterThan(0)
      positions.push({ x: Math.round(box.x), y: Math.round(box.y) })
    }

    const distinct = new Set(positions.map((point) => `${point.x},${point.y}`))
    expect(distinct.size, 'chips empilhados numa posição só').toBeGreaterThan(3)

    const atOrigin = positions.filter((point) => point.x === 0 && point.y === 0)
    expect(atOrigin, 'chip preso na origem').toEqual([])

    // 3. O canvas desenhou alguma coisa: a foto sintética tem miolo claro, e o
    //    fundo do simulador é preto.
    const centre = await page.evaluate(() => {
      const canvas = document.querySelector('canvas')
      if (!canvas) return null
      const box = canvas.getBoundingClientRect()
      return { width: box.width, height: box.height }
    })
    expect(centre?.width ?? 0).toBeGreaterThan(0)

    const shot = await page.locator('canvas').screenshot()
    // Um PNG de tela inteiramente preta comprime a quase nada. A foto sintética
    // tem gradiente e uma elipse clara, então o arquivo é ordens de grandeza
    // maior.
    expect(shot.byteLength).toBeGreaterThan(8000)
  })
})
