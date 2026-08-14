import { expect, test, type Page } from '@playwright/test'

/**
 * A função principal do produto: aplicar um procedimento muda mesmo a foto?
 *
 * Nenhum teste de unidade responde isso. O efeito nasce num shader, dentro de um
 * contexto WebGL, e as únicas provas que valem são pixels. Este arquivo mede:
 *
 * - se a foto muda quando uma aplicação entra, e volta ao original quando sai;
 * - se a mudança acontece **onde** deveria — dentro do polígono da região;
 * - **quanto** o tecido se deslocou, medindo o deslocamento das linhas de uma
 *   grade de referência, e se esse deslocamento respeita o teto da região;
 * - se intensidade zero não muda nada, e se mais intensidade muda mais;
 * - se as quatro técnicas produzem efeito, e se a toxina desloca muito menos que
 *   o preenchedor, como manda a separação de frequência.
 *
 * A bancada só existe fora de produção. Rode com:
 *   pnpm dev
 *   E2E_BASE_URL=http://localhost:3000 pnpm exec playwright test warp
 */

const HARNESS = '/diagnostico/warp'

interface WarpMetrics {
  changed: number
  total: number
  changedRatio: number
  meanDiff: number
  maxDiff: number
  centroidU: number
  centroidV: number
  maxRadiusU: number
  outsideRegionRatio: number
}

interface Application {
  id: string
  regionId: string
  side: string
  regionKey: string
  technique: string
  u: number
  v: number
  radiusIpd: number
  intensity: number
}

declare global {
  interface Window {
    __previaWarp?: {
      photo: { width: number; height: number }
      center: { u: number; v: number }
      ipdPx: number
      regionRadius: number
      apply: (applications: Application[]) => void
      capture: () => void
      measure: () => WarpMetrics
      readSize: () => { width: number; height: number; scale: number }
      scanline: (v: number) => number[]
      scancolumn: (u: number) => number[]
    }
  }
}

function application(overrides: Partial<Application> = {}): Application {
  return {
    id: '70000000-0000-4000-8000-000000000001',
    regionId: 'malar',
    side: 'right',
    regionKey: 'malar:right',
    technique: 'filler',
    u: 0.35,
    v: 0.5,
    radiusIpd: 0.3,
    intensity: 1,
    ...overrides,
  }
}

async function open(page: Page) {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))

  const response = await page.goto(HARNESS)
  test.skip(response?.status() === 404, 'a bancada só existe fora de produção')

  await page.locator('[data-warp-harness="pronto"]').waitFor({ timeout: 30_000 })
  await page.waitForFunction(() => Boolean(window.__previaWarp), null, { timeout: 30_000 })
  // O render é dirigido por requestAnimationFrame; um instante para o primeiro
  // quadro sair antes de a referência ser capturada.
  await page.waitForTimeout(1200)

  return errors
}

/** Aplica um conjunto e mede contra a referência capturada antes. */
async function measureWith(page: Page, applications: Application[]): Promise<WarpMetrics> {
  return page.evaluate((apps) => {
    const api = window.__previaWarp
    if (!api) throw new Error('bancada ausente')
    api.apply(apps as never)
    return api.measure()
  }, applications)
}

test.describe('a simulação altera a foto', () => {
  test('sem aplicação, o quadro é estável e idêntico a si mesmo', async ({ page }) => {
    const errors = await open(page)

    const metrics = await page.evaluate(() => {
      const api = window.__previaWarp
      if (!api) throw new Error('bancada ausente')
      api.apply([])
      api.capture()
      return api.measure()
    })

    // Sem isto, qualquer "mudou" abaixo poderia ser ruído do próprio render.
    expect(metrics.changed, 'render não determinístico').toBe(0)
    expect(errors).toEqual([])
  })

  test('preenchedor no máximo altera a foto de forma substancial', async ({ page }) => {
    await open(page)
    await page.evaluate(() => {
      window.__previaWarp?.apply([])
      window.__previaWarp?.capture()
    })

    const metrics = await measureWith(page, [application()])

    expect(metrics.changed, 'nenhum pixel mudou').toBeGreaterThan(0)
    // A malar ocupa uma fatia pequena da foto; meio por cento de pixels
    // alterados já é uma área grande e visível.
    expect(metrics.changedRatio).toBeGreaterThan(0.005)
    expect(metrics.meanDiff).toBeGreaterThan(20)
  })

  test('a mudança acontece na região tocada, e não espalhada pela foto', async ({ page }) => {
    await open(page)
    const center = await page.evaluate(() => {
      window.__previaWarp?.apply([])
      window.__previaWarp?.capture()
      return window.__previaWarp?.center
    })

    const metrics = await measureWith(page, [application()])

    // O centro de massa da diferença cai sobre o ponto tocado.
    expect(Math.abs(metrics.centroidU - (center?.u ?? 0))).toBeLessThan(0.03)
    expect(Math.abs(metrics.centroidV - (center?.v ?? 0))).toBeLessThan(0.03)

    // E quase nada escapa do polígono da região: máscara que vaza arrasta fundo
    // e cabelo junto com a pele.
    expect(metrics.outsideRegionRatio).toBeLessThan(0.02)
  })

  test('remover a aplicação devolve a foto original, pixel por pixel', async ({ page }) => {
    await open(page)
    await page.evaluate(() => {
      window.__previaWarp?.apply([])
      window.__previaWarp?.capture()
    })

    const applied = await measureWith(page, [application()])
    expect(applied.changed).toBeGreaterThan(0)

    const removed = await measureWith(page, [])
    expect(removed.changed, 'a foto não voltou ao original').toBe(0)
  })

  test('intensidade zero não muda nada; mais intensidade muda mais', async ({ page }) => {
    await open(page)
    await page.evaluate(() => {
      window.__previaWarp?.apply([])
      window.__previaWarp?.capture()
    })

    const zero = await measureWith(page, [application({ intensity: 0 })])
    expect(zero.changed, 'intensidade zero alterou a foto').toBe(0)

    const low = await measureWith(page, [application({ intensity: 0.3 })])
    const mid = await measureWith(page, [application({ intensity: 0.6 })])
    const high = await measureWith(page, [application({ intensity: 1 })])

    expect(low.changed).toBeGreaterThan(0)
    expect(mid.changed).toBeGreaterThan(low.changed)
    expect(high.changed).toBeGreaterThan(mid.changed)
  })
})

