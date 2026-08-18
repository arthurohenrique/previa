-- Prévia — tabelas de domínio.
--
-- Princípio: coluna nenhuma guarda bytes de imagem. `sessions.local_image_ref` é
-- um UUID que só faz sentido dentro do IndexedDB do tablet que capturou a foto.

-- ---------------------------------------------------------------------------
-- patients — o mínimo para identificar a sessão
-- ---------------------------------------------------------------------------

-- Sem CPF, sem endereço, sem telefone nesta v1. Cada campo a mais é um dado
-- pessoal a mais para proteger sem que o simulador precise dele.
create table public.patients (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null default public.current_clinic_id()
                references public.clinics (id) on delete restrict,
  full_name   text not null check (length(btrim(full_name)) between 2 and 200),
  birth_year  smallint check (birth_year between 1900 and 2200),
  created_by  uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  created_at  timestamptz not null default now()
);

create index patients_clinic_id_idx on public.patients (clinic_id, created_at desc);

-- ---------------------------------------------------------------------------
-- consents — assinatura no dedo ou no Apple Pencil
-- ---------------------------------------------------------------------------

create table public.consents (
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

create index consents_patient_idx on public.consents (patient_id, granted_at desc);

-- Um consentimento vigente por paciente e finalidade. Revogado libera novo.
create unique index consents_active_unique
  on public.consents (patient_id, purpose)
  where revoked_at is null;

-- ---------------------------------------------------------------------------
-- sessions
-- ---------------------------------------------------------------------------

create table public.sessions (
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

  -- Distância interpupilar medida em pixels da foto original. Só para auditoria
  -- de escala: tudo que é amplitude e raio vive em fração de DIP.
  ipd_px           double precision not null check (ipd_px > 0),

  -- Ângulo da foto no momento da captura, em graus. A captura só é aceita
  -- dentro de ±10° do frontal (lib/face/quality.ts); o banco guarda o valor
  -- efetivo para que uma comparação futura saiba de que ângulo partiu.
  yaw              double precision not null check (yaw between -90 and 90),
  pitch            double precision not null check (pitch between -90 and 90),
  roll             double precision not null check (roll between -90 and 90)
);

create index sessions_patient_idx on public.sessions (patient_id, created_at desc);
create index sessions_clinic_idx on public.sessions (clinic_id, created_at desc);
create unique index sessions_local_image_ref_idx on public.sessions (local_image_ref);

-- ---------------------------------------------------------------------------
-- regions — o atlas clínico, espelhado de lib/face/atlas.ts
-- ---------------------------------------------------------------------------

create table public.regions (
  id          text primary key check (id ~ '^[a-z][a-z0-9_]{2,40}$'),
  label       text not null,
  -- `symmetric` seria o nome óbvio, e é palavra reservada no PostgreSQL
  -- (`BETWEEN SYMMETRIC`): a criação da tabela falha com erro de sintaxe.
  -- `bilateral` é o termo clínico correto de qualquer forma — a região tem par
  -- esquerdo e direito.
  bilateral   boolean not null default false,
  sort_order  smallint not null default 0
);

insert into public.regions (id, label, bilateral, sort_order) values
  ('glabella',        'Glabela',           false,  10),
  ('frontal',         'Frontal',           false,  20),
  ('periorbital',     'Periorbital',       true,   30),
  ('malar',           'Malar',             true,   40),
  ('nasolabial_fold', 'Sulco nasogeniano', true,   50),
  ('nasal_dorsum',    'Dorso nasal',       false,  60),
  ('upper_lip',       'Lábio superior',    false,  70),
  ('lower_lip',       'Lábio inferior',    false,  80),
  ('chin',            'Mento',             false,  90),
  ('jawline',         'Linha mandibular',  true,  100);

-- ---------------------------------------------------------------------------
-- applications — uma marcação do profissional sobre a foto
-- ---------------------------------------------------------------------------

create table public.applications (
  id               uuid primary key default gen_random_uuid(),
  session_id       uuid not null references public.sessions (id) on delete cascade,
  region_id        text not null references public.regions (id) on delete restrict,
  technique        public.technique not null,

  -- Coordenada normalizada do toque na foto, 0..1. Serve para redesenhar o
  -- marcador; a posição efetiva do efeito vem da âncora abaixo.
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

create index applications_session_idx on public.applications (session_id, created_at);
create index applications_region_idx on public.applications (region_id);

-- ---------------------------------------------------------------------------
-- region_presets — protocolo da clínica
-- ---------------------------------------------------------------------------

-- Aqui, e só aqui, o profissional registra produto, diluição e dose, em texto
-- livre (`notes`). O código nunca calcula nem sugere dose.
create table public.region_presets (
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

create index region_presets_clinic_idx on public.region_presets (clinic_id, region_id);
