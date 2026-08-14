-- Prévia — Row Level Security.
--
-- RLS habilitada em TODAS as tabelas, sem exceção. Leitura e escrita apenas de
-- linhas da própria clinic_id do usuário autenticado.
--
-- Nota sobre FORCE ROW LEVEL SECURITY: não é usado aqui de propósito. O gatilho
-- de auditoria é SECURITY DEFINER e escreve em audit_log como dono da tabela;
-- com FORCE, esse insert seria barrado porque as políticas são concedidas ao
-- papel `authenticated` e o gatilho não roda como `authenticated`. O papel dono
-- e o service_role são privilegiados por construção — a fronteira que importa é
-- a do usuário autenticado, e essa está coberta abaixo.

alter table public.clinics        enable row level security;
alter table public.profiles       enable row level security;
alter table public.patients       enable row level security;
alter table public.consents       enable row level security;
alter table public.sessions       enable row level security;
alter table public.regions        enable row level security;
alter table public.applications   enable row level security;
alter table public.region_presets enable row level security;
alter table public.audit_log      enable row level security;

-- ---------------------------------------------------------------------------
-- clinics
-- ---------------------------------------------------------------------------

create policy clinics_select on public.clinics
  for select to authenticated
  using (id = public.current_clinic_id());

create policy clinics_update on public.clinics
  for update to authenticated
  using (id = public.current_clinic_id() and public.is_clinic_admin())
  with check (id = public.current_clinic_id());

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

create policy profiles_select on public.profiles
  for select to authenticated
  using (clinic_id = public.current_clinic_id());

create policy profiles_insert_admin on public.profiles
  for insert to authenticated
  with check (clinic_id = public.current_clinic_id() and public.is_clinic_admin());

create policy profiles_update on public.profiles
  for update to authenticated
  using (
    id = auth.uid()
    or (clinic_id = public.current_clinic_id() and public.is_clinic_admin())
  )
  with check (clinic_id = public.current_clinic_id());

-- ---------------------------------------------------------------------------
-- patients
-- ---------------------------------------------------------------------------

create policy patients_select on public.patients
  for select to authenticated
  using (clinic_id = public.current_clinic_id());

create policy patients_insert on public.patients
  for insert to authenticated
  with check (clinic_id = public.current_clinic_id() and created_by = auth.uid());

create policy patients_update on public.patients
  for update to authenticated
  using (clinic_id = public.current_clinic_id())
  with check (clinic_id = public.current_clinic_id());

create policy patients_delete on public.patients
  for delete to authenticated
  using (clinic_id = public.current_clinic_id() and public.is_clinic_admin());

-- ---------------------------------------------------------------------------
-- consents — escopo herdado do paciente
-- ---------------------------------------------------------------------------

create policy consents_select on public.consents
  for select to authenticated
  using (exists (
    select 1 from public.patients p
    where p.id = consents.patient_id and p.clinic_id = public.current_clinic_id()
  ));

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
create policy consents_revoke on public.consents
  for update to authenticated
  using (exists (
    select 1 from public.patients p
    where p.id = consents.patient_id and p.clinic_id = public.current_clinic_id()
  ))
  with check (revoked_at is not null);

-- ---------------------------------------------------------------------------
-- sessions
-- ---------------------------------------------------------------------------

create policy sessions_select on public.sessions
  for select to authenticated
  using (clinic_id = public.current_clinic_id());

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

create policy sessions_update on public.sessions
  for update to authenticated
  using (clinic_id = public.current_clinic_id())
  with check (clinic_id = public.current_clinic_id());

create policy sessions_delete on public.sessions
  for delete to authenticated
  using (clinic_id = public.current_clinic_id());

-- ---------------------------------------------------------------------------
-- regions — atlas clínico, leitura para qualquer autenticado
-- ---------------------------------------------------------------------------

create policy regions_select on public.regions
  for select to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- applications — escopo herdado da sessão
-- ---------------------------------------------------------------------------

create policy applications_select on public.applications
  for select to authenticated
  using (exists (
    select 1 from public.sessions s
    where s.id = applications.session_id and s.clinic_id = public.current_clinic_id()
  ));

create policy applications_insert on public.applications
  for insert to authenticated
  with check (exists (
    select 1 from public.sessions s
    where s.id = applications.session_id and s.clinic_id = public.current_clinic_id()
  ));

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

create policy applications_delete on public.applications
  for delete to authenticated
  using (exists (
    select 1 from public.sessions s
    where s.id = applications.session_id and s.clinic_id = public.current_clinic_id()
  ));

-- ---------------------------------------------------------------------------
-- region_presets
-- ---------------------------------------------------------------------------

create policy region_presets_select on public.region_presets
  for select to authenticated
  using (clinic_id = public.current_clinic_id());

create policy region_presets_insert on public.region_presets
  for insert to authenticated
  with check (clinic_id = public.current_clinic_id());

create policy region_presets_update on public.region_presets
  for update to authenticated
  using (clinic_id = public.current_clinic_id())
  with check (clinic_id = public.current_clinic_id());

create policy region_presets_delete on public.region_presets
  for delete to authenticated
  using (clinic_id = public.current_clinic_id());

-- ---------------------------------------------------------------------------
-- audit_log — insert-only
-- ---------------------------------------------------------------------------

create policy audit_log_select on public.audit_log
  for select to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = audit_log.actor_id and p.clinic_id = public.current_clinic_id()
  ));

create policy audit_log_insert on public.audit_log
  for insert to authenticated
  with check (actor_id = auth.uid());

-- Sem política de update e sem política de delete: com RLS ligada, a ausência
-- de política já nega. A revogação abaixo é o cinto além do suspensório —
-- protege caso alguém adicione uma política permissiva por engano no futuro.
revoke update, delete, truncate on public.audit_log from authenticated, anon;
revoke insert, update, delete, truncate on public.regions from authenticated, anon;

-- ---------------------------------------------------------------------------
-- anon não enxerga nada
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
grant usage on schema public to anon, authenticated;
