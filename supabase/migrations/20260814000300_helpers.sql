-- Prévia — funções auxiliares de RLS.
--
-- SECURITY DEFINER de propósito: as políticas de profiles dependem destas
-- funções, e sem o bypass a leitura entraria em recursão. `search_path` fixo
-- para que a função não possa ser sequestrada por um schema criado depois.

create or replace function public.current_clinic_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select clinic_id from public.profiles where id = auth.uid()
$$;

create or replace function public.is_clinic_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select role = 'admin' from public.profiles where id = auth.uid()),
    false
  )
$$;

comment on function public.current_clinic_id is
  'Clínica do usuário autenticado. Base de toda política de RLS.';

-- `from public` sozinho não basta: o Supabase concede EXECUTE a `anon` de forma
-- explícita, por `alter default privileges`, e revogar de PUBLIC não desfaz
-- concessão nominal. Sem citar `anon` aqui, o anônimo executa as duas — o que
-- não vaza nada, porque `auth.uid()` é nulo para ele, mas contraria o desenho.
revoke all on function public.current_clinic_id() from public, anon;
revoke all on function public.is_clinic_admin() from public, anon;
grant execute on function public.current_clinic_id() to authenticated;
grant execute on function public.is_clinic_admin() to authenticated;
