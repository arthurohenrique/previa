-- ===========================================================================
-- Prévia — instalação completa do banco.
--
-- Cole este arquivo inteiro no SQL Editor do seu projeto Supabase e execute.
-- Ele é idempotente: rodar de novo não duplica nada e não apaga dados.
--
-- Depois de executar, faça duas coisas, nesta ordem:
--
--   1. Authentication → Users → Add user, com e-mail e senha do profissional.
--      Marque "Auto Confirm User".
--
--   2. Volte ao SQL Editor e rode uma vez, com os seus dados:
--
--        select public.previa_bootstrap(
--          'voce@suaclinica.com.br',   -- e-mail do usuário criado no passo 1
--          'Clínica Aurora',           -- nome da clínica
--          'Ana Ribeiro',              -- nome do profissional
--          'CRM',                      -- conselho: CRM, CRO, CRF, CRBM ou COREN
--          '123456'                    -- número de registro
--        );
--
-- Recomendado em Authentication → Providers → Email: desligue "Enable Sign Up".
-- O Prévia não tem cadastro aberto; usuários são criados pela clínica.
--
-- ---------------------------------------------------------------------------
-- O que este banco NÃO guarda: imagem.
--
-- Não existe coluna de foto, não existe bucket de Storage, não existe base64.
-- `sessions.local_image_ref` é um UUID que só faz sentido dentro do IndexedDB
-- do tablet que capturou a foto. Se algum dia você precisar acrescentar uma
-- coluna de imagem aqui, pare e releia: foto de rosto de paciente é dado
-- pessoal sensível de saúde na LGPD, e a arquitetura inteira do produto existe
-- para que ela nunca chegue a um servidor.
-- ===========================================================================

create extension if not exists "pgcrypto" with schema extensions;

-- ===========================================================================
-- 1. Tipos
-- ===========================================================================

do $$ begin
  create type public.app_role as enum ('admin', 'professional');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.council_type as enum ('CRM', 'CRO', 'CRF', 'CRBM', 'COREN');
exception when duplicate_object then null; end $$;

-- Técnicas de simulação. Efeitos visuais distintos, não níveis do mesmo controle.
do $$ begin
  create type public.technique as enum (
    'filler',          -- preenchedor de ácido hialurônico
    'toxin',           -- toxina botulínica
    'biostimulator',   -- bioestimulador de colágeno
    'rhinomodeling'    -- rinomodelação
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.consent_purpose as enum ('simulation');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.audit_action as enum ('insert', 'update', 'delete');
exception when duplicate_object then null; end $$;

-- ===========================================================================
-- 2. Clínica e perfil
--
-- Precisam existir antes dos helpers de RLS, que leem profiles para descobrir
-- a clínica do usuário autenticado.
-- ===========================================================================

create table if not exists public.clinics (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 2 and 200),
  cnpj        text unique check (cnpj ~ '^[0-9]{14}$'),
  created_at  timestamptz not null default now()
);

