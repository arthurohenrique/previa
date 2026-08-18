import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * `supabase/setup.sql` é o script único que se cola no SQL Editor do Supabase.
 * As migrations continuam sendo a fonte para o ambiente local (`supabase db
 * reset`), então existem duas descrições do mesmo banco — e duas descrições
 * divergem.
 *
 * Estes testes prendem uma na outra: tudo que as migrations criam precisa estar
 * no script, e o script precisa ser executável mais de uma vez sem quebrar.
 */

const ROOT = join(__dirname, '..')
const SETUP = readFileSync(join(ROOT, 'supabase', 'setup.sql'), 'utf8')

const MIGRATIONS = readdirSync(join(ROOT, 'supabase', 'migrations'))
  .filter((name) => name.endsWith('.sql'))
  .map((name) => readFileSync(join(ROOT, 'supabase', 'migrations', name), 'utf8'))
  .join('\n')

function matches(source: string, pattern: RegExp): string[] {
  return [...source.matchAll(pattern)].map((match) => match[1] as string)
}

describe('setup.sql cobre as migrations', () => {
  it('cria todas as tabelas', () => {
    const expected = matches(MIGRATIONS, /create table (?:if not exists )?public\.(\w+)/g)
    const present = new Set(matches(SETUP, /create table (?:if not exists )?public\.(\w+)/g))

    expect(expected.length).toBeGreaterThan(5)
    expect(expected.filter((table) => !present.has(table))).toEqual([])
  })

  it('liga RLS em todas as tabelas que as migrations ligam', () => {
    const expected = matches(
      MIGRATIONS,
      /alter table public\.(\w+)\s+enable row level security/g,
    )
    const present = new Set(
      matches(SETUP, /alter table public\.(\w+)\s+enable row level security/g),
    )

    expect(expected.length).toBeGreaterThan(5)
    expect(expected.filter((table) => !present.has(table))).toEqual([])
  })

  it('cria todas as políticas', () => {
    const expected = matches(MIGRATIONS, /create policy (\w+) on public\./g)
    const present = new Set(matches(SETUP, /create policy (\w+) on public\./g))

    expect(expected.length).toBeGreaterThan(15)
    expect(expected.filter((policy) => !present.has(policy))).toEqual([])
  })

  it('cria todas as funções', () => {
    const expected = matches(
      MIGRATIONS,
      /create or replace function public\.(\w+)\s*\(/g,
    )
    const present = new Set(
      matches(SETUP, /create or replace function public\.(\w+)\s*\(/g),
    )

    expect(expected.length).toBeGreaterThan(3)
    expect(expected.filter((fn) => !present.has(fn))).toEqual([])
  })

  it('cria todos os gatilhos', () => {
    const expected = matches(MIGRATIONS, /create trigger (\w+)/g)
    const present = new Set(matches(SETUP, /create trigger (\w+)/g))

    expect(expected.length).toBeGreaterThan(5)
    expect(expected.filter((trigger) => !present.has(trigger))).toEqual([])
  })

  it('semeia o atlas com as mesmas regiões', () => {
    const expected = matches(MIGRATIONS, /\('([a-z_]+)',\s+'[^']+',\s+(?:true|false),/g)
    const present = new Set(matches(SETUP, /\('([a-z_]+)',\s+'[^']+',\s+(?:true|false),/g))

    expect(expected.length).toBe(10)
    expect(expected.filter((region) => !present.has(region))).toEqual([])
  })
})

describe('setup.sql pode ser executado de novo', () => {
  it('protege toda criação de tabela, índice e tipo', () => {
    expect(SETUP).not.toMatch(/create table public\./)
    expect(SETUP).not.toMatch(/create (?:unique )?index (?!if not exists)/)
    // Os enums não aceitam `if not exists`; vão dentro de bloco com exceção.
    for (const type of matches(SETUP, /create type public\.(\w+)/g)) {
      expect(SETUP, `tipo ${type} fora de bloco protegido`).toContain(
        'exception when duplicate_object then null',
      )
    }
  })

  it('derruba a política e o gatilho antes de recriar', () => {
    for (const policy of matches(SETUP, /create policy (\w+) on public\.(\w+)/g)) {
      expect(SETUP, `política ${policy} sem drop`).toMatch(
        new RegExp(`drop policy if exists ${policy} on public\\.`),
      )
    }
    for (const trigger of matches(SETUP, /create trigger (\w+)/g)) {
      expect(SETUP, `gatilho ${trigger} sem drop`).toMatch(
        new RegExp(`drop trigger if exists ${trigger} on public\\.`),
      )
    }
  })

  it('não insere linha que duplicaria numa segunda execução', () => {
    // Os INSERT dentro de corpo de função só rodam quando a função é chamada, e
    // cada um tem a sua própria guarda. O que importa aqui é o nível de cima,
    // que roda toda vez que alguém cola o script.
    const topLevel = SETUP.replace(/\$\$[\s\S]*?\$\$/g, '')
    const statements = [...topLevel.matchAll(/insert into public\.(\w+)[\s\S]*?;/g)]

    expect(statements.map((match) => match[1])).toEqual(['regions'])
    for (const [statement, table] of statements) {
      expect(statement, `insert em ${table} duplicaria`).toMatch(/on conflict[\s\S]*do update/)
    }
  })
})

describe('o banco continua sem imagem', () => {
  // Sem comentários e sem literais de texto: o script *explica* que não guarda
  // base64, tanto em comentário quanto no `comment on column`, e a explicação
  // não pode disparar a própria guarda.
  const code = SETUP.replace(/\$\$[\s\S]*?\$\$/g, '')
    .replace(/--[^\n]*/g, '')
    .replace(/'[^']*'/g, "''")

  it('não declara coluna nem bucket de imagem', () => {
    expect(code).not.toMatch(/\bbytea\b/i)
    expect(code).not.toMatch(/storage\.(buckets|objects)/i)
    expect(code).not.toMatch(/base64/i)
  })

  it('mantém a distância interpupilar como única medida em pixel', () => {
    expect(SETUP).toContain('ipd_px')
    expect(SETUP).not.toMatch(/radius_px|amplitude_px|offset_px/)
  })
})
