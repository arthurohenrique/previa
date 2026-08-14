-- Prévia — extensões e tipos.
--
-- Nada neste banco guarda imagem. Ele só conhece metadados: quem simulou,
-- quando, em quais regiões, com que intensidade, e o registro de consentimento.

create extension if not exists "pgcrypto" with schema extensions;

create type public.app_role as enum ('admin', 'professional');

create type public.council_type as enum ('CRM', 'CRO', 'CRF', 'CRBM', 'COREN');

-- Técnicas de simulação. São efeitos visuais distintos, não intensidades do
-- mesmo controle — ver lib/warp/pipeline.ts.
create type public.technique as enum (
  'filler',          -- preenchedor de ácido hialurônico
  'toxin',           -- toxina botulínica
  'biostimulator',   -- bioestimulador de colágeno
  'rhinomodeling'    -- rinomodelação
);

create type public.consent_purpose as enum ('simulation');

create type public.audit_action as enum ('insert', 'update', 'delete');