create table if not exists public.profiles (
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

create index if not exists profiles_clinic_id_idx on public.profiles (clinic_id);

-- ===========================================================================
-- 3. Helpers de RLS
--
-- SECURITY DEFINER de propósito: as políticas de profiles dependem destas
-- funções, e sem o bypass a leitura entraria em recursão. `search_path` fixo
-- para que a função não possa ser sequestrada por um schema criado depois.
-- ===========================================================================

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

revoke all on function public.current_clinic_id() from public;
revoke all on function public.is_clinic_admin() from public;
grant execute on function public.current_clinic_id() to authenticated;
grant execute on function public.is_clinic_admin() to authenticated;

-- ===========================================================================
-- 4. Domínio
-- ===========================================================================

-- Sem CPF, sem endereço, sem telefone nesta v1. Cada campo a mais é um dado
-- pessoal a mais para proteger sem que o simulador precise dele.
create table if not exists public.patients (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null default public.current_clinic_id()
                references public.clinics (id) on delete restrict,
  full_name   text not null check (length(btrim(full_name)) between 2 and 200),
  birth_year  smallint check (birth_year between 1900 and 2200),
  created_by  uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  created_at  timestamptz not null default now()
);

create index if not exists patients_clinic_id_idx on public.patients (clinic_id, created_at desc);

create table if not exists public.consents (
  id               uuid primary key default gen_random_uuid(),
  patient_id       uuid not null references public.patients (id) on delete cascade,
  professional_id  uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  purpose          public.consent_purpose not null default 'simulation',
  granted_at       timestamptz not null default now(),
  revoked_at       timestamptz,
  signature_svg    text not null check (
                     length(signature_svg) between 32 and 262144
                     and signature_svg ~ '^\s*<svg'
                   ),
  terms_version    text not null check (length(btrim(terms_version)) between 1 and 64),
  constraint consents_revoked_after_granted check (revoked_at is null or revoked_at >= granted_at)
);

create index if not exists consents_patient_idx on public.consents (patient_id, granted_at desc);

-- Um consentimento vigente por paciente e finalidade. Revogado libera novo.
create unique index if not exists consents_active_unique
  on public.consents (patient_id, purpose)
  where revoked_at is null;

create table if not exists public.sessions (
  id               uuid primary key default gen_random_uuid(),
  patient_id       uuid not null references public.patients (id) on delete cascade,
  professional_id  uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  clinic_id        uuid not null default public.current_clinic_id()
                     references public.clinics (id) on delete restrict,
  created_at       timestamptz not null default now(),

  -- Ponteiro para o IndexedDB do dispositivo. NUNCA a imagem, nunca um caminho
  -- de Storage, nunca base64. Em outro tablet a sessão abre sem foto e oferece
  -- nova captura, reancorando as aplicações pelos landmarks.
  local_image_ref  uuid not null,

  -- Distância interpupilar medida em pixels da foto. Só para auditoria de
  -- escala: tudo que é amplitude e raio vive em fração de DIP.
  ipd_px           double precision not null check (ipd_px > 0),

  -- Ângulo da foto no momento da captura, em graus. A captura só é aceita
  -- dentro de ±10° do frontal; o banco guarda o valor efetivo para que uma
  -- comparação futura saiba de que ângulo partiu.
  yaw              double precision not null check (yaw between -90 and 90),
  pitch            double precision not null check (pitch between -90 and 90),
  roll             double precision not null check (roll between -90 and 90)
);

create index if not exists sessions_patient_idx on public.sessions (patient_id, created_at desc);
create index if not exists sessions_clinic_idx on public.sessions (clinic_id, created_at desc);
create unique index if not exists sessions_local_image_ref_idx on public.sessions (local_image_ref);

-- Atlas clínico, espelhado de lib/face/atlas.ts.
create table if not exists public.regions (
  id          text primary key check (id ~ '^[a-z][a-z0-9_]{2,40}$'),
  label       text not null,
  symmetric   boolean not null default false,
  sort_order  smallint not null default 0
);

insert into public.regions (id, label, symmetric, sort_order) values
  ('glabella',        'Glabela',           false,  10),
  ('frontal',         'Frontal',           false,  20),
  ('periorbital',     'Periorbital',       true,   30),
  ('malar',           'Malar',             true,   40),
  ('nasolabial_fold', 'Sulco nasogeniano', true,   50),
  ('nasal_dorsum',    'Dorso nasal',       false,  60),
  ('upper_lip',       'Lábio superior',    false,  70),
  ('lower_lip',       'Lábio inferior',    false,  80),
  ('chin',            'Mento',             false,  90),
  ('jawline',         'Linha mandibular',  true,  100)
on conflict (id) do update
  set label = excluded.label,
      symmetric = excluded.symmetric,
      sort_order = excluded.sort_order;

create table if not exists public.applications (
  id               uuid primary key default gen_random_uuid(),
  session_id       uuid not null references public.sessions (id) on delete cascade,
  region_id        text not null references public.regions (id) on delete restrict,
  technique        public.technique not null,

  -- Coordenada normalizada do toque na foto, 0..1.
  point_u          double precision not null check (point_u between 0 and 1),
  point_v          double precision not null check (point_v between 0 and 1),

  -- Ancoragem: índice do landmark (0..477) mais o deslocamento em fração de
  -- DIP. Foto nova do mesmo paciente reposiciona a aplicação sozinha.
  anchor_landmark  smallint not null check (anchor_landmark between 0 and 477),
  anchor_offset_u  double precision not null check (anchor_offset_u between -2 and 2),
  anchor_offset_v  double precision not null check (anchor_offset_v between -2 and 2),

  -- Adimensional. NÃO é dose, NÃO é volume, NÃO é unidade. A tradução para
  -- produto é do profissional, via region_presets.
  intensity        double precision not null check (intensity between 0 and 1),

  -- Raio em fração de DIP. Nunca pixel.
  radius_ipd       double precision not null check (radius_ipd > 0 and radius_ipd <= 1),

  created_at       timestamptz not null default now()
);

create index if not exists applications_session_idx on public.applications (session_id, created_at);
create index if not exists applications_region_idx on public.applications (region_id);

-- Aqui, e só aqui, o profissional registra produto, diluição e dose, em texto
-- livre (`notes`). O código nunca calcula nem sugere dose.
create table if not exists public.region_presets (
  id                  uuid primary key default gen_random_uuid(),
  clinic_id           uuid not null default public.current_clinic_id()
                        references public.clinics (id) on delete cascade,
  region_id           text not null references public.regions (id) on delete restrict,
  technique           public.technique not null,
  label               text not null check (length(btrim(label)) between 2 and 120),
  default_intensity   double precision not null check (default_intensity between 0 and 1),
  default_radius_ipd  double precision not null check (default_radius_ipd > 0 and default_radius_ipd <= 1),
  notes               text check (length(notes) <= 4000),
  created_at          timestamptz not null default now(),
  unique (clinic_id, region_id, technique, label)
);

create index if not exists region_presets_clinic_idx on public.region_presets (clinic_id, region_id);

-- ===========================================================================
-- 5. Trilha de auditoria
--
-- Insert-only. Ninguém atualiza, ninguém apaga: nem profissional, nem admin da
-- clínica. Uma trilha que pode ser reescrita não é trilha.
-- ===========================================================================

create table if not exists public.audit_log (
  id         bigint generated always as identity primary key,
  actor_id   uuid references public.profiles (id) on delete set null,
  action     public.audit_action not null,
  entity     text not null check (entity ~ '^[a-z_]{3,40}$'),
  entity_id  text not null,
  at         timestamptz not null default now(),
  meta       jsonb not null default '{}'::jsonb
);

create index if not exists audit_log_actor_idx on public.audit_log (actor_id, at desc);
create index if not exists audit_log_entity_idx on public.audit_log (entity, entity_id, at desc);

comment on table public.audit_log is
  'Insert-only. Sem update e sem delete para qualquer papel.';
comment on column public.audit_log.meta is
  'Metadados da operação. NUNCA imagem, nunca base64, nunca texto clínico livre.';

-- Registra a operação sem copiar o conteúdo da linha: só a entidade, o id e as
-- colunas que permitem reconstruir o que mudou. Copiar a linha inteira
-- transformaria o audit_log num segundo banco de dados pessoais.
create or replace function public.tg_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_new jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_old jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_meta jsonb := '{}'::jsonb;
begin
  if tg_table_name = 'applications' then
    v_meta := jsonb_build_object(
      'session_id', v_row ->> 'session_id',
      'region_id',  v_row ->> 'region_id',
      'technique',  v_row ->> 'technique'
    );
  elsif tg_table_name = 'consents' then
    v_meta := jsonb_build_object(
      'patient_id',    v_row ->> 'patient_id',
      'terms_version', v_row ->> 'terms_version',
      'revoked',       (v_row ->> 'revoked_at') is not null
    );
  elsif tg_table_name = 'sessions' then
    v_meta := jsonb_build_object('patient_id', v_row ->> 'patient_id');
  elsif tg_table_name = 'region_presets' then
    v_meta := jsonb_build_object(
      'region_id', v_row ->> 'region_id',
      'technique', v_row ->> 'technique'
    );
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, meta)
  values (auth.uid(), lower(tg_op)::public.audit_action, tg_table_name, v_row ->> 'id', v_meta);

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists audit_patients on public.patients;
create trigger audit_patients
  after insert or update or delete on public.patients
  for each row execute function public.tg_audit();

