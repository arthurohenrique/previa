# Plano de reconstrução do motor de simulação

Documento vivo. Registra o diagnóstico que motivou a reconstrução, a
arquitetura escolhida, as fases e — ao fim de cada fase — o que foi feito, o
que foi medido e as decisões que precisam de revisão. A especificação do
produto continua em [CLAUDE.md](../CLAUDE.md).

## 1. Contexto

O produto deveria mostrar ao paciente uma prévia crível de preenchimento
(labial, malar, mento, sulco nasogeniano, olheira). Em 2026-08-30 o dono do
produto constatou que o resultado "serve apenas como edição de imagem mal
feita, com distorção de fotos". A verificação do código confirmou a
reclamação e mostrou que a "prévia realista" por IA generativa (Fase 5)
nunca operou em produção.

## 2. Diagnóstico (verificado no código em 2026-08-30)

### 2.1 O warp era uma grade regular, não uma malha ancorada nos landmarks
- `buildGridMesh` gerava 28/44/64 colunas; em foto de 1024px a célula tinha
  ~17–23px contra um vermelhão de ~25px. O campo era amostrado por vértice
  com peso `alpha²` da máscara: vértices dentro do lábio moviam, vizinhos
  não → triângulos esticados de forma facetada (a assinatura do "liquify").
- O CLAUDE.md pedia "grade triangular ancorada nos landmarks"; não existia.

### 2.2 Modelo geométrico demais, anatômico de menos
- Lábios: escala a partir da linha da boca (35–40%) sem pinos na base do
  nariz — a pele do filtro era esticada (o que o olho detecta como falso).
- Malar/mento/sulco/olheira: translação uniforme numa elipse — a ferramenta
  "push" do liquify; nariz, sombra e sulco moviam junto com a bochecha.
- Sulco e olheira são procedimentos majoritariamente fotométricos (a sombra
  some), mas o sistema só sabia deslocar pixels.

### 2.3 Bugs pontuais
- Pinos dos dentes acumulados por PRODUTO (20 pinos a ~5px): raio efetivo
  muito maior que o nominal; só a fileira externa do lábio sobrevivia.
- Deslocamento máximo do mento coincidia com o zero da máscara de rosto →
  cisalhamento > 2,5× na silhueta queixo/fundo.
- Máscara por polígonos gravava o id da classe na cor e o anti-aliasing
  produzia classes espúrias (pele=1 e lábio=11 viravam "olho", "nariz") —
  tocar a borda do lábio virava "olheira".
- Interocular medida em UV horizontal mas convertida pela média
  largura+altura: raios e tetos +17% em foto 3:4.
- Fixture de teste com lábio no dobro da resolução real escondia o defeito.

### 2.4 A "pista de volume" era um glow plano
- Camada branca `screen` (alpha até 0,30) + cópia cinza `multiply` deslocada
  para baixo, sem direção de luz nem preservação de cor: filtro de brilho.

### 2.5 IA generativa (Fase 5) inoperante e inviável
- Modelo de 2,2GB ausente do repo e do deploy; script de download em
  PowerShell (ambiente de desenvolvimento é macOS).
- Medido: 28s de carga + 140s por geração em iGPU — inaceitável com o
  paciente na cadeira.
- `LatentConsistencyModelPipeline` do `@aislamov/diffusers.js` ignora
  `img2imgFlag`, `inputImage`, `strength` e `negativePrompt`: o worker pedia
  img2img e recebia txt2img — um rosto inventado pelo prompt colado dentro da
  máscara. `tensorToRgba` ainda aplicava dupla conversão de faixa ([0,1]
  tratado como [-1,1]) → recorte lavado.
- Efeitos colaterais: COOP/COEP `require-corp` global, 89MB de SegFormer e
  77MB de runtimes ORT no deploy sem uso no caminho padrão.

### 2.6 Não existia saída do produto
- Exportação PNG/PDF antes/depois inexistente (`jspdf` nem instalado); marca
  d'água "SIMULAÇÃO ILUSTRATIVA" (restrição nº 5) só num `<span>`.
- A UI era um painel de debug ("Fase 2 · debug").

## 3. Arquitetura da solução

Motor determinístico de qualidade profissional, 100% no navegador:

