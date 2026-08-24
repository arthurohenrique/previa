# Prévia

Simulação visual de procedimentos estéticos (preenchimento labial, malar, mento,
olheira, sulco nasogeniano) para clínicas de estética. O profissional fotografa o
paciente, toca na região do rosto e ajusta a intensidade — o resultado é uma
prévia ilustrativa, gerada por deformação de malha, **sem IA generativa** e com
**todo o processamento no dispositivo** (a foto nunca sai do navegador).

A especificação completa do projeto (restrições invioláveis, stack obrigatória,
fases e checklist de revisão) está em [CLAUDE.md](CLAUDE.md).

## Como rodar

```bash
corepack pnpm install
corepack pnpm dev        # http://localhost:3000
corepack pnpm test       # testes unitários (vitest)
corepack pnpm typecheck  # TypeScript estrito, sem any
corepack pnpm build
```

Requer Node 20.9+. Os modelos de IA já estão versionados em `public/models/`
(nenhum download em runtime — restrição do projeto).

## Fluxo do produto

1. **Captura** (`/`) — câmera (`getUserMedia`, `facingMode: 'user'`) ou arquivo.
   O pré-processamento corrige orientação EXIF, remove todos os metadados
   (inclusive GPS) e gera duas versões em memória: original sanitizado (≤4096px,
   para exportação futura) e imagem de trabalho no tamanho do perfil de execução.
2. **Análise** (`/simular`) — MediaPipe FaceLandmarker (478 landmarks, modo
   IMAGE, carregado sob demanda de `/public/models`). Validação de qualidade:
   sem rosto, múltiplos rostos, rosto de perfil (razão de simetria nariz↔bordas)
   e nitidez (variância do Laplaciano a 256px) recusam a foto com instrução de
   correção.
3. **Segmentação** — máscara por classe (lábios, pele, olhos…) usada para o
   hit-test e para confinar a deformação. Duas estratégias alternáveis em
   `/config` (ver decisão do portão abaixo).
4. **Interação** — toque/clique/caneta via Pointer Events → região anatômica
   (classe da máscara decide primeiro; sobre pele, polígono do filtro e âncoras
   com limite proporcional à distância interocular).
5. **Deformação** — Pixi.js v8, malha triangular com densidade por perfil.
   Modelo anatômico por região (ver abaixo), 60fps no arrasto do slider,
   desfazer/refazer/zerar.
6. **Configuração** (`/config`) — capacidades detectadas (WebGPU, cores,
   memória), override do perfil de execução e da estratégia de segmentação.

## Decisões técnicas registradas

### Portão da Fase 2.5 — segmentação por IA reprovada como padrão

Medido em 2026-08-23 (desktop 8 cores, WebGPU): SegFormer face-parsing q8 levou
**20,6–21,3s de inferência** e ~11s de carga (modelo de 89MB) — o limite do
projeto era 3s no perfil baixo. Resultado: a estratégia `auto` usa **máscara por
polígonos dos 478 landmarks** (~14ms) em todos os perfis; a IA continua
implementada (Web Worker, WebGPU→WASM, progresso, pico de memória) e pode ser
ativada manualmente em `/config`.

### Modelo de deformação anatômico (revisão da Fase 4)

Expansão radial em torno de um ponto lê-se como distorção (pele, barba e fundo
se movem juntos). O modelo atual:

- **Lábios (eversão)**: o lábio escala a partir da linha da boca — a linha e os
  dentes ficam imóveis e o vermelhão avança; o peso vem do alpha da classe na
  máscara de segmentação (borda borrada = transição suave).
- **Malar/mento/sulco/olheira (lift/projeção)**: translação dominante em elipse
  ancorada nos landmarks.
- **Confinamento**: todo campo é multiplicado pelo alpha do rosto na
  segmentação — fundo, cabelo e roupa nunca se movem.
- **Garantias**: teto de deslocamento por região (anti-caricato), atenuação C¹
  sem quina, íris e dentes pinados, moldura da imagem fixa.

Calibração por região em `src/lib/deform/field.ts` (`REGION_DEFORM`).

### Prévia realista — IA generativa local (Fase 5)

Emenda à restrição nº 3 (decisão do dono do produto em 2026-08-24): geração
por difusão é permitida **somente local e contida**. Pipeline: o warp
determinístico serve de guia geométrico → recorte quadrado da região ativa
(512px) → **img2img com LCM Dreamshaper v7 ONNX** (WebGPU, 6 passos, força
proporcional à intensidade) → composição de volta **apenas dentro da máscara**
com borda em pluma — fora dela o pixel é bit a bit o original. Nada sai do
dispositivo; sem WebGPU o recurso fica indisponível e o motor determinístico
segue como fallback. O modelo (~2,2GB) não é versionado: rode
`scripts/download-generative-model.ps1` uma vez por ambiente.
COOP/COEP habilitados em `next.config.ts` (SharedArrayBuffer para o ORT
multithread).