drop trigger if exists audit_sessions on public.sessions;
create trigger audit_sessions
  after insert or update or delete on public.sessions
  for each row execute function public.tg_audit();

drop trigger if exists audit_applications on public.applications;
create trigger audit_applications
  after insert or update or delete on public.applications
  for each row execute function public.tg_audit();

drop trigger if exists audit_consents on public.consents;
create trigger audit_consents
  after insert or update or delete on public.consents
  for each row execute function public.tg_audit();

drop trigger if exists audit_region_presets on public.region_presets;
create trigger audit_region_presets
  after insert or update or delete on public.region_presets
  for each row execute function public.tg_audit();

-- ===========================================================================
-- 6. Imutabilidade do que não pode ser reescrito
-- ===========================================================================

-- Consentimento não se edita: só se revoga. A política de RLS restringe o
-- UPDATE ao ato de revogar, mas política não impede que o mesmo UPDATE altere
-- de carona a assinatura ou a versão dos termos. Este gatilho impede.
create or replace function public.tg_consents_immutable()
returns trigger
language plpgsql
as $$
begin
  if new.patient_id      is distinct from old.patient_id
     or new.professional_id is distinct from old.professional_id
     or new.purpose         is distinct from old.purpose
     or new.granted_at      is distinct from old.granted_at
     or new.signature_svg   is distinct from old.signature_svg
     or new.terms_version   is distinct from old.terms_version
  then
    raise exception 'Consentimento é imutável: só a revogação pode ser registrada.'
      using errcode = 'check_violation';
  end if;

  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'Consentimento já revogado não pode ser alterado.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists consents_immutable on public.consents;
