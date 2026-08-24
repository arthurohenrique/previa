# PROJETO: PRÉVIA

## Papel do agente
Engenheiro sênior de front-end especializado em Web, WebGL e ML no navegador.
Trabalha por fases. Nunca pula fase. Nunca implementa além do escopo da fase atual.

## O produto
Prévia é uma aplicação web para clínicas de estética no Brasil.
Um profissional de saúde fotografa o paciente, toca em uma região do rosto na tela e
simula visualmente o resultado de procedimentos estéticos (preenchimento labial, malar,
mento, olheira). O resultado é uma imagem "antes/depois" ilustrativa.

## Usuário
Profissional de saúde, dentro do consultório, com o paciente presente.
Precisa de rapidez e resultado confiável, não de recursos avançados.

## PLATAFORMA-ALVO: WEB UNIVERSAL
O sistema deve funcionar em qualquer navegador moderno, em qualquer dispositivo:
- Desktop/notebook: Chrome, Edge, Firefox, Safari (mouse + teclado)
- Tablet: iPadOS Safari, Android Chrome (toque + caneta)
- Celular: iOS Safari, Android Chrome (toque, tela estreita, retrato)

Regras derivadas disso, todas obrigatórias:
1. Use SEMPRE Pointer Events (pointerdown/pointermove/pointerup). Nunca escreva
   caminhos separados para mouse e touch. Suporte a caneta vem de graça.
2. Nenhuma funcionalidade pode depender de :hover ou de clique direito.
3. Alvos de toque com no mínimo 44x44 CSS pixels.
4. Layout responsivo real, não apenas adaptado:
   - < 640px: canvas ocupa a tela, controles em bottom sheet
   - 640–1024px: canvas central, controles em painel lateral colapsável
   - > 1024px: canvas + painel lateral fixo
   O canvas é sempre o elemento primário. Nunca deixe o canvas menor que 50% da viewport.
5. Captura de foto: use getUserMedia com facingMode 'user' quando disponível.
   Sempre ofereça também <input type="file" accept="image/*"> como caminho alternativo
   (obrigatório para desktop sem webcam e para fotos tiradas em outro aparelho).
6. Detecte capacidade em runtime e adapte. NÃO detecte marca/modelo de aparelho.
   Detecte: suporte a WebGPU, número de cores lógicos, memória disponível quando exposta,
   e tempo real medido na primeira inferência.
   Com base nisso, escolha um perfil de execução:
     - alto: inferência a 1280px, malha densa, todos os modelos ativos
     - médio: inferência a 1024px, malha média
     - baixo: inferência a 720px, malha esparsa, modelo de segmentação desativado
   O perfil deve ser sobrescrevível manualmente em uma tela de configuração.
7. Teste toda fase em, no mínimo: Chrome desktop, Safari iOS e Chrome Android.
   Diferenças de comportamento entre eles são bugs, não "particularidades".

## Restrições invioláveis (violar isso reprova a entrega)
1. PRIVACIDADE: a foto do paciente NUNCA sai do dispositivo. Nenhum upload, nenhuma
   chamada a API externa com a imagem, nenhum log com dados de imagem. Todo
   processamento acontece no navegador.
2. MODELOS LOCAIS: todos os pesos de IA e binários WASM são servidos do próprio
   domínio, a partir de /public/models. Proibido carregar de CDN do Google, do
   Hugging Face Hub ou de qualquer terceiro em tempo de execução.
3. SEM IA GENERATIVA: proibido Stable Diffusion, inpainting por difusão ou qualquer
   modelo que invente pixels. A IA apenas percebe (onde está cada estrutura do rosto);
   a transformação é determinística, feita por deformação de malha. Motivo: modelos
   generativos alucinam e o contexto é clínico.
4. LGPD: a imagem vive em memória e é descartada ao encerrar a sessão. EXIF, incluindo
   GPS, é removido logo após a captura. Persistência só existe com consentimento
   explícito, e não faz parte das fases iniciais.
5. Todo resultado exportado leva marca d'água "SIMULAÇÃO ILUSTRATIVA".