1. **Templates anatômicos por região** (`src/lib/warp/templates.ts`):
   landmarks que se movem (vetor em unidades do rosto — interocular e eixo
   corrigido por inclinação) e landmarks pinados. Lábios: contorno externo do
   vermelhão avança na normal com perfil senoidal (zero nas comissuras),
   linha molhada e base do nariz pinadas → a pele do filtro é comprimida, não
   esticada. Mento e malar movem a silhueta (`confine: 'livre'`); as demais
   são confinadas à máscara do rosto. Boca aberta reduz o ganho labial pela
   metade. Teto de deslocamento por região.
2. **Moving Least Squares de similaridade** (`mls.ts`, Schaefer 2006):
   interpola exatamente os controles, é suave e LINEAR na intensidade — o
   campo é rasterizado uma vez por região e o slider só o multiplica.
3. **Campo inverso** (`field.ts`): rasterizado com os controles trocados
   (q→p), então o shader faz uma única amostragem — sem inversão iterativa.
   `maxStrain` (< 0,5) é o guardrail estético medido nos testes.
4. **Warp por pixel na GPU** (`WarpFilter.ts`, Pixi v8, GLSL + WGSL):
   textura `rgba16float` do campo composto; sem malha, sem facetas.
5. **Camada fotométrica** (Fase C): direção de luz estimada da foto, realce e
   meia-sombra lambertianos em luminância (preservando crominância), shadow
   lift para sulco/olheira, saturação e borda do lábio.
6. **Saída** (Fase D): antes/depois, PNG em alta com o mesmo campo, PDF, marca
   d'água obrigatória.
7. **IA generativa** fora do caminho crítico (Fase E), atrás de flag.

## 4. Fases

| Fase | Escopo | Status |
|---|---|---|
| A | Núcleo matemático puro (`src/lib/warp/`): referencial, MLS, templates, campo, guardrails, testes | ✅ 2026-08-30 |
| B | Warp por pixel na GPU: `WarpFilter`, half-float, composição, `DeformCanvas` reescrito, motor antigo removido | ✅ 2026-08-30 |
| C | Camada fotométrica (`src/lib/photometric/`): luz estimada, shading lambertiano, shadow lift, lábios | ✅ 2026-08-30 |
| D | Calibração em mL, antes/depois (segurar e dividir), exportação PNG/PDF com marca d'água | ✅ 2026-08-30 |
| E | UI de produto (procedimentos, diagnóstico em /config), IA generativa atrás de flag, COOP/COEP removido | ✅ 2026-08-30 |
| F | Medição e QA em Chrome desktop, Safari iOS e Chrome Android | 🟡 2026-08-30 — medido em 4 ambientes locais; aparelhos reais pendentes |

### Fase C — Camada fotométrica
- `luma.ts` (luminância, blur, blur normalizado), `light.ts`
  (`estimateLight`: assimetria de luminância bochecha esq/dir e testa/mento,
  uma vez por foto), `shade.ts` (pseudo-altura + lambertiano linearizado:
  realce no lado da luz, meia-sombra no oposto, zero no platô, caps),
  `shadowLift.ts` (baixa frequência dentro da máscara trazida à pele vizinha;
  alta frequência preservada; nunca escurece), `lips.ts` (máscara e banda de
  borda do vermelhão). Shader: `Y' = Y·(1+shade) + lift`, `rgb' = rgb·(Y'/Y)`.
- Testes: gradiente sintético → sinal correto de luz; paraboloide + luz
  lateral → realce/sombra nos flancos; shadow lift converge à pele vizinha
  mantendo a textura. Validar em 3 fototipos.

### Fase D — Calibração, antes/depois, exportação
- `calibration.ts`: escala clínica por região (mL) — valores PLACEHOLDER a
  validar com profissional; UI rotula "estimativa ilustrativa".
- Antes/depois no próprio filtro (`uGlobal` para segurar "Antes", `uSplitX`
  para o divisor arrastável por Pointer Events).
- `export/render.ts` (Application offscreen na resolução do original ≤ 4096
  com o MESMO campo), `watermark.ts` (puro, testado), `pdf.ts` (`jspdf`, A4
  paisagem, antes | depois, procedimento/volume, disclaimer). Nada persiste.