**Produção (Vercel e afins)**: o deploy não contém o modelo (limite de
tamanho + gitignore). Suba os 14 arquivos de `public/models/generative/`
para um storage próprio (Cloudflare R2, Vercel Blob…) preservando os
caminhos relativos, e defina a env `GENERATIVE_MODELS_URL` com a URL base
do bucket. O rewrite em `next.config.ts` proxeia
`/models/generative/*` para lá SOB O MESMO DOMÍNIO — o navegador nunca fala
com terceiros e a foto continua 100% no dispositivo (o que trafega são os
pesos do modelo, na direção contrária). Sem a env, a rota espera os
arquivos em `public/` (dev). A UI verifica a disponibilidade do modelo
antes de gerar e explica o que falta em vez de falhar com 404 críptico.
Se o proxy da Vercel limitar respostas de 1,6GB, alternativa: subdomínio
próprio (ex.: models.seudominio.com) apontando pro bucket com CORS +
`Cross-Origin-Resource-Policy: cross-origin`, e a env apontando pra ele.

Medido em 2026-08-24 (Intel Gen-9 iGPU, WebGPU): carga do pipeline ~28s
(uma vez por sessão), geração completa ~140s. GPU dedicada deve reduzir isso
substancialmente; sem WebGPU o recurso se declara indisponível.

**Patches de dependência** (`patches/`, aplicados via pnpm):
- `@aislamov/diffusers.js`: (1) fetch local direto sem cache IndexedDB (o
  `put` de 1,6GB aborta); (2) fallback WebGPU→WASM na criação de sessão;
  (3) API `externalData` do onnxruntime-web padrão; (4) reconstrução de
  tensors nativos no `Session.run`.
- `@xenova/transformers` (pinado em 2.6.2 — API de tokenizer que o
  diffusers.js usa): guard no `isEmpty` contra `Object.keys(undefined)`
  sob Turbopack.
- Override pnpm: `@aislamov/onnxruntime-web64` → `onnxruntime-web` padrão
  (o fork exige WASM Memory64, que depende de flag de navegador).

### Assets locais

- `public/models/wasm/` — WASM do MediaPipe (copiado de `node_modules`).
- `public/models/face_landmarker.task` — FaceLandmarker float16 (3,7MB).
- `public/models/face-parsing/` — SegFormer ONNX quantizado (89MB) + configs.
- `public/models/ort/` — runtimes do onnxruntime-web (asyncify/jsep/jspi).
- `public/vendor/browser-image-compression.js` — script do worker da lib
  (sem `libURL` ela baixaria do jsdelivr em runtime; recopiar ao atualizar).

## Estrutura

```
src/
  app/            páginas (captura, /simular, /config)
  components/     capture/ e simulate/ (UI fina; lógica fica em lib/)
  lib/            domínio puro e testado:
    profile.ts      capacidade → perfil de execução
    image.ts        EXIF/orientação/resize (browser-image-compression)
    quality.ts      validações de qualidade da foto
    landmarker.ts   MediaPipe (singleton lazy, GPU→CPU)
    anatomy.ts      toque → região anatômica
    segmentation/   máscara (IA em worker + polígonos de landmarks)
    deform/         malha, campos de deformação, histórico undo/redo
  store/          sessão Zustand (tudo em memória — LGPD)
  workers/        segmentation.worker.ts (Transformers.js)
```

## Estado das fases

| Fase | Status |
|---|---|
| 1 — Fundação e captura | ✅ |
| 2 — Landmarks (478 pontos, overlay de debug) | ✅ inferência 40–66ms desktop |
| 2.5 — Segmentação (portão de decisão) | ✅ portão acionado → landmarks por padrão |
| 3 — Mapa anatômico e interação | ✅ |
| 4 — Motor de deformação | ✅ 60fps no arrasto; modelo anatômico + shading |
| 5 — Prévia realista (IA generativa local) | ✅ carga ~28s, geração ~140s em iGPU Gen-9 |
| Exportação antes/depois (PNG/PDF + marca d'água) | pendente |
| Testes em Safari iOS e Chrome Android | pendente (validado só em Chromium desktop) |

Decisão registrada (2026-08-24): o processamento permanece 100% no dispositivo.
Vercel (ou qualquer hospedagem) serve apenas os estáticos — não há GPU em
serverless, e mover a foto para servidor violaria a restrição de privacidade.
Alternativas de nuvem foram avaliadas e recusadas pelo dono do produto.

## Fotos de teste

`docs/*.jpg|png` está no `.gitignore`: fotos com rosto real usadas em
desenvolvimento não são versionadas, coerente com a regra de privacidade do
projeto.
