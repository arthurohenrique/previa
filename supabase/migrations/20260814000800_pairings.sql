-- Prévia — pareamento para captura pelo celular.
--
-- O computador do consultório costuma ter webcam ruim ou nenhuma. O profissional
-- abre a prévia no computador, aponta o celular para um QR e fotografa lá; a
-- foto atravessa direto de um aparelho para o outro por WebRTC.
--
-- Esta tabela guarda SÓ a sinalização do WebRTC: as descrições de sessão (SDP)
-- que os dois lados trocam para se acharem na rede local. Nenhum byte de imagem
-- passa por aqui — nem cifrado. Se você se pegar acrescentando uma coluna de
-- blob, pare: o transporte da foto é o DataChannel, e é assim de propósito.

create table public.pairings (
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

  -- Descrições de sessão do WebRTC. Texto, não imagem.
  offer       text not null check (length(offer) between 32 and 65536),
  answer      text check (length(answer) between 32 and 65536),
  claimed_at  timestamptz
);

create index pairings_clinic_idx on public.pairings (clinic_id, created_at desc);
create index pairings_expiry_idx on public.pairings (expires_at);

alter table public.pairings enable row level security;

-- O computador enxerga e apaga só os pareamentos da própria clínica.
create policy pairings_select on public.pairings
  for select to authenticated
  using (clinic_id = public.current_clinic_id());

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

create policy pairings_delete on public.pairings
  for delete to authenticated
  using (clinic_id = public.current_clinic_id());

-- O celular não está autenticado: quem escaneia o QR não faz login. O acesso é
-- por posse do identificador — 128 bits aleatórios, válidos por cinco minutos.
-- Por isso o celular NÃO recebe acesso à tabela, e sim a duas funções que só
-- respondem sobre a linha cujo id ele já conhece. Política aberta na tabela
-- deixaria qualquer anônimo listar todos os pareamentos da instalação.
revoke all on public.pairings from anon;

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

comment on table public.pairings is
  'Sinalização WebRTC para captura pelo celular. Nunca guarda imagem.';