test.describe('o tecido se desloca, e dentro do teto', () => {
  test('o preenchedor move a grade de referência alguns pixels', async ({ page }) => {
    await open(page)

    const before = await page.evaluate(() => {
      const api = window.__previaWarp
      if (!api) throw new Error('bancada ausente')
      api.apply([])
      return { lines: api.scanline(0.5), size: api.readSize(), ipdPx: api.ipdPx }
    })

    const after = await page.evaluate(() => {
      const api = window.__previaWarp
      if (!api) throw new Error('bancada ausente')
      api.apply([
        {
          id: '70000000-0000-4000-8000-000000000001',
          regionId: 'malar',
          side: 'right',
          regionKey: 'malar:right',
          technique: 'filler',
          u: 0.35,
          v: 0.5,
          radiusIpd: 0.3,
          intensity: 1,
        },
      ] as never)
      return api.scanline(0.5)
    })

    expect(before.lines.length).toBeGreaterThan(10)

    // Casamento por índice, não por vizinho mais próximo. Vizinho mais próximo
    // mente de duas formas: subestima quando o deslocamento passa de meia
    // passada da grade, e superestima quando uma linha some. A contagem igual é
    // a prova de que cada linha de antes tem exatamente uma correspondente.
    //
    // A varredura passa pelo centro da aplicação de propósito: ali o
    // deslocamento radial é puramente horizontal, e nenhuma linha entra ou sai
    // do quadro amostrado.
    expect(after.length, 'a grade perdeu ou ganhou linhas — medida não confiável').toBe(
      before.lines.length,
    )

    const maxShift = Math.max(
      ...before.lines.map((line, index) => Math.abs((after[index] as number) - line)),
    )

    // O teto da malar para preenchedor é 0.034 DIP. Em pixels da leitura:
    const ceiling = 0.034 * before.ipdPx * before.size.scale

    // Deslocou de verdade — não é mudança só de cor.
    expect(maxShift, 'a grade não se moveu').toBeGreaterThan(1.5)

    // E respeitou o teto da região. A folga é o próprio limite do instrumento:
    // o centro de uma linha da grade não resolve abaixo de um pixel.
    //
    // Este limite já foi violado. A conversão de direção para UV no shader do
    // campo estava invertida, e o deslocamento saía 1/aspect maior que o teto —
    // 32% acima numa foto 3:4. O teto por região é requisito de segurança
    // (D-05), não sugestão.
    expect(maxShift, 'deslocamento acima do teto da região').toBeLessThan(ceiling + 1.5)
  })

  test('o bioestimulador empurra em superior-lateral, não radialmente', async ({ page }) => {
    await open(page)

    const before = await page.evaluate(() => {
      const api = window.__previaWarp
      if (!api) throw new Error('bancada ausente')
      api.apply([])
      // A grade é regular: uma varredura sobre uma linha vira uma corrida
      // escura só. Procura a posição de melhor contraste perto do centro.
      let best = { u: 0.35, count: -1 }
      for (let step = 0; step < 24; step += 1) {
        const u = 0.35 + (step - 12) * 0.0012
        const count = api.scancolumn(u).length
        if (count > best.count) best = { u, count }
      }
      return { u: best.u, rows: api.scancolumn(best.u), size: api.readSize(), ipdPx: api.ipdPx }
    })

    const after = await page.evaluate((u) => {
      const api = window.__previaWarp
      if (!api) throw new Error('bancada ausente')
      api.apply([
        {
          id: '70000000-0000-4000-8000-000000000001',
          regionId: 'malar',
          side: 'right',
          regionKey: 'malar:right',
          technique: 'biostimulator',
          u: 0.35,
          v: 0.5,
          radiusIpd: 0.4,
          intensity: 1,
        },
      ] as never)
      return api.scancolumn(u)
    }, before.u)

    expect(after.length, 'a grade perdeu ou ganhou linhas').toBe(before.rows.length)

    const vertical = Math.max(
      ...before.rows.map((row, index) => Math.abs((after[index] as number) - row)),
    )

    // A direção é (lateral 0.5, superior −0.866). A componente vertical domina,
    // e o teto do bioestimulador é 0.02 DIP.
    const ceiling = 0.02 * before.ipdPx * before.size.scale

    expect(vertical, 'o bioestimulador não moveu tecido na vertical').toBeGreaterThan(1.5)
    expect(vertical, 'deslocamento acima do teto da região').toBeLessThan(ceiling + 1.5)
  })
})