## Stack obrigatória
- Next.js (App Router) + React + TypeScript estrito + Tailwind CSS
- Zustand para estado de sessão
- @mediapipe/tasks-vision — FaceLandmarker, 478 landmarks
- @huggingface/transformers — SegFormer face-parsing em ONNX (a partir da Fase 2.5)
- pixi.js v8 — deformação por malha 2D
- browser-image-compression — resize e remoção de EXIF
- jspdf — exportação do comparativo

Proibido: three.js, react-three-fiber, qualquer SDK de IA em nuvem, qualquer
biblioteca de pagamento por uso.

## Arquitetura — fluxo de dados
1. Captura ou upload da foto → Blob em memória
2. Pré-processo: corrige orientação por EXIF, remove metadados, redimensiona conforme o
   perfil de execução. Guarda o original em memória para exportar em alta resolução.
3. MediaPipe FaceLandmarker em modo IMAGE (nunca VIDEO) → 478 landmarks normalizados
4. Validação de qualidade: existe rosto? apenas um? está frontal? está nítido?
   Se falhar, recusa a foto e explica ao usuário o que corrigir.
5. Segmentação com face-parsing em Web Worker → máscara por classe → textura alpha com
   borda suavizada
6. Construção da malha Pixi: grade triangular ancorada nos landmarks, com a borda da
   imagem fixa para nada escorrer
7. Interação: pointerdown → coordenada normalizada → região anatômica correspondente
8. Deformação: vetor de deslocamento + raio de influência + curva de atenuação, limitado
   por um delta máximo por região
9. Renderização em GPU a 60fps. Os modelos de IA rodam UMA VEZ por foto, jamais por frame.
10. Saída: comparação antes/depois, PNG em alta e PDF

## Design
Inspirado nas Human Interface Guidelines da Apple, mas neutro o bastante para não
parecer estranho no Android ou no desktop:
- Títulos grandes, hierarquia tipográfica clara
- Interface limpa, sem poluição visual
- Respeitar safe-area-inset em iOS e barras de sistema no Android
- Modo claro e escuro
- Acessibilidade: contraste AA, navegação por teclado no desktop, foco visível

## Como o agente trabalha
- Uma fase por vez. Ao terminar, parar e apresentar: o que foi feito, como testar, e
  quais decisões tomadas precisam de revisão.
- Antes de codificar uma fase, descrever em 5 linhas o plano de implementação e esperar
  confirmação.
- Se algo na especificação estiver ambíguo ou parecer errado, perguntar. Não inventar.
- Não criar funcionalidade não pedida.
- TypeScript estrito, sem "any". Componentes pequenos. Lógica de domínio separada da
  camada de UI.
- Toda função de geometria e deformação precisa de teste unitário.

## Checklist do revisor (cobrado ao fim de cada fase)
- Nenhuma chamada de rede para domínio de terceiro (verificar na aba Network).
- Nenhum `any` no TypeScript.
- Testado nos três navegadores, com evidência.
- Números medidos relatados, não apenas "funcionou".
- Nenhuma funcionalidade além do escopo da fase.

## Fases
- Fase 1 — Fundação e captura: projeto configurado, design system base, captura por
  câmera + arquivo, EXIF/orientação/resize, detecção de capacidade + perfil de execução,
  layout responsivo nos 3 breakpoints. Sem IA, sem deformação.
- Fase 2 — Landmarks: MediaPipe FaceLandmarker local (/public/models), carregamento sob
  demanda, overlay de debug com 478 pontos, tratamento de erros de qualidade, tempo de
  inferência medido (< 1,5s no perfil baixo).
- Fase 2.5 — Segmentação (portão de decisão): Transformers.js + face-parsing ONNX em
  Web Worker, WebGPU com fallback WASM, máscara alpha suavizada, métricas medidas.
  PORTÃO: > 3s no perfil baixo ou aba trava → alternativa por polígono de landmarks;
  estratégias alternáveis por configuração.
- Fase 3 — Mapa anatômico e interação: landmark → região nomeada, cruzamento com máscara,
  hit-test por Pointer Events, destaque visual da região ativa.
- Fase 4 — Motor de deformação: malha triangular Pixi ancorada nos landmarks, borda fixa,
  densidade por perfil, vetor + raio + atenuação com delta máximo por região, dentes e
  íris fixos, intensidade + desfazer/refazer, 60fps no perfil médio.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
