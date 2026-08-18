<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AGENTS.md — Prévia

Simulador de procedimentos estéticos faciais para uso clínico em iPad. Foto
estática com feedback em tempo real: a detecção roda uma vez, o render responde a
cada toque em menos de 16 ms.

Leia `DECISIONS.md` antes de escrever qualquer linha de UI. Ele é normativo.

## Regra de ouro

**A foto do paciente nunca sai do dispositivo.** Detecção, warp, render e export
são 100% cliente. A imagem só existe em IndexedDB. O Supabase guarda metadados.

Se você se pegar escrevendo `multipart/form-data` com uma foto, `FormData.append`
de um `Blob` de imagem, upload para Storage, ou uma coluna `text` recebendo
base64 — pare. Violou a seção 2 da especificação e o teste e2e vai falhar.

Exceção única e registrada: a captura pelo celular (D-16). A foto vai de um
aparelho da clínica ao outro pelo `RTCDataChannel`, sem tocar em servidor. As
actions de pareamento movem descrição de sessão do WebRTC — texto — e um teste
de guarda falha se alguém acrescentar `Blob`, `ArrayBuffer` ou `File` a elas.

## Comandos

```bash
pnpm install          # inclui postinstall que copia o WASM do MediaPipe
pnpm dev              # Turbopack, padrão no Next 16
pnpm build
pnpm lint             # eslint . — `next lint` não existe mais no 16
pnpm typecheck        # tsc --noEmit
pnpm test             # vitest
pnpm test:e2e         # playwright, viewport de iPad
supabase start        # Supabase local
pnpm db:reset         # aplica as migrations do zero
```

## Convenções desta base

### Next 16.3

- App Router, TypeScript strict, `pnpm`. Versões **fixas** no `package.json`, sem `^`.
- `params` e `searchParams` são `Promise`. Sempre `await`.
- `cookies()`, `headers()`, `draftMode()` são assíncronos.
- O arquivo de borda é **`proxy.ts`** na raiz, com `export function proxy()`.
  Enquanto o app está em teste ele só renova a sessão: o redirect para `/login`
  está comentado no lugar (D-20).
  `middleware.ts` está deprecado. O runtime é Node.js e não é configurável.
- Turbopack é o padrão em `dev` e `build`. Não adicione config de webpack.
- `next lint` foi removido; o lint é `eslint .` com flat config.

### Domínio

- **Nenhum `any`** em código de domínio. Onde o tipo vem de biblioteca externa,
  use `unknown` e faça narrowing.
- **Nenhuma dose.** Miligrama, unidade e ml só existem em `region_presets`,
  cadastrados pelo profissional. `intensity` é adimensional 0..1.
- **Nenhum pixel absoluto** em amplitude ou raio: tudo em fração de DIP
  (distância interpupilar). Ver `lib/face/scale.ts`.
- **Nenhuma marca de terceiro** em texto de interface. Escreva "toxina
  botulínica", "preenchedor de ácido hialurônico", "bioestimulador de colágeno".
- O nome do produto é *Prévia*, sempre com acento, nunca com adjetivo de
  resultado ao lado.

### Interface

- Cor **só** por papel semântico em CSS variable. Nenhum hex em componente.
  Nenhuma classe de cor literal do Tailwind (`bg-blue-500` e afins).
- Uma família tipográfica: a do sistema. Nenhuma webfont.
- Alvo de toque mínimo 44 × 44pt. Sem exceção.
- Large title de 34pt Bold em toda tela principal, colapsando para inline de
  17pt ao rolar.
- `Pointer Events` sempre; nunca eventos de mouse. `pointerType: 'pen'` precisa
  funcionar (Apple Pencil).

### Render

- Nada de `setState` durante `pointermove`. React re-renderizando a 60 fps é o
  que derruba o framerate, não o WebGL.
- Dirty flag: o campo de deslocamento só é reconstruído quando uma aplicação
  muda. Ajuste de intensidade troca um uniform.
- A textura da foto é carregada uma vez. Nunca `texture.update()` por frame.
- `webglcontextlost` / `webglcontextrestored` tratados — o Safari derruba o
  contexto quando a aba vai para o fundo.
- Todo `GlProgram.from` leva `preferredFragmentPrecision: 'highp'` (D-18). Sem
  isso o programa não liga e a tela fica preta, com tudo mais limpo.
- Nada que posiciona por `transform` inline pode carregar a animação da cascata:
  animação com `fill-mode: both` vence estilo inline na cascata do CSS e apaga a
  posição. Posição num elemento, animação em outro.
- Todo filtro que desenha a foto leva `resolution: 'inherit'` (D-19). O padrão do
  Pixi é 1, e o canvas roda em `min(devicePixelRatio, 2)`: sem herdar, a foto
  simulada sai mais macia que a original.
- Mexeu no caminho de render? Rode `e2e/render.spec.ts` contra
  `/diagnostico/render`. Nem `tsc` nem `eslint` nem vitest enxergam tela preta.
- Mexeu no campo, nos clamps ou nos shaders? Rode `e2e/warp.spec.ts` contra
  `/diagnostico/warp`. Ele mede pixel: se o deslocamento passar do teto da
  região, ou vazar para fora dela, o teste acusa. Já pegou duas violações.

## Mapa do repositório

```
app/page.tsx                raiz em modo teste: captura + simulação, sem login (D-20)
app/(auth)/login            entrada
app/(app)/pacientes         lista e ficha do paciente
app/(app)/sessao/[id]       a tela do simulador
app/(app)/presets           protocolos da clínica
app/captura/[pairId]        tela do celular na captura remota; rota pública
app/diagnostico/render      bancada de render, fora de produção
app/api                     só metadados; nenhuma rota vê imagem
lib/pairing                 protocolo e ponte WebRTC entre celular e computador
lib/supabase                clients de browser e de servidor
lib/db/dexie.ts             fotos e sessões locais
lib/face                    landmarker, atlas, hit-test, escala, qualidade
lib/warp                    campo de deslocamento, shaders, pipeline Pixi
lib/export/ficha.ts         PDF antes/depois com marca d'água
store/useSessionStore.ts    zustand + zundo (undo/redo)
supabase/migrations         SQL versionado, RLS em todas as tabelas
```

## Ao mudar o esquema

Toda tabela nova nasce com `alter table ... enable row level security` e políticas
por `clinic_id` na mesma migration. `audit_log` é insert-only: sem update, sem
delete, para ninguém — incluindo o dono da clínica.

## Ao mudar a interface

Atualize `DECISIONS.md` primeiro. Toda exceção à HIG entra na tabela da seção 3
com uma linha de justificativa antes de existir em código.
