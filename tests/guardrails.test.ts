import { readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Guardas do produto.
 *
 * Estes testes não conferem comportamento: conferem que as regras que definem o
 * Prévia continuam valendo depois de qualquer refatoração. Cada um deles existe
 * porque a violação correspondente é silenciosa — o app continua rodando, e o
 * problema só aparece quando já é tarde.
 */

const ROOT = join(__dirname, '..')

function walk(dir: string, extensions: string[]): string[] {
  const out: string[] = []
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }

  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.next' || entry === '.git') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...walk(full, extensions))
    } else if (extensions.includes(extname(entry))) {
      out.push(full)
    }
  }
  return out
}

/**
 * Remove comentários mantendo strings intactas.
 *
 * Sem isto, um comentário que *proíbe* algo dispara a própria guarda — o
 * arquivo que explica por que `localStorage` não pode guardar imagem seria
 * acusado de guardar imagem em `localStorage`.
 */
function stripComments(source: string): string {
  let out = ''
  let index = 0

  while (index < source.length) {
    const char = source[index] as string
    const next = source[index + 1]

    if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index += 1
      continue
    }

    if (char === '/' && next === '*') {
      index += 2
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        index += 1
      }
      index += 2
      continue
    }

    if (char === '"' || char === "'" || char === '`') {
      const quote = char
      out += char
      index += 1
      while (index < source.length) {
        const inner = source[index] as string
        out += inner
        index += 1
        if (inner === '\\') {
          out += source[index] ?? ''
          index += 1
          continue
        }
        if (inner === quote) break
      }
      continue
    }

    out += char
    index += 1
  }

  return out
}

function sourceFiles(): Array<{ path: string; text: string }> {
  return ['app', 'lib', 'store', 'components']
    .flatMap((dir) => walk(join(ROOT, dir), ['.ts', '.tsx']))
    .map((path) => ({
      path: relative(ROOT, path).split(sep).join('/'),
      text: stripComments(readFileSync(path, 'utf8')),
    }))
}

function migrationFiles(): Array<{ path: string; text: string }> {
  return walk(join(ROOT, 'supabase', 'migrations'), ['.sql']).map((path) => ({
    path: relative(ROOT, path).split(sep).join('/'),
    text: readFileSync(path, 'utf8'),
  }))
}

// ---------------------------------------------------------------------------

describe('nenhuma dose no código', () => {
  it('não traz miligrama, unidade nem mililitro em lugar nenhum', () => {
    // Dose é ato do profissional. Um número plausível hardcoded vira prescrição
    // de fato e transfere para o software uma responsabilidade que não é dele.
    const forbidden = /\b\d+(?:[.,]\d+)?\s*(?:mg|ml|mL|UI|ui)\b/
    const offenders = sourceFiles().filter((file) => forbidden.test(file.text))

    expect(offenders.map((file) => file.path)).toEqual([])
  })

  it('não usa marca registrada de terceiro em texto de interface', () => {
    const brands = /\b(botox|dysport|xeomin|juvederm|juvéderm|restylane|sculptra|radiesse)\b/i
    const offenders = sourceFiles().filter((file) => brands.test(file.text))

    expect(offenders.map((file) => file.path)).toEqual([])
  })
})

describe('a foto nunca sai do dispositivo', () => {
  const files = sourceFiles()

  it('não usa o Storage do Supabase', () => {
    const offenders = files.filter((file) => /supabase[\s\S]{0,40}\.storage\b/.test(file.text))
    expect(offenders.map((file) => file.path)).toEqual([])
  })

  it('não envia multipart nem data URL', () => {
    const forbidden = [/multipart\/form-data/, /readAsDataURL/, /toDataURL/]
    const offenders = files.filter((file) => forbidden.some((pattern) => pattern.test(file.text)))
    expect(offenders.map((file) => file.path)).toEqual([])
  })

  it('não guarda imagem em localStorage', () => {
    const offenders = files.filter((file) => /localStorage/.test(file.text))
    expect(offenders.map((file) => file.path)).toEqual([])
  })

  it('não cria rota de API que receba corpo binário', () => {
    const routes = walk(join(ROOT, 'app', 'api'), ['.ts'])
    for (const route of routes) {
      const text = readFileSync(route, 'utf8')
      expect(text).not.toMatch(/formData\(\)|arrayBuffer\(\)|\.blob\(\)/)
    }
  })

  it('não declara coluna de imagem no banco', () => {
    const forbidden = /\b(bytea|storage\.buckets|storage\.objects)\b/i
    const offenders = migrationFiles().filter((file) => forbidden.test(file.text))
    expect(offenders.map((file) => file.path)).toEqual([])
  })
})

