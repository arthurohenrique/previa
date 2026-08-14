-- Prévia — trilha de auditoria.
--
-- Insert-only. Ninguém atualiza, ninguém apaga: nem profissional, nem admin da
-- clínica. Uma trilha que pode ser reescrita não é trilha.

create table public.audit_log (
  id         bigint generated always as identity primary key,
  actor_id   uuid references public.profiles (id) on delete set null,
  action     public.audit_action not null,
  entity     text not null check (entity ~ '^[a-z_]{3,40}$'),
  entity_id  text not null,
  at         timestamptz not null default now(),
  meta       jsonb not null default '{}'::jsonb
);

create index audit_log_actor_idx on public.audit_log (actor_id, at desc);
create index audit_log_entity_idx on public.audit_log (entity, entity_id, at desc);

comment on table public.audit_log is
  'Insert-only. Sem update e sem delete para qualquer papel.';
comment on column public.audit_log.meta is
  'Metadados da operação. NUNCA imagem, nunca base64, nunca texto clínico livre.';

-- ---------------------------------------------------------------------------
-- Gatilho genérico de auditoria
-- ---------------------------------------------------------------------------

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

create trigger audit_patients
  after insert or update or delete on public.patients
  for each row execute function public.tg_audit();

create trigger audit_sessions
  after insert or update or delete on public.sessions
  for each row execute function public.tg_audit();

create trigger audit_applications
  after insert or update or delete on public.applications
  for each row execute function public.tg_audit();

create trigger audit_consents
  after insert or update or delete on public.consents
  for each row execute function public.tg_audit();

create trigger audit_region_presets
  after insert or update or delete on public.region_presets
  for each row execute function public.tg_audit();
