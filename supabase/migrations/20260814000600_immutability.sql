-- Prévia — imutabilidade do que não pode ser reescrito.

-- Consentimento não se edita: só se revoga. A política de RLS restringe o UPDATE
-- ao ato de revogar, mas política não impede que o mesmo UPDATE altere de
-- carona a assinatura ou a versão dos termos. Este gatilho impede.
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

create trigger sessions_capture_immutable
  before update on public.sessions
  for each row execute function public.tg_sessions_capture_immutable();
