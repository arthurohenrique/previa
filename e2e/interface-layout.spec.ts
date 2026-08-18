import { expect, test, type Locator, type Page } from '@playwright/test'

/**
 * O controle não cobre a foto.
 *
 * O painel de ajuste abria flutuando sobre o rosto: no momento em que o
 * profissional arrastava a intensidade, ele deixava de ver o que estava
 * mudando. A correção foi estrutural — o palco e a barra de controles são
 * irmãos num flex, não camadas empilhadas — e é isso que este arquivo mede.
 *
 * Três propriedades, nas duas orientações do iPad:
 *
 * 1. nenhum controle da barra intersecta o retângulo do palco;
 * 2. selecionar uma aplicação não muda o tamanho do palco (senão a foto
 *    reescala no meio do trabalho e os anéis andam sob o dedo);
 * 3. todo alvo tocável da barra tem 44 × 44 pt.
 *
 * A bancada só existe fora de produção. Rode com:
 *   pnpm dev
 *   E2E_BASE_URL=http://localhost:3000 pnpm exec playwright test interface-layout
 */

const HARNESS = '/diagnostico/interface'

interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** Área da interseção, em pt². Zero quando os retângulos não se tocam. */
function overlapArea(a: Box, b: Box): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return width > 0 && height > 0 ? width * height : 0
}

async function stageBox(page: Page): Promise<Box> {
  // O canvas do Pixi preenche o palco, então o retângulo dele é o retângulo da
  // foto na tela — a medida mais estrita disponível.
  const box = await page.locator('canvas').first().boundingBox()
  expect(box, 'o canvas do palco precisa existir').not.toBeNull()
  return box as Box
}

async function controls(page: Page): Promise<Locator> {
  return page.locator('aside[aria-label="Controles"] button:visible, aside[aria-label="Controles"] a:visible, aside[aria-label="Controles"] input:visible')
}

async function offenders(page: Page): Promise<string[]> {
  const stage = await stageBox(page)
  const targets = await controls(page)
  const count = await targets.count()
  expect(count, 'a barra precisa ter controles').toBeGreaterThan(4)

  const found: string[] = []
  for (let index = 0; index < count; index += 1) {
    const target = targets.nth(index)
    const box = await target.boundingBox()
    if (!box) continue

    const area = overlapArea(stage, box)
    if (area > 0) {
      const name = (await target.getAttribute('aria-label')) ?? (await target.innerText()) ?? '(sem nome)'
      found.push(`${name.trim()} — ${area.toFixed(0)} pt² sobre a foto`)
    }
  }
  return found
}

/** Toca no primeiro anel de região e devolve o palco depois da seleção. */
async function applyFirstRegion(page: Page): Promise<void> {
  const ring = page.locator('div.touch-none button').first()
  await ring.click()
  await expect(page.getByRole('slider').first()).toBeVisible()
}

test.describe('a barra de controles não cobre a foto', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(HARNESS)
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30_000 })
    // O primeiro quadro do Pixi e a cascata dos anéis.
    await expect(page.locator('div.touch-none button').first()).toBeVisible({ timeout: 30_000 })
  })

  test('nenhum controle sobre o palco, com e sem aplicação selecionada', async ({ page }) => {
    expect(await offenders(page), 'em repouso').toEqual([])

    await applyFirstRegion(page)

    expect(await offenders(page), 'com o painel de ajuste aberto').toEqual([])
  })

  test('selecionar não muda o tamanho do palco', async ({ page }) => {
    const before = await stageBox(page)

    await applyFirstRegion(page)

    const after = await stageBox(page)

    // Sem folga de propósito: se o palco mudar, a foto reescala e os anéis
    // andam sob o dedo que acabou de tocar neles.
    expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(0.5)
  })

  test('todo alvo da barra tem 44 × 44 pt', async ({ page }) => {
    await applyFirstRegion(page)

    const targets = await controls(page)
    const count = await targets.count()

    const small: string[] = []
    for (let index = 0; index < count; index += 1) {
      const target = targets.nth(index)
      const box = await target.boundingBox()
      if (!box) continue
      if (box.width < 43.5 || box.height < 43.5) {
        const name = (await target.getAttribute('aria-label')) ?? (await target.innerText())
        small.push(`${(name ?? '(sem nome)').trim()} — ${box.width.toFixed(0)}×${box.height.toFixed(0)}`)
      }
    }

    expect(small).toEqual([])
  })
})
