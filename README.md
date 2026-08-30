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
5. **Deformação** — Pixi.js v8, warp por pixel na GPU (`WarpFilter`) guiado
   por pontos de controle anatômicos interpolados por Moving Least Squares
   (ver abaixo). Desfazer/refazer/zerar.
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

### Motor de warp (reconstrução de 2026-08-30)

O motor anterior (grade regular de 28–64 colunas deslocada por vértice, mais
camadas de brilho `screen`/`multiply`) lia-se como distorção de foto: célula
de ~20px contra um vermelhão de ~25px, pele esticada em vez de comprimida,
translação uniforme tipo "liquify" no malar/mento. Foi substituído por
`src/lib/warp/`:

- **Templates anatômicos** (`templates.ts`): por região, quais landmarks se
  movem (vetor em unidades do rosto: interocular + eixo corrigido por
  inclinação) e quais ficam pinados. Lábios: o contorno externo do vermelhão
  avança na normal com perfil senoidal (zero nas comissuras), linha molhada e
  base do nariz pinadas — a pele do filtro é comprimida, não esticada. Mento e
  malar podem mover a silhueta; as demais regiões são confinadas à máscara do
  rosto. Boca aberta reduz o ganho labial pela metade. Teto por região.
- **Moving Least Squares de similaridade** (`mls.ts`, Schaefer 2006):
  interpola exatamente os controles, é suave e linear na intensidade — o
  campo é rasterizado UMA vez por região (`field.ts`, 512² nos perfis
  alto/médio, 256² no baixo; 50–230ms medidos em Node) e o slider só o
  multiplica (`compose.ts`, ~1–6ms).
- **Campo inverso**: rasterizado já com os controles trocados (q→p), então o
  shader faz uma única amostragem (`cor = foto(uv + t·disp(uv))`), sem
  inversão iterativa. `maxStrain` (< 0,5) é o guardrail estético medido nos
  testes.
- **`WarpFilter`** (Pixi v8, GLSL + WGSL): textura `rgba16float` do campo,
  warp por pixel na resolução da foto. Sem WebGL1.

- **Camada fotométrica** (`src/lib/photometric/`): a pista de volume. A
  direção da luz é estimada da própria foto (assimetria de luminância da
  pele); uma pseudo-altura com a forma da região recebe um lambertiano
  linearizado (realce no flanco voltado à luz, meia-sombra no oposto), e
  sulco/olheira recebem "shadow lift" (a sombra da depressão é trazida à
  luminância da pele vizinha, preservando a textura). Tudo em luminância,
  com crominância preservada, e linear na intensidade — viaja nos canais
  extras da mesma textura do campo.

Verificado em Chromium headless (SwiftShader) com retrato real: os pixels
alterados ficam restritos à região ajustada (lábio, malar, mento); fundo,
cabelo, roupa e o resto do rosto são bit a bit iguais. Detalhes, números e
decisões em [docs/plano-reconstrucao.md](docs/plano-reconstrucao.md).

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
    warp/           referencial do rosto, MLS, templates anatômicos, campo
                    inverso, WarpFilter (GPU), composição por intensidade
    photometric/    luminância, direção de luz, shading lambertiano,
                    shadow lift, bandas do lábio
    calibration.ts  intensidade → volume estimado (mL, placeholder)
    export/         render offscreen em alta, marca d'água, PDF (jspdf)
    deform/         histórico undo/redo
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
| 4 — Motor de deformação | ✅ reconstruído: warp MLS por pixel + camada fotométrica |
| 5 — Prévia realista (IA generativa local) | ✅ carga ~28s, geração ~140s em iGPU Gen-9 |
| Exportação antes/depois (PNG/PDF + marca d'água) | ✅ PNG em alta com o mesmo campo; PDF A4 via jspdf; "Antes" e divisor no shader |
| Testes em Safari iOS e Chrome Android | pendente (validado só em Chromium desktop) |

Decisão registrada (2026-08-24): o processamento permanece 100% no dispositivo.
Vercel (ou qualquer hospedagem) serve apenas os estáticos — não há GPU em
serverless, e mover a foto para servidor violaria a restrição de privacidade.
Alternativas de nuvem foram avaliadas e recusadas pelo dono do produto.

## Fotos de teste

`docs/*.jpg|png` está no `.gitignore`: fotos com rosto real usadas em
desenvolvimento não são versionadas, coerente com a regra de privacidade do
projeto.