### Fase E — UI de produto e IA generativa atrás de flag
- `procedures.ts`: 5 procedimentos agrupando regiões (um slider para lábio
  sup+inf; ambos os lados para malar/sulco/olheira).
- `ProcedurePanel.tsx` (chips 44px, slider + rótulo mL, Desfazer/Refazer/
  Zerar, Antes/Dividir, Exportar, Trocar foto); `DiagnosticsPanel.tsx` só com
  toggle em `/config`.
- Prévia generativa sai da tela; fica em `/config` > Experimental apenas com
  `NEXT_PUBLIC_ENABLE_GENERATIVE=1`. COOP/COEP global e rewrite removidos.
  README registra os dois bugs do pipeline para quem retomar. Opcional:
  tirar do deploy os modelos sem uso no caminho padrão.

### Fase F — Medição e QA
Tabela por navegador: `warp:field` por região (< 150ms desktop / < 400ms
mobile), `warp:compose` (< 3ms), `warp:upload` (< 2ms), FPS no arrasto
(≥ 55 médio, ≥ 30 baixo), exportação 4096px (< 3s), memória; aba Network sem
domínio de terceiro.

## 4b. Recurso pós-plano — Receber foto do celular por QR (2026-08-30)

Pedido do dono do produto; toca a restrição nº 1, que ganhou emenda
(aprovada pelo dono na mesma data; texto no CLAUDE.md). Desenho escolhido
entre três opções apresentadas: **relay cifrado efêmero**.

- O computador gera canal (id + chave AES-GCM 256) e mostra um QR com
  `/enviar#id.chave` — o fragmento nunca trafega em HTTP, então o servidor
  jamais vê a chave (`src/lib/relay/crypto.ts`, testado).
- O celular abre a página, remove EXIF/GPS (`sanitizePhotoForTransfer`),
  cifra e faz POST em `/api/relay/[id]` — primeiro route handler do projeto.
- Armazenamento (`src/lib/relay/store.ts`, testado): memória em
  dev/auto-hospedagem; **Vercel Blob** quando `BLOB_READ_WRITE_TOKEN` existe
  (serverless não compartilha memória). Contrato: TTL 2min, uso único
  (apaga ao entregar), teto 15MB, id validado.
- O computador faz polling (204 = ainda nada), decifra e entra no fluxo
  normal de captura. Botão "Copiar link" cobre o caso sem câmera de QR.

**Verificado** (E2E com dois navegadores: computador Chromium + celular
iPhone emulado): QR gerado com aviso de "localhost"; envio ok; o corpo do
POST no fio NÃO começa com magic de JPEG/PNG (cifrado); o computador recebeu,
processou (682×1024, perfil Médio) e a segunda leitura do canal veio vazia
(uso único). Typecheck, 162 testes e build limpos. Pendente: conectar o
Vercel Blob ao projeto (exige `vercel login` do dono — passos no README).

## 5. Decisões que precisam da revisão do dono do produto

1. Tirar a IA generativa do caminho crítico contraria a emenda de 2026-08-24
   na letra, não no espírito: o recurso nunca operou, custaria 2–3 min por
   geração e, como implementado, não usa a foto do paciente. Fica atrás de
   flag para retomada futura.
2. Valores de mL e tetos anatômicos são chutes de engenharia — validar com
   profissional antes de publicar.
3. Sem fallback WebGL1 (decisão da Fase B): Safari iOS ≥ 15 e todo Chromium
   têm WebGL2.
4. A validação de frontalidade da Fase 2 recusou um retrato em que o cabelo
   cobria a borda do rosto — pode ser rígida demais para consultório.

## 6. Registro por fase

### Fase A — Núcleo matemático (concluída em 2026-08-30)

**Feito**
- `src/lib/warp/frame.ts`: referencial do rosto (origem entre as íris, eixo
  X na linha das íris, escala = interocular em px), normais de contorno.
- `src/lib/warp/mls.ts`: MLS de similaridade, `rasterizeMls` em unidades
  normalizadas pela foto.
- `src/lib/warp/templates.ts`: templates das 10 regiões, pinos, moldura da
  imagem, teto por região, detecção de boca aberta.
- `src/lib/warp/field.ts`: campo inverso por região, confinamento ao rosto
  para regiões interiores, `maxStrain`.