create trigger consents_immutable
  before update on public.consents
  for each row execute function public.tg_consents_immutable();

-- A sessão registra as condições em que a foto foi tirada. Se essas condições
-- pudessem ser reescritas depois, a auditoria de escala e de ângulo não valeria
-- nada — seria possível justificar um "depois" exagerado inventando o ângulo.
create or replace function public.tg_sessions_capture_immutable()
returns trigger
language plpgsql
as $$
begin
  if new.local_image_ref is distinct from old.local_image_ref
     or new.ipd_px  is distinct from old.ipd_px
     or new.yaw     is distinct from old.yaw
     or new.pitch   is distinct from old.pitch
     or new.roll    is distinct from old.roll
     or new.patient_id is distinct from old.patient_id
     or new.clinic_id  is distinct from old.clinic_id
  then
    raise exception 'Condições de captura da sessão são imutáveis.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists sessions_capture_immutable on public.sessions;
create trigger sessions_capture_immutable
  before update on public.sessions
  for each row execute function public.tg_sessions_capture_immutable();

-- ===========================================================================
-- 7. Pareamento para captura pelo celular
--
-- O computador do consultório costuma ter webcam ruim ou nenhuma. O
-- profissional abre a prévia no computador, aponta o celular para um QR e
-- fotografa lá; a foto atravessa direto de um aparelho para o outro por WebRTC.
--
-- Esta tabela guarda SÓ a sinalização do WebRTC: as descrições de sessão (SDP)
-- que os dois lados trocam para se acharem na rede local. Nenhum byte de imagem
-- passa por aqui — nem cifrado.
-- ===========================================================================

create table if not exists public.pairings (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null default public.current_clinic_id()
                references public.clinics (id) on delete cascade,
  created_by  uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  session_id  uuid not null,
  patient_id  uuid not null references public.patients (id) on delete cascade,
  created_at  timestamptz not null default now(),

  -- Cinco minutos. O pareamento é um gesto, não um recurso: o QR fica na tela
  -- por segundos e quem o fotografou de longe não deve poder usá-lo depois.
  expires_at  timestamptz not null default now() + interval '5 minutes',

  offer       text not null check (length(offer) between 32 and 65536),
  answer      text check (length(answer) between 32 and 65536),
  claimed_at  timestamptz
);

create index if not exists pairings_clinic_idx on public.pairings (clinic_id, created_at desc);
create index if not exists pairings_expiry_idx on public.pairings (expires_at);

comment on table public.pairings is
  'Sinalização WebRTC para captura pelo celular. Nunca guarda imagem.';

