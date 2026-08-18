import { expect, test, type Page } from '@playwright/test'

/**
 * A função principal do produto, no caminho que o produto usa.
 *
 * `e2e/warp.spec.ts` já provava que o pipeline de warp desloca pixel. Provava
 * alimentando o pipeline à mão, com uma região sintética e a aplicação no centro
 * dela. O produto não faz nada disso: ele passa pelo atlas, pelo store, pelo
 * toque no anel e pela máscara da região — e era ali que a simulação morria.
 *
 * O defeito tinha três camadas, e cada uma sozinha já bastava para o
 * profissional dizer "não muda nada":
 *
 * 1. a aplicação nascia no landmark de ancoragem, que é vértice do fecho convexo
 *    — na borda, onde a máscara da região vale zero;
 * 2. o feather da máscara era fixo em DIP, maior que regiões finas inteiras, que
 *    por isso nunca chegavam a máscara cheia;
 * 3. a intensidade era quadrática sobre um teto já conservador, então o padrão
 *    de 45% entregava 20% de 2,4 mm.
 *
 * Este arquivo mede o resultado das três. A bancada só existe fora de produção:
 *   pnpm dev
 *   E2E_BASE_URL=http://localhost:3000 pnpm exec playwright test simulacao
 */

const HARNESS = '/diagnostico/interface'

interface Metrics {
  changed: number
  total: number
  changedRatio: number
  meanDiff: number
  maxDiff: number
  centroidU: number
  centroidV: number
}

interface Instance {
  key: string
  label: string
  core: { x: number; y: number }
  inscribedU: number
}

interface Bridge {
  capture: () => void
  measure: () => Metrics
  scanline: (v: number) => number[]
  readSize: () => { width: number; height: number; scale: number }
  instances: () => Instance[]
  geometry: { ipdPx: number; width: number; height: number }
}

/**
 * Roda uma função na página com a ponte da bancada na mão.
 *
 * A ponte vai por `evaluateHandle`: ela é um objeto vivo da página, não dá para
 * serializar, e o handle é o jeito de a função do teste receber o objeto de
 * verdade. O `window` da bancada não vira `declare global` aqui de propósito —
 * o tipo de verdade mora em `InterfaceHarness.tsx`, e uma segunda declaração só
 * daria ao typecheck duas versões dele para comparar.
 */
async function onBridge<A, T>(
  page: Page,
  body: (input: [Bridge, A]) => T,
  argument: A,
): Promise<T> {
  const handle = await page.evaluateHandle(
    () => (window as unknown as { __previaBancada: Bridge }).__previaBancada,
  )
  try {
    // O handle vai dentro do array: o Playwright troca handles aninhados pelo
    // objeto vivo da página antes de chamar a função.
    return (await page.evaluate(body as never, [handle, argument] as never)) as T
  } finally {
    await handle.dispose()
  }
}

async function open(page: Page): Promise<void> {
  const response = await page.goto(HARNESS)
  test.skip(response?.status() === 404, 'a bancada só existe fora de produção')

  await page.waitForFunction(
    () => Boolean((window as unknown as { __previaBancada?: unknown }).__previaBancada),
    null,
    { timeout: 30_000 },
  )
  // Os anéis do atlas entram em cascata depois do primeiro quadro.
  await page.locator('div.touch-none button').first().waitFor({ timeout: 30_000 })
  await page.waitForTimeout(600)
}

/** O anel de uma região, pelo rótulo com que o `aria-label` começa. */
function ring(page: Page, label: string) {
  return page.getByRole('button', { name: new RegExp(`^${label}`) }).first()
}

async function setSlider(page: Page, index: number, value: number | 'max'): Promise<void> {
  await page
    .getByRole('slider')
    .nth(index)
    .evaluate((element, target) => {
      const input = element as HTMLInputElement
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, target === 'max' ? input.max : String(target))
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }, value)
  await page.waitForTimeout(250)
}

const capture = (page: Page) => onBridge(page, ([bridge]) => bridge.capture(), null)
const measure = (page: Page) => onBridge(page, ([bridge]) => bridge.measure(), null)
const scanline = (page: Page, v: number) =>
  onBridge(page, ([bridge, row]) => bridge.scanline(row), v)