describe('RLS em todas as tabelas', () => {
  const migrations = migrationFiles()
  const all = migrations.map((file) => file.text).join('\n')

  const created = [...all.matchAll(/create table (?:if not exists )?public\.(\w+)/g)].map(
    (match) => match[1] as string,
  )

  it('cria as tabelas esperadas', () => {
    expect(created.sort()).toEqual(
      [
        'applications',
        'audit_log',
        'clinics',
        'consents',
        'patients',
        'profiles',
        'region_presets',
        'regions',
        'sessions',
      ].sort(),
    )
  })

  it('habilita RLS em cada tabela criada, sem exceção', () => {
    for (const table of created) {
      expect(
        new RegExp(`alter table public\\.${table}\\s+enable row level security`).test(all),
        `RLS ausente em ${table}`,
      ).toBe(true)
    }
  })

  it('mantém audit_log insert-only', () => {
    // Uma trilha que pode ser reescrita não é trilha.
    expect(all).toMatch(/create policy audit_log_insert on public\.audit_log/)
    expect(all).not.toMatch(/create policy \w+ on public\.audit_log\s+for update/)
    expect(all).not.toMatch(/create policy \w+ on public\.audit_log\s+for delete/)
    expect(all).toMatch(/revoke update, delete, truncate on public\.audit_log/)
  })

  it('escopa toda política pela clínica do usuário', () => {
    const policies = [...all.matchAll(/create policy (\w+) on public\.(\w+)([\s\S]*?);/g)]
    expect(policies.length).toBeGreaterThan(10)

    for (const [, name, table, body] of policies) {
      if (table === 'regions') continue // atlas clínico, leitura para autenticado
      expect(
        /current_clinic_id\(\)|auth\.uid\(\)|revoked_at/.test(body ?? ''),
        `política ${name} de ${table} não está escopada`,
      ).toBe(true)
    }
  })
})

describe('sistema de design', () => {
  const components = ['app', 'components']
    .flatMap((dir) => walk(join(ROOT, dir), ['.tsx']))
    .map((path) => ({ path: relative(ROOT, path).split(sep).join('/'), text: readFileSync(path, 'utf8') }))

  it('não escreve hex em componente', () => {
    const offenders = components.filter((file) => /#[0-9a-fA-F]{3,8}\b/.test(file.text))
    expect(offenders.map((file) => file.path)).toEqual([])
  })

  it('não usa cor literal do Tailwind', () => {
    // Cor só por papel semântico. `text-red-500` num componente clínico é uma
    // decisão de produto tomada por engano.
    const literal =
      /\b(?:bg|text|border|ring|fill|stroke|accent)-(?:red|blue|green|yellow|purple|pink|orange|teal|cyan|indigo|violet|amber|lime|emerald|sky|rose|fuchsia|slate|gray|zinc|neutral|stone|black|white)(?:-\d{2,3})?\b/
    const offenders = components.filter((file) => literal.test(file.text))
    expect(offenders.map((file) => file.path)).toEqual([])
  })

  it('não importa webfont', () => {
    const files = sourceFiles()
    const offenders = files.filter((file) => /next\/font|fonts\.googleapis|@font-face/.test(file.text))
    expect(offenders.map((file) => file.path)).toEqual([])
  })

  it('define a escala tipográfica e os papéis de cor no CSS global', () => {
    const css = readFileSync(join(ROOT, 'app', 'globals.css'), 'utf8')

    for (const token of [
      '--label',
      '--label-secondary',
      '--background',
      '--background-elevated',
      '--separator',
      '--accent',
      '--touch-target',
    ]) {
      expect(css).toContain(`${token}:`)
    }

    // Large title de 34pt Bold: 2rem sobre a base de 17pt.
    expect(css).toContain('--text-large-title: 2rem')
    expect(css).toContain('--text-large-title--font-weight: 700')
    // 17pt é o piso do corpo.
    expect(css).toContain('--text-body: 1rem')
    expect(css).toContain('--touch-target: 44px')
  })

  it('desliga a cascata com prefers-reduced-motion', () => {
    const css = readFileSync(join(ROOT, 'app', 'globals.css'), 'utf8')
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/)
  })
})

describe('unidades do domínio', () => {
  it('expressa raio e amplitude em fração de DIP no banco', () => {
    const all = migrationFiles()
      .map((file) => file.text)
      .join('\n')

    expect(all).toContain('radius_ipd')
    expect(all).toContain('default_radius_ipd')
    expect(all).toContain('anchor_offset_u')
    expect(all).toContain('ipd_px')
    // Nada em pixel, exceto a DIP medida, que existe só para auditoria.
    expect(all).not.toMatch(/radius_px|amplitude_px|offset_px/)
  })
})