-- O celular não está autenticado: quem escaneia o QR não faz login. O acesso é
-- por posse do identificador — 128 bits aleatórios, válidos por cinco minutos.
-- Por isso o celular NÃO recebe acesso à tabela, e sim a duas funções que só
-- respondem sobre a linha cujo id ele já conhece. Política aberta na tabela
-- deixaria qualquer anônimo listar todos os pareamentos da instalação.
create or replace function public.pairing_claim(p_id uuid)
returns table (patient_name text, offer text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pairing public.pairings;
begin
  select * into v_pairing from public.pairings where id = p_id;

  if v_pairing.id is null then
    raise exception 'Pareamento não encontrado.' using errcode = 'no_data_found';
  end if;

  if v_pairing.expires_at <= now() then
    raise exception 'Pareamento expirado.' using errcode = 'check_violation';
  end if;

  -- Reaproveitar é permitido enquanto a resposta não veio — o celular pode ter
  -- recarregado a página. Depois disso o pareamento está gasto.
  if v_pairing.answer is not null then
    raise exception 'Pareamento já utilizado.' using errcode = 'check_violation';
  end if;

  update public.pairings
     set claimed_at = coalesce(claimed_at, now())
   where id = p_id;

  return query
    select p.full_name, v_pairing.offer
      from public.patients p
     where p.id = v_pairing.patient_id;
end;
$$;

create or replace function public.pairing_answer(p_id uuid, p_answer text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_answer is null or length(p_answer) not between 32 and 65536 then
    raise exception 'Resposta inválida.' using errcode = 'check_violation';
  end if;

  update public.pairings
     set answer = p_answer
   where id = p_id
     and expires_at > now()
     and answer is null;

  if not found then
    raise exception 'Pareamento indisponível.' using errcode = 'check_violation';
  end if;
end;
$$;

revoke all on function public.pairing_claim(uuid) from public;
revoke all on function public.pairing_answer(uuid, text) from public;
grant execute on function public.pairing_claim(uuid) to anon, authenticated;
grant execute on function public.pairing_answer(uuid, text) to anon, authenticated;

-- ===========================================================================
-- 8. Row Level Security
--
-- RLS habilitada em TODAS as tabelas, sem exceção. Leitura e escrita apenas de
-- linhas da própria clinic_id do usuário autenticado.
--
-- Nota sobre FORCE ROW LEVEL SECURITY: não é usado de propósito. O gatilho de
-- auditoria é SECURITY DEFINER e escreve em audit_log como dono da tabela; com
-- FORCE, esse insert seria barrado porque as políticas são concedidas ao papel
-- `authenticated` e o gatilho não roda como `authenticated`. O papel dono e o
-- service_role são privilegiados por construção — a fronteira que importa é a
-- do usuário autenticado, e essa está coberta abaixo.
-- ===========================================================================

alter table public.clinics        enable row level security;
alter table public.profiles       enable row level security;
alter table public.patients       enable row level security;
alter table public.consents       enable row level security;
alter table public.sessions       enable row level security;
alter table public.regions        enable row level security;
alter table public.applications   enable row level security;
alter table public.region_presets enable row level security;
alter table public.audit_log      enable row level security;
alter table public.pairings       enable row level security;

-- --------------------------------------------------------------------------
-- clinics
-- --------------------------------------------------------------------------

drop policy if exists clinics_select on public.clinics;
create policy clinics_select on public.clinics
  for select to authenticated
  using (id = public.current_clinic_id());

drop policy if exists clinics_update on public.clinics;
create policy clinics_update on public.clinics
  for update to authenticated
  using (id = public.current_clinic_id() and public.is_clinic_admin())
  with check (id = public.current_clinic_id());

-- --------------------------------------------------------------------------
-- profiles
-- --------------------------------------------------------------------------

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (clinic_id = public.current_clinic_id());

drop policy if exists profiles_insert_admin on public.profiles;
create policy profiles_insert_admin on public.profiles
  for insert to authenticated
  with check (clinic_id = public.current_clinic_id() and public.is_clinic_admin());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (
    id = auth.uid()
    or (clinic_id = public.current_clinic_id() and public.is_clinic_admin())
  )
  with check (clinic_id = public.current_clinic_id());

-- --------------------------------------------------------------------------
-- patients
-- --------------------------------------------------------------------------

drop policy if exists patients_select on public.patients;
create policy patients_select on public.patients
  for select to authenticated
  using (clinic_id = public.current_clinic_id());

drop policy if exists patients_insert on public.patients;
create policy patients_insert on public.patients
  for insert to authenticated
  with check (clinic_id = public.current_clinic_id() and created_by = auth.uid());

drop policy if exists patients_update on public.patients;
create policy patients_update on public.patients
  for update to authenticated
  using (clinic_id = public.current_clinic_id())
  with check (clinic_id = public.current_clinic_id());

drop policy if exists patients_delete on public.patients;
create policy patients_delete on public.patients
  for delete to authenticated
  using (clinic_id = public.current_clinic_id() and public.is_clinic_admin());

-- --------------------------------------------------------------------------
-- consents — escopo herdado do paciente
-- --------------------------------------------------------------------------

drop policy if exists consents_select on public.consents;
create policy consents_select on public.consents
  for select to authenticated
  using (exists (
    select 1 from public.patients p
    where p.id = consents.patient_id and p.clinic_id = public.current_clinic_id()
  ));

drop policy if exists consents_insert on public.consents;
create policy consents_insert on public.consents
  for insert to authenticated
  with check (
    professional_id = auth.uid()
    and exists (
      select 1 from public.patients p
      where p.id = consents.patient_id and p.clinic_id = public.current_clinic_id()
    )
  );

-- Só a revogação. As colunas assinadas são travadas pelo gatilho
-- consents_immutable; a política garante que o UPDATE só existe para revogar.
drop policy if exists consents_revoke on public.consents;
create policy consents_revoke on public.consents
  for update to authenticated
  using (exists (
    select 1 from public.patients p
    where p.id = consents.patient_id and p.clinic_id = public.current_clinic_id()
  ))
  with check (revoked_at is not null);

-- --------------------------------------------------------------------------
-- sessions
-- --------------------------------------------------------------------------

drop policy if exists sessions_select on public.sessions;
create policy sessions_select on public.sessions
  for select to authenticated
  using (clinic_id = public.current_clinic_id());

drop policy if exists sessions_insert on public.sessions;
create policy sessions_insert on public.sessions
  for insert to authenticated
  with check (
    clinic_id = public.current_clinic_id()
    and professional_id = auth.uid()
    and exists (
      select 1 from public.patients p
      where p.id = sessions.patient_id and p.clinic_id = public.current_clinic_id()
    )
    -- Não se simula sem consentimento vigente.
    and exists (
      select 1 from public.consents c
      where c.patient_id = sessions.patient_id
        and c.purpose = 'simulation'
        and c.revoked_at is null
    )
  );

drop policy if exists sessions_update on public.sessions;
create policy sessions_update on public.sessions
  for update to authenticated
  using (clinic_id = public.current_clinic_id())
  with check (clinic_id = public.current_clinic_id());

drop policy if exists sessions_delete on public.sessions;
create policy sessions_delete on public.sessions
  for delete to authenticated
  using (clinic_id = public.current_clinic_id());

-- --------------------------------------------------------------------------
-- regions — atlas clínico, leitura para qualquer autenticado
-- --------------------------------------------------------------------------

drop policy if exists regions_select on public.regions;
create policy regions_select on public.regions
  for select to authenticated
  using (true);

-- --------------------------------------------------------------------------
-- applications — escopo herdado da sessão
-- --------------------------------------------------------------------------

drop policy if exists applications_select on public.applications;
create policy applications_select on public.applications
  for select to authenticated
  using (exists (
    select 1 from public.sessions s
    where s.id = applications.session_id and s.clinic_id = public.current_clinic_id()
  ));

drop policy if exists applications_insert on public.applications;
create policy applications_insert on public.applications
  for insert to authenticated
  with check (exists (
    select 1 from public.sessions s
    where s.id = applications.session_id and s.clinic_id = public.current_clinic_id()
  ));

drop policy if exists applications_update on public.applications;
create policy applications_update on public.applications
  for update to authenticated
  using (exists (
    select 1 from public.sessions s
    where s.id = applications.session_id and s.clinic_id = public.current_clinic_id()
  ))
  with check (exists (
    select 1 from public.sessions s
    where s.id = applications.session_id and s.clinic_id = public.current_clinic_id()
  ));

drop policy if exists applications_delete on public.applications;
create policy applications_delete on public.applications
  for delete to authenticated
  using (exists (
    select 1 from public.sessions s
    where s.id = applications.session_id and s.clinic_id = public.current_clinic_id()
  ));

-- --------------------------------------------------------------------------
-- region_presets
-- --------------------------------------------------------------------------

drop policy if exists region_presets_select on public.region_presets;
create policy region_presets_select on public.region_presets
  for select to authenticated
  using (clinic_id = public.current_clinic_id());

drop policy if exists region_presets_insert on public.region_presets;
create policy region_presets_insert on public.region_presets
  for insert to authenticated
  with check (clinic_id = public.current_clinic_id());

drop policy if exists region_presets_update on public.region_presets;
create policy region_presets_update on public.region_presets
  for update to authenticated
  using (clinic_id = public.current_clinic_id())
  with check (clinic_id = public.current_clinic_id());

drop policy if exists region_presets_delete on public.region_presets;
create policy region_presets_delete on public.region_presets
  for delete to authenticated
  using (clinic_id = public.current_clinic_id());

-- --------------------------------------------------------------------------
-- pairings — só o computador da própria clínica
-- --------------------------------------------------------------------------

drop policy if exists pairings_select on public.pairings;
create policy pairings_select on public.pairings
  for select to authenticated
  using (clinic_id = public.current_clinic_id());

drop policy if exists pairings_insert on public.pairings;
create policy pairings_insert on public.pairings
  for insert to authenticated
  with check (
    clinic_id = public.current_clinic_id()
    and created_by = auth.uid()
    and exists (
      select 1 from public.patients p
      where p.id = pairings.patient_id and p.clinic_id = public.current_clinic_id()
    )
  );

drop policy if exists pairings_delete on public.pairings;
create policy pairings_delete on public.pairings
  for delete to authenticated
  using (clinic_id = public.current_clinic_id());

-- --------------------------------------------------------------------------
-- audit_log — insert-only
-- --------------------------------------------------------------------------

drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log
  for select to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = audit_log.actor_id and p.clinic_id = public.current_clinic_id()
  ));

