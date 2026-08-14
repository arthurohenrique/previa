-- Prévia — seed de desenvolvimento local.
--
-- Cria duas clínicas e dois profissionais. A segunda clínica existe para o teste
-- de isolamento: o usuário da clínica A não pode ler nada da clínica B.
--
-- Nunca rode isto contra produção.

insert into public.clinics (id, name, cnpj) values
  ('11111111-1111-4111-8111-111111111111', 'Clínica Aurora',  '11222333000181'),
  ('22222222-2222-4222-8222-222222222222', 'Clínica Boreal',  '44555666000172');

-- Usuários de teste. Senha: previa-dev-2026
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
) values
  (
    '00000000-0000-0000-0000-000000000000',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'authenticated', 'authenticated', 'aurora@previa.test',
    crypt('previa-dev-2026', gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}', '{}'
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'authenticated', 'authenticated', 'boreal@previa.test',
    crypt('previa-dev-2026', gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}', '{}'
  );

insert into auth.identities (
  id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
) values
  (
    gen_random_uuid(), 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","email":"aurora@previa.test"}',
    'email', now(), now(), now()
  ),
  (
    gen_random_uuid(), 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","email":"boreal@previa.test"}',
    'email', now(), now(), now()
  );

insert into public.profiles (id, clinic_id, full_name, council_type, council_number, role) values
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111',
    'Ana Ribeiro', 'CRM', '123456', 'admin'
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222',
    'Bruno Tavares', 'CRO', '654321', 'admin'
  );

-- Protocolos: o texto de produto e dose é do profissional. O código nunca
-- preenche isto sozinho.
insert into public.region_presets
  (clinic_id, region_id, technique, label, default_intensity, default_radius_ipd, notes)
values
  ('11111111-1111-4111-8111-111111111111', 'glabella', 'toxin',
   'Glabela — protocolo padrão', 0.55, 0.16,
   'Registre aqui produto, diluição e dose conforme o protocolo da clínica.'),
  ('11111111-1111-4111-8111-111111111111', 'nasolabial_fold', 'filler',
   'Sulco nasogeniano — leve', 0.35, 0.13,
   'Registre aqui produto, volume e plano de aplicação.'),
  ('11111111-1111-4111-8111-111111111111', 'malar', 'biostimulator',
   'Malar — sustentação', 0.30, 0.26,
   'Registre aqui produto, diluição e número de sessões.');
