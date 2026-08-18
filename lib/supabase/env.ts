/**
 * Endereço e chave pública do projeto Supabase.
 *
 * Aceita os dois nomes de chave. O Supabase está migrando do JWT `anon` legado
 * para a chave publicável (`sb_publishable_…`), e as duas ocupam a mesma posição
 * no cliente: são identificação de projeto, não credencial — quem protege os
 * dados é a RLS. Ler só um dos nomes deixaria o app sem subir em metade dos
 * projetos, com um erro que não diz qual metade.
 *
 * As referências a `process.env` são literais de propósito: o Next substitui
 * `NEXT_PUBLIC_*` no build por análise estática, e um acesso dinâmico viraria
 * `undefined` no navegador.
 */
export function getSupabaseEnv(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key) {
    throw new Error(
      'Configure NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ' +
        '(ou NEXT_PUBLIC_SUPABASE_ANON_KEY, no formato legado) em .env.local.',
    )
  }

  return { url, key }
}

/** O mesmo, sem explodir: para quem precisa seguir sem configuração. */
export function tryGetSupabaseEnv(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  return url && key ? { url, key } : null
}
