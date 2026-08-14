import { existsSync } from 'node:fs'
import { expect, login, MAX_REQUEST_BYTES, test } from './fixtures'

/**
 * Critério de aceite mais importante do produto: nenhuma requisição de rede
 * carrega bytes de imagem do paciente.
 *
 * A fixture `guard` observa toda requisição da página e falha o teste se
 * qualquer corpo passar de MAX_REQUEST_BYTES, se algum corpo se declarar imagem
 * ou multipart, ou se houver data URL de imagem embutida em JSON.
 */

test.describe('a foto não sai do dispositivo', () => {
  test('nenhuma requisição excede o limite durante a navegação autenticada', async ({
    page,
    guard,
  }) => {
    await login(page)

    await page.getByRole('link', { name: 'Protocolos' }).click()
    await page.waitForURL(/\/presets/)
    await expect(page.getByRole('heading', { name: 'Protocolos', level: 1 })).toBeVisible()

    await page.getByRole('link', { name: 'Pacientes' }).click()
    await page.waitForURL(/\/pacientes/)

    expect(guard.violations).toEqual([])
    expect(guard.largest).toBeLessThanOrEqual(MAX_REQUEST_BYTES)
  })

  test('a captura e a simulação não sobem imagem', async ({ page, guard }) => {
    // A detecção precisa de um rosto real: nenhuma imagem sintética produz 478
    // landmarks. Aponte E2E_FACE_PHOTO para uma foto frontal para exercitar o
    // caminho completo.
    const photo = process.env.E2E_FACE_PHOTO
    test.skip(!photo || !existsSync(photo), 'defina E2E_FACE_PHOTO com uma foto frontal')

    await login(page)
    await page.getByRole('link', { name: /./ }).first().waitFor()

    const firstPatient = page.locator('main a[href^="/pacientes/"]').first()
    await firstPatient.click()
    await page.waitForURL(/\/pacientes\/[0-9a-f-]{36}/)

    await page.getByRole('button', { name: 'Nova prévia' }).click()
    await page.waitForURL(/\/sessao\//)

    await page.locator('input[type="file"]').setInputFiles(photo as string)

    // A cascata do atlas termina quando os chips de região aparecem.
    await expect(page.getByRole('button', { name: /Glabela/ })).toBeVisible({ timeout: 30_000 })

    await page.getByRole('button', { name: /Malar/ }).first().click()
    await expect(page.getByRole('button', { name: /^Aplicação em/ }).first()).toBeVisible()

    await page.getByRole('button', { name: 'Antes e depois' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()

    // Espera o espelho de metadados sair (debounce de 700 ms).
    await page.waitForTimeout(1500)

    expect(guard.violations).toEqual([])
  })
})
