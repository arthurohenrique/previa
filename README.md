# Prévia

Simulador de procedimentos estéticos faciais para uso clínico em iPad.

O profissional fotografa o paciente no tablet, o sistema detecta o rosto e exibe
todas as regiões tratáveis sobre a foto, o profissional toca na região onde
aplicaria o procedimento, e a simulação aparece na própria foto, com comparação
antes/depois.

Não é câmera ao vivo. É foto estática com feedback em tempo real: a detecção
acontece uma vez, e o render responde a cada toque em menos de 16 ms.

O nome é o contrato do produto: uma prévia, não uma promessa.

---

## A regra de ouro

**A foto do paciente nunca sai do dispositivo.**

- Detecção, warp, render e export acontecem 100% no cliente.
- A imagem é persistida apenas em IndexedDB local.
- O Supabase armazena somente metadados: quem simulou, quando, em quais regiões,
  com que intensidade, e o registro de consentimento.
- Não existe bucket de Storage para foto de paciente.

Foto de rosto de paciente é dado pessoal sensível de saúde na LGPD. Manter tudo
local elimina transferência, subprocessador e a maior parte da superfície de
risco. Essa decisão molda toda a arquitetura — está registrada como D-01 em
[`DECISIONS.md`](./DECISIONS.md) e é verificada por teste automatizado.

---

## Começar

```bash
pnpm install                # inclui a cópia do runtime WASM do MediaPipe
cp .env.example .env.local
pnpm dev
```

### Banco, num projeto Supabase hospedado

Um script só, idempotente: **[`supabase/setup.sql`](./supabase/setup.sql)**. Ele
cria tipos, tabelas, helpers de RLS, todas as políticas, os gatilhos de auditoria
e de imutabilidade, o pareamento do celular e o atlas de regiões semeado.

1. SQL Editor do projeto → cole o arquivo inteiro → **Run**.
2. Authentication → Users → **Add user** com e-mail e senha do profissional,
   marcando *Auto Confirm User*.
3. Volte ao SQL Editor e rode uma vez, com os seus dados:

   ```sql
   select public.previa_bootstrap(
     'voce@suaclinica.com.br',   -- e-mail do usuário do passo 2
     'Clínica Aurora',           -- nome da clínica
     'Ana Ribeiro',              -- nome do profissional
     'CRM',                      -- CRM, CRO, CRF, CRBM ou COREN
     '123456'                    -- número de registro
   );
   ```

   Cria a clínica se não existir e vincula o usuário a ela como admin. Rodar de
   novo atualiza em vez de duplicar.

4. Authentication → Providers → Email: desligue **Enable Sign Up**. O Prévia não
   tem cadastro aberto; usuários são criados pela clínica.

5. `.env.local`:

   ```bash
   NEXT_PUBLIC_SUPABASE_URL=https://<projeto>.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
   NEXT_PUBLIC_TERMS_VERSION=2026-08-01
   ```

Rodar o script mais de uma vez é seguro: tabelas e índices usam `if not exists`,
tipos ficam em bloco que engole duplicata, políticas e gatilhos são derrubados
antes de recriados, e o atlas reconcilia em vez de duplicar. Nenhum caminho
apaga dado.

Primeiro uso: cadastrar paciente → **registrar consentimento** → Nova prévia. A
política de RLS recusa criar sessão sem consentimento vigente; é regra, não bug.

### Banco, local

