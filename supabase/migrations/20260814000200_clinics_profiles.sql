-- Prévia — clínica e perfil. Precisam existir antes dos helpers de RLS, que
-- leem profiles para descobrir a clínica do usuário autenticado.

create table public.clinics (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 2 and 200),
  cnpj        text unique check (cnpj ~ '^[0-9]{14}$'),
  created_at  timestamptz not null default now()
);

-- Espelho de auth.users com o vínculo de clínica e o conselho profissional.
create table public.profiles (
  id              uuid primary key references auth.users (id) on delete cascade,
  clinic_id       uuid not null references public.clinics (id) on delete restrict,
  full_name       text not null check (length(btrim(full_name)) between 2 and 200),
  council_type    public.council_type,
  council_number  text check (length(btrim(council_number)) between 3 and 32),
  role            public.app_role not null default 'professional',
  created_at      timestamptz not null default now(),
  -- Quem simula precisa de conselho identificável: a ficha exportada carrega
  -- conselho e número, e sem os dois o PDF não identifica o responsável.
  constraint profiles_council_complete check (
    (council_type is null and council_number is null)
    or (council_type is not null and council_number is not null)
  )
);

create index profiles_clinic_id_idx on public.profiles (clinic_id);
