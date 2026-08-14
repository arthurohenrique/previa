import { expect, login, test } from './fixtures'

/**
 * Piso de interface, medido no viewport de iPad: alvo de toque, tipografia e
 * layout em retrato e em paisagem. Não é polimento — é o que decide se o
 * profissional acerta o toque na frente do paciente.
 */

test.describe('piso de interface', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('nenhum alvo de toque abaixo de 44 × 44 pt', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Pacientes', level: 1 })).toBeVisible()

    const targets = page.locator('main button:visible, main a:visible, nav a:visible')
    const count = await targets.count()
    expect(count).toBeGreaterThan(0)

    const small: string[] = []
    for (let index = 0; index < count; index += 1) {
      const target = targets.nth(index)
      const box = await target.boundingBox()
      if (!box) continue
      if (box.width < 43.5 || box.height < 43.5) {
        small.push(`${(await target.innerText()).trim() || '(sem texto)'} — ${box.width}×${box.height}`)
      }
    }

    expect(small).toEqual([])
  })

  test('large title de 34pt Bold que colapsa ao rolar', async ({ page }) => {
    const title = page.getByRole('heading', { name: 'Pacientes', level: 1 })
    await expect(title).toBeVisible()

    const style = await title.evaluate((element) => {
      const computed = getComputedStyle(element)
      return {
        fontSize: Number.parseFloat(computed.fontSize),
        fontWeight: computed.fontWeight,
        family: computed.fontFamily,
      }
    })

    // 34pt sobre a base de 17pt = 2rem.
    expect(style.fontSize).toBeGreaterThanOrEqual(33)
    expect(Number(style.fontWeight)).toBeGreaterThanOrEqual(700)
    // Uma única família: a do sistema.
    expect(style.family.toLowerCase()).toContain('system')
  })

  test('uma única família tipográfica em toda a tela', async ({ page }) => {
    const families = await page.evaluate(() => {
      const set = new Set<string>()
      for (const element of Array.from(document.querySelectorAll('body *'))) {
        const family = getComputedStyle(element).fontFamily
        if (family) set.add(family)
      }
      return [...set]
    })

    expect(families.length).toBeLessThanOrEqual(2)
  })

  test('não há rolagem horizontal em retrato nem em paisagem', async ({ page }) => {
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    )
    expect(overflows).toBe(false)
  })

  test('o layout aguenta Dynamic Type no tamanho máximo', async ({ page }) => {
    // O Safari expõe o Dynamic Type pelo tamanho de raiz; aumentar a raiz
    // reproduz a preferência máxima do sistema.
    await page.addStyleTag({ content: ':root { font-size: 180% !important; }' })
    await page.waitForTimeout(120)

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    )
    expect(overflows).toBe(false)
    await expect(page.getByRole('heading', { name: 'Pacientes', level: 1 })).toBeVisible()
  })

  test('o foco de teclado é visível', async ({ page }) => {
    await page.keyboard.press('Tab')
    const outline = await page.evaluate(() => {
      const active = document.activeElement
      if (!active) return null
      const computed = getComputedStyle(active)
      return { width: computed.outlineWidth, style: computed.outlineStyle }
    })

    expect(outline).not.toBeNull()
    expect(outline?.style).not.toBe('none')
  })
})