- `src/lib/warp/sample.ts`: amostragem bilinear.
- Fixture `__fixtures__/face.ts` em proporções reais (768×1024, interocular
  208px, vermelhão de 27px).
- Correção em `segmentation/landmarkMask.ts`: cada polígono é lido como
  cobertura e limiarizado (fim das classes espúrias por anti-aliasing);
  função pura `labelsFromCoverage` testada.

**Medido** (fixture, Node): campo do lábio superior 72ms a 256², 226ms a
512²; strain 0,45 (lábio superior), 0,39 (inferior), 0,41 (mento), 0,29
(malar), ≤ 0,12 (sulco/olheira). Testes: 112 passando; typecheck limpo.

**Decisão tomada na fase**: o plano previa campo direto + inversão por ponto
fixo no shader. Medido: resíduo de 0,8px nos lábios com 3 iterações (strain
real do lábio 0,5–0,6 não converge). Trocado por rasterizar o campo INVERSO
(MLS com origem e destino trocados). Em intensidades intermediárias os
landmarks caem aproximadamente em `p + t·δ` (exato em 0% e 100%) —
irrelevante para uma prévia. Ganhos labiais reduzidos a valores clínicos
(0,035 e 0,04 da interocular ≈ 30% de altura do vermelhão no máximo) e
expoente do MLS α = 1.

### Fase B — Warp na GPU (concluída em 2026-08-30)

**Feito**
- `src/lib/warp/WarpFilter.ts`: Filter do Pixi v8 (GLSL + WGSL), textura
  `rgba16float`, uma amostragem por pixel.
- `src/lib/warp/halfFloat.ts` (float32 ↔ half, `packField`) e
  `src/lib/warp/compose.ts` (`composeFields`, tipo `DeformMap`).
- `src/lib/warp/regionMask.ts`: máscara da região (classe do lábio ou
  elipse nos landmarks) — substitui a dependência do generativo no shading
  antigo e serve de pseudo-altura na Fase C.
- `src/components/simulate/DeformCanvas.tsx` reescrito: Sprite + filtro,
  campos sob demanda no primeiro toque, medições `warp:field/compose/upload`
  via `performance.measure`.
- Removidos `src/lib/deform/field.ts`, `mesh.ts`, `shading.ts` e testes;
  `history.ts` permanece. README atualizado.

**Verificado** em Chromium headless (Playwright, SwiftShader) com retrato
real de licença livre, pelo fluxo completo do app (upload → análise → toque
no lábio → slider a 100% por arrasto): 1.090 pixels alterados, todos em
(40–59%, 33–48%) da foto — boca e filtro; fundo, olhos, nariz e cabelo bit a
bit iguais. Visualmente: lábio mais cheio, arco do cupido definido, filtro
comprimido, sem facetas. Página isolada com campo constante de 0,25 deslocou
a imagem exatamente 100px. Tempos no headless por software (não
representativos): compose 1–6ms, upload 4–14ms, campo do lábio ~930ms (72ms
em Node — o SwiftShader monopoliza a CPU). Testes: 107 passando; typecheck e
`next build` limpos.

**Achado da verificação**: uniforms globais do Pixi usados no vertex e no
fragment precisam de `highp` explícito no fragment; sem isso o programa não
linka, o Pixi não loga nada e o filtro renderiza transparente
(`gl.getError() = INVALID_OPERATION`). Corrigido no shader. Nenhum teste
unitário pegaria isso — a verificação em navegador é obrigatória nas fases
com GPU.

**Decisão tomada na fase**: sem fallback WebGL1 (código morto).

### Fase C — Camada fotométrica (concluída em 2026-08-30)

**Feito**
- `src/lib/photometric/luma.ts` (luminância Rec. 601, box blur em float,
  blur normalizado por peso, gradiente), `light.ts` (`estimateLight`:
  assimetria de luminância da pele entre bochechas e entre testa e mento,
  uma vez por foto, ~1ms), `shade.ts` (pseudo-altura por blur da máscara da
  região + lambertiano linearizado `−s·(h_x·L_x + h_y·L_y)`, caps −0,12/+0,15),
  `shadowLift.ts` (baixa frequência dentro da máscara trazida à pele
  vizinha; só clareia; teto 12% da referência), `lips.ts` (bandas do
  vermelhão: interior e borda).
