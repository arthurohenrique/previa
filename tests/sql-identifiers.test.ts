import { readFileSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Nome de coluna que colide com palavra reservada do PostgreSQL.
 *
 * Já aconteceu: a coluna `symmetric` da tabela `regions` fazia o `create table`
 * falhar com "syntax error at or near symmetric" — `SYMMETRIC` é reservada por
 * causa de `BETWEEN SYMMETRIC`. O defeito passou por typecheck, lint e pela
 * suíte inteira, porque nada aqui executa SQL: só apareceu quando alguém colou
 * o script no SQL Editor.
 *
 * Este teste é o substituto barato de um Postgres: não valida sintaxe, mas pega
 * a classe de erro que já quebrou a instalação uma vez.
 */

const ROOT = join(__dirname, '..')

/**
 * Palavras reservadas do PostgreSQL — as categorias `reserved` e `reserved
 * (cannot be function or type name)`. São as que não podem ser identificador
 * sem aspas.
 */
const RESERVED = new Set([
  'all', 'analyse', 'analyze', 'and', 'any', 'array', 'as', 'asc', 'asymmetric',
  'authorization', 'binary', 'both', 'case', 'cast', 'check', 'collate',
  'collation', 'column', 'concurrently', 'constraint', 'create', 'cross',
  'current_catalog', 'current_date', 'current_role', 'current_schema',
  'current_time', 'current_timestamp', 'current_user', 'default', 'deferrable',
  'desc', 'distinct', 'do', 'else', 'end', 'except', 'false', 'fetch', 'for',
  'foreign', 'freeze', 'from', 'full', 'grant', 'group', 'having', 'ilike', 'in',
  'initially', 'inner', 'intersect', 'into', 'is', 'isnull', 'join', 'lateral',
  'leading', 'left', 'like', 'limit', 'localtime', 'localtimestamp', 'natural',
  'not', 'notnull', 'null', 'offset', 'on', 'only', 'or', 'order', 'outer',
  'overlaps', 'placing', 'primary', 'references', 'returning', 'right', 'select',
  'session_user', 'similar', 'some', 'symmetric', 'system_user', 'table',
  'tablesample', 'then', 'to', 'trailing', 'true', 'union', 'unique', 'user',
  'using', 'variadic', 'verbose', 'when', 'where', 'window', 'with',
])

/** Restrição de tabela: tem nome de palavra-chave e não é coluna. */
const CONSTRAINT = /^(constraint|primary|unique|foreign|check|exclude|like)$/

function sqlFiles(): Array<{ name: string; text: string }> {
  const migrations = join(ROOT, 'supabase', 'migrations')
  const paths = [
    ...readdirSync(migrations)
      .filter((name) => name.endsWith('.sql'))
      .map((name) => join(migrations, name)),
    join(ROOT, 'supabase', 'setup.sql'),
  ]

  return paths.map((path) => ({ name: basename(path), text: readFileSync(path, 'utf8') }))
}

/**
 * Nomes de coluna de cada `create table`.
 *
 * Uma definição de coluna começa logo depois do parêntese de abertura ou de uma
 * linha terminada em vírgula. Sem essa regra estrutural, a linha de continuação
 * `references public.clinics (id) on delete restrict` seria lida como uma
 * coluna chamada `references` — e `references` é reservada, então o teste
 * acusaria a si mesmo.
 */
function columnNames(sql: string): Array<{ table: string; column: string }> {
  const found: Array<{ table: string; column: string }> = []
  const pattern = /create table (?:if not exists )?public\.(\w+)\s*\(([\s\S]*?)\n\);/g

  for (const [, table, body] of sql.matchAll(pattern)) {
    let startsColumn = true

    for (const raw of (body ?? '').split('\n')) {
      const line = raw.replace(/--.*$/, '').trim()
      if (!line) continue

      if (startsColumn) {
        const [first, ...rest] = line.split(/\s+/)
        const name = (first ?? '').toLowerCase()

        if (first && !CONSTRAINT.test(name) && /^[a-z_][a-z0-9_]*$/.test(first) && rest.length) {
          found.push({ table: table as string, column: first })
        }
      }

      startsColumn = line.endsWith(',')
    }
  }
  return found
}

describe('identificadores do SQL', () => {
  const files = sqlFiles()

  it('encontra colunas para conferir', () => {
    const total = files.reduce((sum, file) => sum + columnNames(file.text).length, 0)
    // Sem isto o teste abaixo passaria vazio depois de uma refatoração do regex.
    expect(total).toBeGreaterThan(40)
  })

  it('nenhuma coluna usa palavra reservada do PostgreSQL', () => {
    const offenders = files.flatMap((file) =>
      columnNames(file.text)
        .filter((entry) => RESERVED.has(entry.column))
        .map((entry) => `${file.name}: ${entry.table}.${entry.column}`),
    )

    expect(offenders).toEqual([])
  })

  it('nenhuma tabela usa palavra reservada', () => {
    const offenders = files.flatMap((file) =>
      [...file.text.matchAll(/create table (?:if not exists )?public\.(\w+)/g)]
        .map((match) => match[1] as string)
        .filter((table) => RESERVED.has(table))
        .map((table) => `${file.name}: ${table}`),
    )

    expect(offenders).toEqual([])
  })
})
