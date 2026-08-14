# DECISIONS.md — Prévia

Registro de decisões de arquitetura e de design. Nada da interface é implementado
antes de estar escrito aqui; o que está aqui é implementado literalmente.

Referência normativa de design: **Apple Human Interface Guidelines**
(https://developer.apple.com/design/human-interface-guidelines) — Foundations,
Patterns, Components e a plataforma iPadOS.

---

## 1. Decisões de arquitetura

### D-01 — A foto do paciente nunca sai do dispositivo

Detecção, warp, render e export acontecem no cliente. A imagem é persistida só em
IndexedDB (Dexie). O Supabase recebe metadados: quem, quando, quais regiões, qual
intensidade, qual consentimento.

**Por quê:** foto de rosto de paciente é dado pessoal sensível de saúde na LGPD
(art. 5º, II). Mantendo tudo local não existe transferência, não existe
subprocessador e a superfície de vazamento fica restrita ao próprio tablet.

**Consequências que não podem ser contornadas:**
- Nenhuma rota em `app/api/` aceita ou devolve bytes de imagem.
- Não existe bucket de Storage para foto de paciente.
- Não existe thumbnail, não existe base64 em coluna de texto.
- O PDF de ficha é montado e baixado no cliente; o servidor não vê o arquivo.
- Teste e2e falha se qualquer request exceder um limite pequeno de payload.

### D-02 — `local_image_ref` é um ponteiro, não um dado

`sessions.local_image_ref` é um UUID que só faz sentido dentro do IndexedDB do
tablet que capturou a foto. Em outro dispositivo a sessão abre sem imagem e
oferece nova captura, reancorando as aplicações pelos landmarks (D-07).

### D-03 — Nenhuma dose no código

`applications.intensity` é adimensional (0..1) e descreve só amplitude de
simulação visual. Produto, dose, unidade e volume vivem em `region_presets`,
cadastrados pelo profissional. O código nunca sugere miligrama, unidade nem ml.

**Por quê:** dose é ato médico-odontológico. Um número plausível hardcoded vira
prescrição de fato e transfere para o software uma responsabilidade que é do
profissional.

### D-04 — Toda amplitude e todo raio em fração de DIP

DIP = distância interpupilar medida na própria foto. Pixel não é comparável entre
fotos, entre pacientes nem entre consultas; fração de DIP é. Vale no banco
(`radius_ipd`, `anchor_offset_u/v`) e no código.

### D-05 — Clamp por região no código, não na UI

`lib/warp/clamps.ts` define amplitude máxima por região e técnica. A UI não
sobrescreve. Simulação exagerada é o maior risco do produto: o paciente vê um
resultado impossível, faz o procedimento e não se reconhece.

### D-06 — Detecção uma vez, congelada

478 landmarks + matriz de transformação são calculados uma vez em Web Worker e
guardados em `useRef`. Nunca há redetecção durante a interação. Redetectar a cada
toque é o que transforma 16 ms em 300 ms.

### D-07 — Ancoragem por landmark, não por pixel

Cada aplicação guarda `anchor_landmark` + offset em DIP. Foto nova do mesmo
paciente reposiciona tudo automaticamente.

### D-08 — Campo de deslocamento acumulado, custo O(1)

Todas as aplicações somam num único `RenderTexture` em 1/4 da resolução da foto.
Um filtro final lê o campo e remapeia a foto. 20 aplicações custam o mesmo que 1:
o passe é único e o que cresce é a contagem de um laço já barato, não o número
de render targets.

**Como a soma acontece.** A especificação sugeria um sprite por aplicação com
`blendMode: 'add'`. A implementação soma dentro do shader, num passe de tela
cheia que percorre até 32 aplicações vindas de arrays de uniform.

Motivo: o deslocamento tem sinal, e blending aditivo em RGBA8 não representa
negativo. As saídas seriam ou uma divisão em quatro canais (+dx, −dx, +dy, −dy),
que esbarra em alfa pré-multiplicado, ou um alvo de ponto flutuante, cujo
blending não é garantido no Safari do iPad. Somando no shader, o acumulador é
float e só o resultado final é quantizado, com viés de 0.5. Sobra ainda um canal:
o B carrega a mistura de suavização da toxina, e a separação de frequência lê o
mesmo campo em vez de precisar de um segundo.

**Codificação.** `R, G` = deslocamento com viés; `B` = suavização; `A` = 1. A
escala de codificação acompanha o pior caso do conjunto — fixa, desperdiçaria
bits numa sessão leve e cortaria numa carregada.

### D-11 — Máscara de região analítica, quatro por textura

Cada instância de região vira um canal de uma textura RGBA em 1/4 da resolução:
quatro regiões por textura, quatro texturas, dezesseis vagas para as quinze
instâncias que o atlas produz.

O feather é calculado por distância com sinal até o polígono convexo, não por
borrão. Como o polígono é o fecho convexo dos landmarks, a distância é o máximo
dos produtos escalares com as normais das arestas: exato, barato e sem depender
de `ctx.filter`, que só existe no Safari 17 em diante.

O feather cresce **para dentro**. Máscara que vaza para fora arrasta fundo e
cabelo junto com a pele — é o artefato que mais denuncia simulação.

O canal alfa é dado, não transparência: o bitmap nasce com
`premultiplyAlpha: 'none'` e a fonte com `alphaMode: 'no-premultiply-alpha'`.
Sem os dois, o navegador multiplica RGB por A no upload e apaga três das quatro
regiões de cada textura.

### D-12 — Polígono de região é fecho convexo, não lista ordenada

O atlas guarda um conjunto de índices por região; o polígono é o fecho convexo
desse conjunto.

Lista ordenada à mão quebra em silêncio: um índice fora de ordem produz polígono
auto-intersectado, o point-in-polygon passa a mentir e o toque cai na região
errada sem nenhum erro aparecer. O fecho convexo é indiferente à ordem e sempre
produz polígono simples — e ainda é o que torna a máscara analítica possível
(D-11).

As regiões faciais tratáveis são convexas ou quase. Onde não são — a linha
mandibular —, o excesso fica contido pelo clamp de amplitude da própria região.

### D-13 — O snap do toque mede distância até a borda, não até o centróide

A escolha da região no snap é pelo centróide mais próximo, como especificado. O
corte que decide se há snap é pela distância até a **borda**.

Com corte por centróide, uma região grande como a linha mandibular nunca
aceitaria um toque rente à sua borda — a distância até o centro dela já passa de
qualquer limite razoável — enquanto uma região pequena aceitaria toques longe
demais. O limite padrão é 0.06 em coordenada normalizada.

### D-14 — Shaders em `.frag.ts`, não `.frag`

O GLSL vive em `lib/warp/filters/*.frag.ts`, exportando o código como template
literal.

O Turbopack não tem carregador nativo de texto cru, e configurar um só para três
arquivos custa mais do que rende: um `loader` a manter, um ponto a mais de
divergência entre `dev` e `build`, e nenhum ganho — o shader não é reaproveitado
fora do bundle. Em troca, o arquivo aceita comentário de TypeScript, importa
constantes compartilhadas (`MAX_APPLICATIONS`) e entra na verificação de tipos.

### D-09 — Modelo e WASM servidos da própria origem

O `.task` fica em `/public/models/` e o runtime WASM é copiado do `node_modules`
para `/public/mediapipe/wasm/` no `postinstall`. Nenhuma dependência de CDN:
sem isso a PWA não abre offline e a clínica com Wi-Fi ruim fica parada.

### D-10 — `proxy.ts`, não `middleware.ts`

Confirmado na doc versionada do Next 16.3.1: `middleware` foi renomeado para
`proxy`, o export chama `proxy`, e o runtime é Node.js e não é configurável.

---

## 2. Sistema de design

### 2.1 Papéis semânticos de cor

Nenhum componente escreve hex. Tudo vem destas variáveis. Valores derivados do
sistema de cores do iPadOS.

| Token | Papel | Claro | Escuro |
|---|---|---|---|
| `--label` | Texto primário, ícone ativo | `rgb(0 0 0)` | `rgb(255 255 255)` |
| `--label-secondary` | Texto de apoio, legenda | `rgb(60 60 67 / 0.60)` | `rgb(235 235 245 / 0.60)` |
| `--label-tertiary` | Placeholder, estado inativo | `rgb(60 60 67 / 0.30)` | `rgb(235 235 245 / 0.30)` |
| `--label-quaternary` | Desabilitado | `rgb(60 60 67 / 0.18)` | `rgb(235 235 245 / 0.18)` |
| `--background` | Fundo da tela | `rgb(255 255 255)` | `rgb(0 0 0)` |
| `--background-grouped` | Fundo de lista agrupada | `rgb(242 242 247)` | `rgb(0 0 0)` |
| `--background-elevated` | Cartão, painel, popover | `rgb(255 255 255)` | `rgb(28 28 30)` |
| `--background-elevated-2` | Segundo nível (máximo) | `rgb(242 242 247)` | `rgb(44 44 46)` |
| `--fill-secondary` | Preenchimento de controle | `rgb(120 120 128 / 0.16)` | `rgb(120 120 128 / 0.32)` |
| `--separator` | Hairline | `rgb(60 60 67 / 0.29)` | `rgb(84 84 88 / 0.60)` |
| `--accent` | Ação primária e ponto ativo | `rgb(0 122 255)` | `rgb(10 132 255)` |
| `--accent-on` | Texto sobre o acento | `rgb(255 255 255)` | `rgb(255 255 255)` |
| `--critical` | Só destrutivo e bloqueio de qualidade | `rgb(215 0 21)` | `rgb(255 69 58)` |
| `--focus-ring` | Foco de teclado | `rgb(0 122 255)` | `rgb(10 132 255)` |

**Um acento só.** `--accent` é o único saturado da interface, usado em ação
primária e no marcador de aplicação ativo. Azul de sistema é escolha deliberada:
é neutro, não sugere resultado estético e não compete com tom de pele.
`--critical` não é um segundo acento — ele só aparece em erro bloqueante ou ação
destrutiva, e nunca junto de `--accent` na mesma tela.

### 2.2 Escala tipográfica

Uma única família: a fonte do sistema. Nenhuma webfont importada.

```
--font-system: -apple-system, "SF Pro Text", "SF Pro Display", system-ui, sans-serif;
```

`1rem = 17pt = corpo`. A raiz recebe `font: -apple-system-body`, que no Safari
carrega o tamanho de Dynamic Type escolhido pela pessoa; navegadores que não
entendem a declaração ficam no fallback de `106.25%` (17px). Como toda a escala é
em `rem`, o app inteiro cresce junto com a preferência do sistema.

| Estilo | Token | Tamanho | rem | Peso | Tracking | Uso |
|---|---|---|---|---|---|---|
| Large title | `--text-large-title` | 34pt | 2rem | 700 | −0.4px | Título de tela principal |
| Title | `--text-title` | 28pt | 1.6471rem | 700 | −0.3px | Título de folha/modal |
| Title 3 | `--text-title3` | 20pt | 1.1765rem | 600 | −0.2px | Cabeçalho de seção |
| Headline | `--text-headline` | 17pt | 1rem | 600 | −0.2px | Item de lista em destaque |
| Body | `--text-body` | 17pt | 1rem | 400 | −0.2px | Corpo — **piso de legibilidade** |
| Subhead | `--text-subhead` | 15pt | 0.8824rem | 400 | −0.1px | Apoio |
| Footnote | `--text-footnote` | 13pt | 0.7647rem | 400 | 0 | Metadado |
| Caption | `--text-caption` | 12pt | 0.7059rem | 400 | 0 | Rótulo de eixo, unidade |

Alturas de linha: large title 1.2, title 1.2, title3 1.25, headline/body 1.3,
subhead 1.33, footnote 1.38, caption 1.33.

**17pt é o piso do corpo.** Nada que o profissional precise ler na frente do
paciente desce abaixo disso. Footnote e caption existem só para metadado e
unidade — nunca para conteúdo.

Números — intensidade, raio, DIP, ângulo, data, hora — usam
`font-variant-numeric: tabular-nums`. Medida não dança quando o valor muda.

**Large title colapsando.** Toda tela principal abre com o large title de 34pt
Bold alinhado à esquerda; ao rolar, ele encolhe e some enquanto o título inline
de 17pt Semibold aparece na barra. A transição é dirigida por `IntersectionObserver`
sobre o título grande — sem listener de `scroll` e sem `setState` por frame.

### 2.3 Espaçamento

Grade de 8pt. O passo de 4pt existe só para alinhar hairline e ícone.

| Token | Valor |
|---|---|
| `--space-0-5` | 4px |
| `--space-1` | 8px |
| `--space-2` | 16px |
| `--space-3` | 24px |
| `--space-4` | 32px |
| `--space-5` | 40px |
| `--space-6` | 48px |
| `--space-8` | 64px |

Margem de conteúdo: `--space-3` (24px) em retrato, `--space-4` (32px) em paisagem.
`safe-area-inset-*` somado em todos os lados, inclusive esquerda e direita em
paisagem.

**Alvo de toque:** `--touch-target: 44px`. Mínimo absoluto em tudo que se toca,
inclusive nos chips sobre a foto. Quando o desenho pede algo visualmente menor,
o elemento cresce por `padding` ou por pseudo-elemento — a área cresce, o desenho
não.

### 2.4 Raios

Cantos concêntricos: raio interno = raio externo − padding.

| Token | Valor | Uso |
|---|---|---|
| `--radius-sm` | 10px | Campo, chip pequeno |
| `--radius-md` | 14px | Cartão, célula de lista |
| `--radius-lg` | 20px | Painel, popover |
| `--radius-xl` | 28px | Folha modal |
| `--radius-capsule` | 999px | Botão de ação, chip de região |

### 2.5 Materiais e profundidade

| Token | Valor |
|---|---|
| `--material-blur` | `blur(20px) saturate(180%)` |
| `--material-bg` | claro `rgb(255 255 255 / 0.72)` · escuro `rgb(30 30 32 / 0.72)` |
| `--shadow-1` | `0 1px 3px rgb(0 0 0 / 0.10)` |
| `--shadow-2` | `0 8px 24px rgb(0 0 0 / 0.18)` |

Translucidez só em chrome flutuante sobre a foto — barra de ferramentas, painel
de intensidade, popover de técnica. **Nunca sobre a foto em si** e nunca em
painel de conteúdo fixo. Duas camadas de profundidade no máximo. Sem gradiente
decorativo, sem brilho, sem borda luminosa.

### 2.6 Movimento

| Token | Valor |
|---|---|
| `--duration-fast` | 200ms |
| `--duration-base` | 260ms |
| `--ease-out` | `cubic-bezier(0.22, 1, 0.36, 1)` |

Um único momento orquestrado no produto inteiro: as regiões do atlas acendendo
sobre o rosto ao terminar a detecção, em cascata rápida de baixo para cima, uma
vez por sessão. Todo o resto fica imóvel. `prefers-reduced-motion: reduce`
desliga a cascata e todas as transições sem alterar o layout.

### 2.7 Escrita da interface

Verbo ativo, sentence case, nome da ação idêntico do botão ao resultado.

| Situação | Texto |
|---|---|
| Ação | "Aplicar preenchedor" → resultado "Preenchedor aplicado" |
| Rótulo de controle | "Intensidade", não "amplitude do campo" |
| Estado vazio | "Fotografe o paciente para começar" |
| Erro de ângulo | "Rosto de perfil. Reposicione para frontal." |
| Erro de nitidez | "Foto desfocada. Apoie o tablet e refaça." |
| Erro de luz | "Foto escura. Aumente a luz do ambiente." |

Nenhum texto usa marca de terceiros. Toxina botulínica, preenchedor de ácido
hialurônico, bioestimulador de colágeno — nunca o nome comercial. O nome do
produto aparece sempre acentuado, *Prévia*, e nunca acompanhado de adjetivo de
resultado.

### 2.8 Piso de acessibilidade

Contraste AA em todo texto. Foco de teclado visível (anel de 2px em
`--focus-ring` com offset de 2px). Chips de região navegáveis por VoiceOver, com
`role="button"` e rótulo que diz a região e o estado. Retrato e paisagem sem
quebra. Dynamic Type no tamanho máximo sem sobreposição nem corte.

---

## 3. Exceções à HIG — uma linha por exceção

| # | Exceção | Justificativa |
|---|---|---|
| E-01 | **A tela do simulador é modo escuro fixo**, ignorando `prefers-color-scheme`. | Julgar volume e tom de pele contra fundo claro engana o olho: o fundo claro faz a pele parecer mais escura e achata o relevo percebido. O restante do app respeita a preferência do sistema. |
| E-02 | Tracking negativo (−0.4px) no large title, onde a tabela da Apple usa tracking positivo em 34pt. | A tabela da Apple assume peso Regular. Em Bold, nos títulos curtos que o Prévia usa ("Pacientes", "Protocolos"), o positivo abre demais as contraformas. |
| E-03 | `user-scalable=no` no viewport, contrariando a recomendação de nunca desabilitar zoom. | O pinch precisa ser do canvas: zoom nativo durante a marcação move a foto sob o dedo e o ponto cai errado. Mitigação obrigatória: Dynamic Type suportado até o tamanho máximo, corpo com piso de 17pt e pinch próprio dentro do canvas. |
| E-04 | Validação de qualidade da foto é **bloqueante**, onde a HIG prefere avisar sem impedir. | Sem o bloqueio o "depois" mente por ângulo em vez de mostrar o procedimento. É requisito de segurança do produto, não de fluxo. |
| E-05 | Ícones desenhados em SVG inline em vez de SF Symbols. | SF Symbols não é distribuível na web. Traço com peso casado ao da tipografia ao lado, no mesmo grid de 44pt. |
| E-06 | `border-radius` comum no lugar de cantos contínuos (squircle). | CSS não expõe corner smoothing. Raios grandes da escala 2.4 aproximam sem custo de runtime; um path SVG por caixa não se paga. |
| E-07 | Uma animação de entrada orquestrada (cascata do atlas), onde a HIG pede parcimônia. | É o único momento animado do produto inteiro e comunica um fato: a detecção terminou e estas são as regiões disponíveis. Desligada por `prefers-reduced-motion`. |
| E-08 | Teto de 32 aplicações por prévia, com aviso na tela ao atingir. | É o tamanho dos arrays de uniform do shader do campo (D-08); GLSL ES 3.00 garante 224 vetores no fragmento e cada aplicação ocupa três. Um limite anunciado é melhor do que uma 33ª aplicação que some sem explicação. |

---

## 4. Proibições explícitas

Sem gradiente de fundo. Sem sombra longa e difusa. Sem card dentro de card. Sem
emoji na interface. Sem badge colorido. Sem ilustração de estoque. Sem
glassmorphism em conteúdo. Sem barra de progresso animada onde um indicador
nativo resolve. Sem mais de uma cor saturada na tela ao mesmo tempo, contando a
pele da foto.

Antes de considerar uma tela pronta: remova um elemento e verifique se piorou.
Se não piorou, ele não volta.

---

## 5. Registro de mudanças

| Data | Decisão | Quem |
|---|---|---|
| 2026-08-14 | Documento inicial: D-01 a D-10, sistema de design, E-01 a E-07. | Engenharia |
| 2026-08-14 | D-08 detalhado com a soma no shader; D-11 a D-14 e E-08 acrescentados durante a implementação do warp. | Engenharia |

---

## 6. Pendência conhecida

**Validação visual do atlas.** Os índices de landmark de `lib/face/atlas.ts`
vieram dos agrupamentos canônicos da malha do MediaPipe e estão cobertos por
testes de consistência (faixa válida, simetria entre lados, área positiva, chave
única). O que **não** foi feito é a conferência sobre um rosto real, exigida pela
seção 6.4 da especificação — ela precisa de uma foto de paciente num iPad, e a
foto não sai do dispositivo por definição.

Antes de uso clínico: abra uma sessão, sobreponha os polígonos a um rosto real e
ajuste os conjuntos de índices. Os testes de `tests/atlas.test.ts` continuam
valendo depois do ajuste e apontam qualquer erro estrutural introduzido.