- `RegionField` ganhou 4 canais fotométricos (shade, lift, lip, edge),
  lineares na intensidade como a geometria; `composeFields` soma os dois
  buffers; `WarpFilter` recebe o campo em `rgba16float` (dx, dy, shade, lift)
  e uma segunda textura `rgba8` (lip, edge). Shader:
  `Y' = Y·(1+shade) + lift`, `rgb' = rgb·(Y'/Y)` (crominância preservada),
  saturação +12% e definição de borda no vermelhão.
- `templates.ts`: `photometric` por região (lábios 0,45/0,08; malar 0,7/0,12;
  mento 0,6/0,12; sulco 0,25 + lift 0,8; olheira 0,15 + lift 0,8).
- `DeformCanvas`: luminância na grade do campo calculada uma vez por foto;
  luz estimada no primeiro toque; medição `warp:light`.
- Confinamento revisto em `field.ts`: regiões livres (mento, malar) usam a
  máscara do rosto DILATADA em 0,2 IOD (a silhueta avança sobre o fundo
  próximo; cabelo, orelha e roupa distantes não se movem) e toda região
  tem a influência limitada à própria máscara dilatada em 0,4 IOD (a cauda
  longa do MLS deixava o rosto inteiro "respirar" sub-pixel).
- `regionAlpha` (máscara da região) passou a alimentar também a
  pseudo-altura e o shadow lift.

**Medido/verificado** (Chromium headless, retrato real, fluxo completo do
app): pixels alterados restritos à região — lábio (40–59%, 42–49%) da foto,
malar direito (23–47%, 28–49%), mento (30–67%, 50–62%). Antes da revisão do
confinamento, o malar alterava (0–77%, 5–89%): cabelo, orelha e gola. Testes:
135 passando; typecheck e `next build` limpos. Tempos no headless por
software: `warp:light` ~1ms, compose 3–10ms, upload 5–30ms, campo por região
~0,9–1,0s (o SwiftShader monopoliza a CPU; em Node a mesma conta leva
~70–230ms).

**Achados da verificação**
- O Pixi sobe texturas com `UNPACK_PREMULTIPLY_ALPHA` por padrão; como o
  canal A do campo passou a guardar o `lift` (quase sempre 0), dx/dy eram
  zerados no upload e o warp sumia sem erro nenhum. Corrigido com
  `alphaMode: 'no-premultiply-alpha'` — regra: textura de DADOS nunca deve
  pré-multiplicar.
- O realce lambertiano do lábio com ganho 0,9 e rampa de 0,05 IOD virava um
  contorno claro na borda do vermelhão; reduzido a 0,45 / 0,08 IOD e a
  definição de borda a 0,2.
- Dilatação por `2·blur` não satura em formas finas (vermelhão de 7px na
  grade): substituída por cobertura > 0 dentro da janela (dilatação exata)
  seguida de blur.

**Decisões que precisam de revisão**
- Ganhos fotométricos foram calibrados num único retrato (fototipo claro,
  luz frontal). Validar em pele escura e luz lateral antes da Fase F.
- No sulco e na olheira o efeito é sutil por construção (teto de 12%): se o
  profissional achar fraco, o teto é o parâmetro a revisar, não o ganho.

### Fase D — Calibração, antes/depois e exportação (concluída em 2026-08-30)

**Feito**
- `src/lib/calibration.ts`: `CLINICAL_SCALE` por região (mL na intensidade
  100%: lábios 0,5 cada, filtro 0,2, malar 1,0 por lado, mento 1,5, sulco
  0,8 por lado, olheira 0,5 por lado — PLACEHOLDERS), `volumeAt`,
  `volumeLabel` ("≈ 0,5 mL"), `anatomicalCeiling` (fonte única: template).
  O slider mostra "100% · ≈ 0,5 mL" e o aviso de estimativa ilustrativa.
- Antes/depois no próprio `WarpFilter` (uniform `uCompare`): "Segurar:
  antes" (pointerdown/up, teclado espaço/Enter) zera o campo e a fotometria
  sem recompor nada; "Dividir" mostra o original à esquerda de um divisor
  arrastável por Pointer Events (alça de 44px, rótulos Antes/Depois,
  `role=slider`).