drop policy if exists audit_log_insert on public.audit_log;
create policy audit_log_insert on public.audit_log
  for insert to authenticated
  with check (actor_id = auth.uid());

-- Sem política de update e sem política de delete: com RLS ligada, a ausência
-- de política já nega. A revogação abaixo é o cinto além do suspensório —
-- protege caso alguém adicione uma política permissiva por engano no futuro.
revoke update, delete, truncate on public.audit_log from authenticated, anon;
revoke insert, update, delete, truncate on public.regions from authenticated, anon;

-- --------------------------------------------------------------------------
-- anon não enxerga nada
-- --------------------------------------------------------------------------

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
grant usage on schema public to anon, authenticated;

-- ===========================================================================
-- 9. Bootstrap
--
-- Roda uma vez, depois de criar o usuário em Authentication → Users.
-- Só o SQL Editor pode executar: nem anon nem authenticated recebem permissão.
-- ===========================================================================

create or replace function public.previa_bootstrap(
  p_email          text,
  p_clinic_name    text,
  p_full_name      text,
  p_council_type   text default null,
  p_council_number text default null
)
returns text
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_user_id   uuid;
  v_clinic_id uuid;
begin
  select id into v_user_id
    from auth.users
   where lower(email) = lower(btrim(p_email))
   limit 1;

  if v_user_id is null then
    raise exception
      'Nenhum usuário com o e-mail %. Crie em Authentication → Users antes de rodar isto.',
      p_email;
  end if;

  -- A ficha exportada carrega conselho e número; sem os dois o PDF não
  -- identifica o responsável. Os dois juntos, ou nenhum.
  if (p_council_type is null) <> (p_council_number is null) then
    raise exception 'Informe conselho e número de registro juntos, ou nenhum dos dois.';
  end if;

  select id into v_clinic_id
    from public.clinics
   where name = btrim(p_clinic_name)
   limit 1;

  if v_clinic_id is null then
    insert into public.clinics (name)
    values (btrim(p_clinic_name))
    returning id into v_clinic_id;
  end if;

  insert into public.profiles (id, clinic_id, full_name, council_type, council_number, role)
  values (
    v_user_id,
    v_clinic_id,
    btrim(p_full_name),
    nullif(btrim(coalesce(p_council_type, '')), '')::public.council_type,
    nullif(btrim(coalesce(p_council_number, '')), ''),
    'admin'
  )
  on conflict (id) do update
     set clinic_id      = excluded.clinic_id,
         full_name      = excluded.full_name,
         council_type   = excluded.council_type,
         council_number = excluded.council_number,
         role           = excluded.role;

  return format('Pronto. Clínica %s, profissional %s.', btrim(p_clinic_name), btrim(p_full_name));
end;
$$;

revoke all on function public.previa_bootstrap(text, text, text, text, text) from public, anon, authenticated;

-- ===========================================================================
-- 10. Recarrega o cache de schema do PostgREST
-- ===========================================================================

notify pgrst, 'reload schema';