test.describe('tocar numa região muda a foto', () => {
  test('sem aplicação, o quadro é idêntico a si mesmo', async ({ page }) => {
    await open(page)
    await capture(page)

    const metrics = await measure(page)
    // Sem isto, qualquer "mudou" abaixo poderia ser ruído do próprio render.
    expect(metrics.changed, 'render não determinístico').toBe(0)
  })

  test('um toque no anel, sem mexer em mais nada, já muda a foto', async ({ page }) => {
    await open(page)
    await capture(page)

    await ring(page, 'Glabela').click()
    await expect(page.getByRole('slider').first()).toBeVisible()
    await page.waitForTimeout(400)

    const metrics = await measure(page)

    // Este é o teste que a versão anterior reprovava. Com o controle no máximo
    // ela mudava 0.12% dos pixels; no padrão, quase nada.
    expect(metrics.changed, 'nenhum pixel mudou ao tocar na região').toBeGreaterThan(0)
    expect(metrics.changedRatio, 'a mudança é pequena demais para se ver').toBeGreaterThan(0.002)
  })

  test('a mudança acontece onde o profissional tocou', async ({ page }) => {
    await open(page)
    await capture(page)

    const core = await onBridge(
      page,
      ([bridge]) => bridge.instances().find((item) => item.key === 'malar:right')?.core,
      null,
    )
    expect(core).toBeTruthy()

    await ring(page, 'Malar').click()
    await page.waitForTimeout(400)

    const metrics = await measure(page)

    // O centro de massa da mudança cai sobre o núcleo da região. Sem isto, um
    // passe que reamostrasse a foto inteira passaria como sucesso.
    expect(Math.abs(metrics.centroidU - (core?.x ?? 0))).toBeLessThan(0.04)
    expect(Math.abs(metrics.centroidV - (core?.y ?? 0))).toBeLessThan(0.04)
  })

  test('remover a aplicação devolve a foto original', async ({ page }) => {
    await open(page)
    await capture(page)

    await ring(page, 'Glabela').click()
    await page.waitForTimeout(300)
    expect((await measure(page)).changed).toBeGreaterThan(0)

    await page.getByRole('button', { name: 'Remover' }).click()
    await page.waitForTimeout(400)

    expect((await measure(page)).changed, 'a foto não voltou ao original').toBe(0)
  })
})

test.describe('o deslocamento é visível e respeita o teto', () => {
  test('o padrão entrega perto de metade do teto, e o máximo entrega o teto', async ({ page }) => {
    await open(page)

    const setup = await onBridge(
      page,
      ([bridge]) => ({
        core: bridge.instances().find((item) => item.key === 'glabella')?.core,
        size: bridge.readSize(),
        ipdPx: bridge.geometry.ipdPx,
      }),
      null,
    )

    const v = setup.core?.y ?? 0.5
    const before = await scanline(page, v)
    expect(before.length, 'a grade de referência não foi lida').toBeGreaterThan(10)

    await ring(page, 'Glabela').click()
    await expect(page.getByRole('slider').first()).toBeVisible()
    await page.waitForTimeout(400)
    const atDefault = await scanline(page, v)

    await setSlider(page, 0, 'max')
    await page.waitForTimeout(300)
    const atMax = await scanline(page, v)

    // Casamento por índice: contagem igual é a prova de que cada linha de antes
    // tem exatamente uma correspondente. A varredura passa pelo núcleo, onde o
    // deslocamento radial é puramente horizontal.
    expect(atDefault.length, 'a grade perdeu ou ganhou linha no padrão').toBe(before.length)
    expect(atMax.length, 'a grade perdeu ou ganhou linha no máximo').toBe(before.length)

    const shift = (lines: number[]) =>
      Math.max(...before.map((line, index) => Math.abs((lines[index] as number) - line)))

    // Teto do preenchedor na glabela, convertido para pixels da leitura.
    const ceiling = 0.038 * setup.ipdPx * setup.size.scale

    // O padrão é metade do controle, e o mapa é linear: perto de metade do teto.
    expect(shift(atDefault), 'o padrão é imperceptível').toBeGreaterThan(ceiling * 0.35)
    expect(shift(atDefault)).toBeLessThan(ceiling * 0.65)

    // No máximo, o teto inteiro — e nem um pixel além dele (D-05). A folga é o
    // limite do instrumento: o centro de uma linha não resolve abaixo de 1 px.
    expect(shift(atMax), 'o máximo não usa o teto da região').toBeGreaterThan(ceiling * 0.75)
    expect(shift(atMax), 'deslocamento acima do teto da região').toBeLessThan(ceiling + 1.5)
  })

  test('intensidade zero não muda nada, e mais intensidade muda mais', async ({ page }) => {
    await open(page)
    await capture(page)

    await ring(page, 'Malar').click()
    await expect(page.getByRole('slider').first()).toBeVisible()

    await setSlider(page, 0, 0)
    expect((await measure(page)).changed, 'intensidade zero alterou a foto').toBe(0)

    await setSlider(page, 0, 0.3)
    const low = await measure(page)
    await setSlider(page, 0, 0.6)
    const mid = await measure(page)
    await setSlider(page, 0, 1)
    const high = await measure(page)

    expect(low.changed).toBeGreaterThan(0)
    expect(mid.meanDiff).toBeGreaterThan(low.meanDiff)
    expect(high.meanDiff).toBeGreaterThan(mid.meanDiff)
  })
})

test.describe('as quatro técnicas fazem alguma coisa', () => {
  const CASES = [
    { technique: 'Preenchedor', region: 'Malar' },
    { technique: 'Toxina botulínica', region: 'Glabela' },
    { technique: 'Bioestimulador', region: 'Malar' },
    { technique: 'Rinomodelação', region: 'Dorso nasal' },
  ] as const

  for (const { technique, region } of CASES) {
    test(`${technique} em ${region} altera a foto`, async ({ page }) => {
      await open(page)

      await page.getByRole('radio', { name: technique }).click()
      await page.waitForTimeout(200)
      await capture(page)

      await ring(page, region).click()
      await expect(page.getByRole('slider').first()).toBeVisible()
      await setSlider(page, 0, 'max')
      await page.waitForTimeout(400)

      const metrics = await measure(page)
      expect(metrics.changed, `${technique} não mudou nada`).toBeGreaterThan(0)
      expect(metrics.changedRatio).toBeGreaterThan(0.001)
    })
  }
})