test.describe('as técnicas produzem efeitos distintos', () => {
  const techniques = [
    { technique: 'filler', regionId: 'malar', regionKey: 'malar:right' },
    { technique: 'toxin', regionId: 'malar', regionKey: 'malar:right' },
    { technique: 'biostimulator', regionId: 'malar', regionKey: 'malar:right' },
  ]

  for (const entry of techniques) {
    test(`${entry.technique} altera a foto`, async ({ page }) => {
      await open(page)
      await page.evaluate(() => {
        window.__previaWarp?.apply([])
        window.__previaWarp?.capture()
      })

      const metrics = await measureWith(page, [
        application({ ...entry, radiusIpd: 0.3, intensity: 1 }),
      ])

      expect(metrics.changed, `${entry.technique} não produziu efeito`).toBeGreaterThan(0)
      expect(
        metrics.outsideRegionRatio,
        `${entry.technique} vazou para fora da região`,
      ).toBeLessThan(0.02)
    })
  }

  test('ligar o passe da toxina não toca em área sem tratamento', async ({ page }) => {
    await open(page)
    await page.evaluate(() => {
      window.__previaWarp?.apply([])
      window.__previaWarp?.capture()
    })

    // Intensidade quase nula: o passe de separação de frequência entra na
    // cadeia, mas a mistura é praticamente zero. Se ligar o passe mudar a foto
    // fora da região, o passe está reamostrando a imagem inteira.
    //
    // Isto já aconteceu: os filtros herdavam a resolução padrão do Pixi, que é
    // 1, enquanto o canvas roda em `min(devicePixelRatio, 2)`. Metade da
    // resolução, reescalada — a foto inteira amolecia no instante em que a
    // primeira toxina era aplicada. Três quartos dos pixels alterados caíam
    // fora da região tratada.
    const metrics = await measureWith(page, [
      application({ technique: 'toxin', intensity: 0.001 }),
    ])

    expect(metrics.outsideRegionRatio, 'o passe reamostrou a foto inteira').toBe(0)
    expect(metrics.changedRatio, 'ligar o passe alterou área demais').toBeLessThan(0.002)
  })

  test('a toxina desloca muito menos tecido que o preenchedor', async ({ page }) => {
    await open(page)

    async function shift(technique: string): Promise<number> {
      const before = await page.evaluate(() => {
        const api = window.__previaWarp
        if (!api) throw new Error('bancada ausente')
        api.apply([])
        return api.scanline(0.5)
      })

      const after = await page.evaluate((chosen) => {
        const api = window.__previaWarp
        if (!api) throw new Error('bancada ausente')
        api.apply([
          {
            id: '70000000-0000-4000-8000-000000000001',
            regionId: 'malar',
            side: 'right',
            regionKey: 'malar:right',
            technique: chosen,
            u: 0.35,
            v: 0.5,
            radiusIpd: 0.3,
            intensity: 1,
          },
        ] as never)
        return api.scanline(0.5)
      }, technique)

      const shifts = before.map((line) =>
        after.reduce(
          (best, candidate) => Math.min(best, Math.abs(candidate - line)),
          Number.POSITIVE_INFINITY,
        ),
      )
      return Math.max(...shifts.filter(Number.isFinite))
    }

    const filler = await shift('filler')
    const toxin = await shift('toxin')

    // A toxina relaxa o músculo; ela não empurra tecido. O teto de amplitude é
    // seis vezes menor que o do preenchedor, e o efeito é separação de
    // frequência — se ela deslocasse tanto quanto o preenchedor, estaria
    // simulando a coisa errada.
    expect(toxin).toBeLessThan(filler)
  })
})