Requisitos: [Supabase CLI](https://supabase.com/docs/guides/cli).

```bash
supabase start     # Postgres, Auth e Studio locais
pnpm db:reset      # aplica as migrations e o seed de duas clínicas
```

As migrations em `supabase/migrations/` são a fonte para o ambiente local;
`setup.sql` é a mesma coisa achatada num arquivo. `tests/setup-sql.test.ts`
prende as duas para não divergirem.

Usuários do seed local — senha `previa-dev-2026`:

| E-mail | Clínica | Papel |
|---|---|---|
| `aurora@previa.test` | Aurora | admin |
| `boreal@previa.test` | Boreal | admin |

A segunda clínica existe para o teste de isolamento: o usuário da clínica A não
pode ler nada da clínica B.

---

## Fotografar pelo celular

Quando a prévia é aberta num computador, a webcam do monitor não serve: não
enquadra rosto de perto, e a validação de qualidade reprova. A tela de captura
oferece **Fotografar pelo celular** — no computador ela vira a ação principal.

O computador mostra um QR, o celular abre, fotografa, e a foto volta **direto de
um aparelho para o outro** por WebRTC, cifrada. O servidor troca só as descrições
de sessão do WebRTC; nenhum byte de imagem passa por ele.

Requisitos e limites, todos deliberados:

- **Mesma rede.** Sem STUN e sem TURN: um relay levaria os bytes por um terceiro
  e um STUN público entregaria os endereços da clínica. Fora da mesma rede a
  ligação falha com mensagem que diz o que fazer.
- **HTTPS.** `RTCPeerConnection` só existe em contexto seguro. Em
  desenvolvimento, use um túnel HTTPS ou teste em ambiente publicado — o celular
  em `http://<ip>:3000` não pareia.
- **Cinco minutos.** O pareamento expira e é queimado assim que se completa.
- O celular limpa a foto antes de enviar — HEIC vira JPEG, 2048 px, EXIF e GPS
  apagados — e não a grava em lugar nenhum.

Isso emenda a regra de ouro: a foto passa a existir em dois aparelhos da clínica.
A justificativa está em D-16 no [`DECISIONS.md`](./DECISIONS.md).

---

## Comandos

| Comando | O que faz |
|---|---|
| `pnpm dev` | Servidor de desenvolvimento (Turbopack) |
| `pnpm build` | Build de produção |
| `pnpm lint` | ESLint com flat config — `next lint` não existe mais no Next 16 |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Vitest (unidade e guardas de produto) |
| `pnpm test:e2e` | Playwright em viewport de iPad, retrato e paisagem |
| `pnpm db:reset` | Recria o banco local a partir das migrations |
| `node scripts/generate-icons.mjs` | Regera os ícones da PWA |

### Bancada do warp

`/diagnostico/warp` monta o pipeline de deformação isolado, com foto e geometria
determinísticas, e expõe a leitura dos pixels do resultado. Só existe fora de
produção.

Ela responde à única pergunta que importa neste produto: **aplicar um
procedimento muda mesmo a foto, no lugar certo e na medida certa?** Isso não é
verificável por teste de unidade — o efeito nasce num shader. `e2e/warp.spec.ts`
mede pixel e afirma:

- sem aplicação, o quadro é idêntico a si mesmo;
- intensidade zero não muda nada, e mais intensidade muda mais;
- a mudança fica dentro do polígono da região;
- remover a aplicação devolve a foto original, pixel por pixel;
- o tecido se desloca de verdade, medido pelo desvio de uma grade de referência,
  e **dentro do teto da região**.

A foto de teste é uma grade fina: um deslocamento de poucos pixels move linhas de
alto contraste e vira número, coisa que uma pele lisa sintética esconderia.

Deslocamento máximo medido, com DIP de 63 mm:

| técnica | intensidade 1 | teto |
|---|---|---|
| Preenchedor (malar) | 0,033 DIP · 2,1 mm | 0,034 |
| Bioestimulador (malar) | 0,018 DIP · 1,1 mm | 0,020 |
| Rinomodelação (dorso) | 0,026 DIP · 1,6 mm | 0,031 |
| Toxina (malar) | 0,006 DIP · 0,4 mm | 0,006 |

```bash
pnpm dev
E2E_BASE_URL=http://localhost:3000 pnpm exec playwright test warp
```

### Bancada de render

`/diagnostico/render` monta o simulador com foto e geometria sintéticas, sem
detecção e sem paciente. Só existe fora de produção.

Ela existe porque os defeitos que quebram a tela do simulador não aparecem em
`tsc`, em `eslint` nem em teste de unidade — aparecem como tela preta. Dois já
aconteceram: um programa GLSL que não ligava por precisão de uniform divergente
(D-18), e uma animação com `fill-mode: both` que sobrescrevia o `transform` que
posiciona os pontos das regiões.

```bash
pnpm dev                                       # num terminal
E2E_BASE_URL=http://localhost:3000 pnpm exec playwright test render
```

### Testes que precisam de ambiente

- `tests/rls.test.ts` fala com o Supabase de verdade. Sem
  `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` ele é pulado —
  um teste de RLS que não fala com o Postgres não testa RLS.
- O caminho completo de captura em `e2e/privacidade.spec.ts` precisa de uma foto
  frontal real em `E2E_FACE_PHOTO`: nenhuma imagem sintética produz 478
  landmarks. O restante do arquivo roda sem ela e já cobre a guarda de rede.

---

## Como está montado

```
app/(auth)/login            entrada
app/(app)/pacientes         lista, ficha e consentimento
app/(app)/sessao/[id]       a tela do simulador
app/(app)/presets           protocolos da clínica
lib/face                    landmarker, atlas, hit-test, escala em DIP, qualidade
lib/warp                    campo de deslocamento, shaders, máscaras, pipeline Pixi
lib/db/dexie.ts             fotos e sessões locais
lib/pairing                 ponte WebRTC celular → computador
app/captura/[pairId]        tela do celular, rota pública
lib/export/ficha.ts         PDF antes/depois com marca d'água
store/useSessionStore.ts    zustand + zundo (undo/redo)
supabase/migrations         SQL versionado, RLS em todas as tabelas
```

O pipeline, em ordem: captura e limpeza de EXIF → validação bloqueante de
qualidade → detecção em Web Worker → atlas de regiões → toque com hit-test →
campo de deslocamento num passe → warp → separação de frequência → antes/depois
e ficha.

Detalhes e justificativas em [`DECISIONS.md`](./DECISIONS.md); convenções para
quem for mexer no código em [`AGENTS.md`](./AGENTS.md).

---

## Antes de uso clínico

Os polígonos do atlas ainda não foram conferidos sobre um rosto real — a
conferência exige uma foto de paciente num iPad, e a foto não sai do dispositivo
por definição. Ver a seção "Pendência conhecida" em `DECISIONS.md`.

---

## Deploy

Vercel, região `gru1`. Variáveis: `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` — esta última só no
servidor, nunca com prefixo público.