- `src/lib/export/render.ts`: renderer Pixi offscreen ÚNICO (reutilizado e
  redimensionado), a foto original sanitizada (≤ 4096px) passa pelo mesmo
  `WarpFilter` com o MESMO campo composto da tela (normalizado pela foto);
  `withWatermark`, `exportSimulationPng`, `downloadBlob`, `exportFilename`
  (data/hora, sem dados do paciente).
- `src/lib/export/watermark.ts` (puro, testado): "SIMULAÇÃO ILUSTRATIVA" na
  diagonal com ≥ 20% da diagonal da imagem, alpha 0,35, mais rodapé
  "Prévia · simulação ilustrativa · dd/mm/aaaa".
- `src/lib/export/pdf.ts` (`jspdf`, instalado): A4 paisagem, antes | depois
  (o depois já com marca d'água), lista de procedimentos com volume,
  disclaimer. `pdfSafe` troca "≈"/"•" (fora do WinAnsi das fontes padrão) por
  ASCII.
- `SimulateScreen`: seção "Comparar e exportar" (provisória — o painel de
  produto é a Fase E); `DeformCanvas` recebe `compare` e expõe `snapshotRef`
  com a cópia do campo composto.

**Verificado** (Chromium headless, retrato real, fluxo completo):
- "Segurar: antes" → 0 pixels diferentes do original.
- Divisor a 50%: na faixa dos lábios, esquerda idêntica ao original (0 px
  diferentes) e direita idêntica ao "depois" (0 px); arrastado a 25% via
  Pointer Events, `aria-valuenow` = 25.
- PNG exportado 1024×1536 (resolução do original desse retrato), 2,6 MB,
  com marca d'água diagonal e rodapé; PDF de 637 KB com as duas imagens,
  legendas e disclaimer, sem avisos no console.
- Testes: 146 passando; typecheck e `next build` limpos.

**Achados**
- Destruir o `Application` offscreen a cada exportação disparava avisos do
  Pixi (texturas do pool ainda ligadas ao sistema de filtros); um renderer
  único reutilizado resolve e ainda evita recriar o contexto WebGL.
- As fontes padrão do jspdf não têm "≈": saía como lixo com espaçamento
  quebrado em toda a linha.

**Decisões que precisam de revisão**
- Volumes em mL são chutes de engenharia; a UI e o PDF rotulam como
  estimativa. Validar com profissional antes de publicar.
- A exportação limita o lado maior a 4096px (teto seguro de textura em GPU
  móvel); o original já é sanitizado nesse tamanho.

### Fase E — UI de produto e IA generativa atrás de flag (concluída em 2026-08-30)

**Feito**
- `src/lib/procedures.ts` (puro, testado): 5 procedimentos — Lábios (sup
  0,9× + inf 1,0× num único slider; o filtro labial pertence a "Lábios"),
  Malar, Sulco e Olheira (os dois lados juntos), Mento. `regionToProcedure`
  (toque no rosto → procedimento), `applyProcedure`/`procedureIntensity`
  (a verdade continua no DeformMap por região — histórico intacto),
  `procedureVolumeLabel` ("≈ 1,0 mL por lado" nos pares simétricos) e
  `procedureLines` (linhas do PDF).
- Store: `activeProcedure`, `previewProcedure`, `showDiagnostics`.
- `ProcedurePanel.tsx`: chips dos 5 procedimentos (44px, ponto de "ajustado"),
  slider com rótulo em mL, Desfazer/Refazer/Zerar, Comparar (Segurar antes /
  Dividir) e Exportar. `DiagnosticsPanel.tsx`: métricas, 478 pontos, máscara,
  FPS — renderizado só com o toggle "Diagnóstico" novo em `/config`.
  `SimulateScreen` reescrito como orquestrador; cabeçalho "Simulação".
- Prévia generativa EXPERIMENTAL atrás de `NEXT_PUBLIC_ENABLE_GENERATIVE=1`:
  sem a flag não há seção na UI, nem headers COOP/COEP globais, nem rewrite
  do modelo (`next.config.ts` condicional). README documenta a flag e os
  bugs conhecidos do pipeline para quem retomar.

**Verificado** (Chromium headless, retrato real): painel sem nenhum elemento
de debug e sem seção generativa; toque no lábio ativa o chip "Lábios";
slider a 100% mostra "≈ 1,0 mL" e altera só a boca (38–63% × 44–56%);
chip "Malar" + slider altera as duas bochechas (23–77% × 29–49%);
Desfazer retorna exatamente ao estado anterior (0 px de diferença);
toggle em /config faz o painel de diagnóstico aparecer; `curl -I` sem
COOP/COEP. Testes: 152 passando; typecheck e `next build` limpos.

**Pendências conhecidas**
- Um aviso cosmético do Pixi (recurso ligado a shader) ao trocar de foto/
  desmontar o canvas — teardown interno do Pixi, sem efeito funcional.
- Os modelos sem uso no caminho padrão (SegFormer 89MB + runtimes ORT)
  continuam no deploy; removê-los quebraria a estratégia manual "IA" em
  /config — decisão de produto pendente.
- `showDiagnostics` vive na sessão (não persiste ao recarregar).

### Fase F — Medição e QA (parcial em 2026-08-30; aparelhos reais pendentes)

Fluxo completo automatizado (upload → análise → 5 procedimentos a 100% →
arrasto contínuo do slider por 2s → exportação PNG), retrato real de
1024×1536, imagem de trabalho 480×720, grade do campo 171×256. Scripts:
`measure.mjs` / `mobile.mjs` (Playwright, no scratchpad da sessão).

| Ambiente (Mac M1) | captura→pronto | FPS arrasto | compose méd | upload méd | campo/região | export PNG |
|---|---|---|---|---|---|---|
| Chromium 145, SwiftShader (CPU pura — piso) | 11,1s | **11** | 31ms | 7ms | 373–714ms | 2,3s |
| Chromium 151, ANGLE Metal (GPU real) | 8,6s | **60** | 15ms | 3ms | 174–599ms | 0,5s |
| WebKit 26.5 (motor do Safari, Apple GPU) | 14,7s | **60** | 9ms | 3ms | 221–523ms | 0,2s |
| iPhone 13 emulado (WebKit, toque, 390×844) | ok | — | — | — | — | — |

- No iPhone emulado: palco com 55% da viewport visual, toque no lábio
  seleciona o chip "Lábios", slider responde ao toque, zero erros.
- **Rede**: única origem contatada em todo o fluxo é localhost (mais
  blob:/data: internos). Zero domínios de terceiros. ✓ checklist.
- **Zero `any`** no src (grep + tsc estrito). Zero erros de console nos
  quatro ambientes.
- `warp:light` ≤ 1,3ms em todos.

**Achados**
1. Bug PRÉ-EXISTENTE da Fase 1: se a foto entra antes de a detecção de
   capacidade terminar, o pré-processo usa o perfil de fallback ('baixo' —
   por isso a imagem de trabalho de 480×720 mesmo com perfil "Médio"
   detectado). A automação sempre ganha essa corrida; um usuário humano
   raramente. Correção sugerida: aguardar a detecção no `processBlob`.
2. `warp:field` (~170–600ms por região no M1 a 256²; ~4× a 512²) está acima
   do alvo de 150ms do plano. É custo ÚNICO por região, pago no primeiro
   toque — percebido como um engasgo breve. Recomendação registrada: mover
   `buildRegionField` para um Web Worker (a função já é pura) ou pré-calcular
   as regiões em idle após a segmentação.
3. `warp:compose` (9–15ms com GPU real) acima do alvo de 3ms — os buffers
   agora têm 6 canais (geometria + fotometria). A 60fps sobra margem no
   desktop; no mobile real pode apertar. Otimização possível: compor só as
   regiões que mudaram.
4. SwiftShader (pior caso absoluto, sem GPU nenhuma) ainda entrega 11 FPS e
   o resultado correto — o produto degrada, não quebra.

**Pendente (precisa dos aparelhos físicos)**
- Safari iOS real e Chrome Android real: rodar `corepack pnpm dev` e acessar
  pelo IP da máquina na rede local (mesmo Wi-Fi). Checklist mínimo por
  aparelho: foto pela câmera; toque seleciona procedimento; slider fluido
  (FPS no painel de diagnóstico, ligado em /config); "Antes"/"Dividir";
  exportar PNG e PDF; aba Network sem terceiros; memória estável ao trocar
  de foto 5×. Registrar os números nesta tabela.
