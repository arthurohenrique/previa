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

> **Emenda (D-16).** A captura pelo celular abre uma exceção deliberada e
> delimitada: a foto passa de um aparelho da clínica para outro, direto, sem
> tocar em servidor. Leia D-16 antes de tratar esta regra como absoluta.

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

**Proporção.** A direção do empurrão é calculada num espaço de pixels quadrados
e devolvida a UV com o fator inverso: `uAspect` é largura/altura, então o delta
em pixels é proporcional a `(dx, dy/aspect)` e a volta é `(dx, dy*aspect)`.

Inverter esses dois fatores custou caro: o deslocamento saía `1/aspect` maior
que o teto da região — 32% acima numa foto 3:4 — e ainda esticado na horizontal.
O teto por região é requisito de segurança (D-05), não sugestão, e a violação
era invisível para tudo que não medisse pixel. Hoje `e2e/warp.spec.ts` mede.

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

### D-16 — Captura pelo celular por ligação direta, sem servidor no meio

**O problema.** No computador do consultório a câmera é uma webcam de monitor,
quando existe. Ninguém enquadra um rosto de perto com ela, e a validação de
qualidade — que é bloqueante (E-04) — reprovaria a foto de qualquer jeito. O
profissional tem um celular com câmera boa no bolso.

**A solução.** O computador mostra um QR; o celular abre, fotografa e devolve a
foto por `RTCDataChannel`, cifrada por DTLS. O servidor troca apenas as
descrições de sessão do WebRTC (SDP) e nunca vê byte de imagem — a seção 9 da
especificação continua verdadeira: nenhuma rota de API recebe imagem.

**A emenda à regra de ouro.** A foto passa a existir em dois aparelhos da
clínica em vez de um. O que a regra protege — nenhum servidor, nenhum
subprocessador, nenhuma cópia fora dos aparelhos da clínica — continua de pé; o
que muda é a contagem de aparelhos. Fica registrado aqui porque ninguém deve
descobrir isso lendo o código.

**Sem STUN e sem TURN.** `iceServers: []` deixa só candidatos de host: a ponte
fecha se, e só se, os dois aparelhos estiverem na mesma rede — o caso real da
clínica. Um TURN relayaria os bytes por um terceiro; um STUN público entregaria
os endereços da clínica a alguém de fora. Preferimos falhar na cara, com
mensagem que diz o que fazer, a funcionar por um caminho que a regra não
autoriza.

**Autorização por posse.** Quem escaneia o QR não está logado, então a rota
`/captura/[pairId]` é pública. O que autoriza é o identificador do pareamento:
128 bits aleatórios, cinco minutos de validade, queimado quando a resposta
chega. O celular não recebe acesso à tabela `pairings` — fala com duas funções
`security definer` que só respondem sobre a linha cujo id ele já tem. Política
aberta na tabela deixaria qualquer anônimo listar todos os pareamentos da
instalação.

**Limpeza antes do envio.** O celular converte HEIC, reduz para 2048 px e apaga
o EXIF **antes** de transmitir. Num celular o EXIF traz GPS, e GPS de foto de
paciente é a coordenada da clínica. A foto não é gravada no celular: existe em
memória o tempo de atravessar o canal.

**Validação do lado de cá.** A foto que chega do celular entra no mesmo funil de
qualidade da foto local. Foto que veio de fora é justamente a que mais precisa
passar por ele.

**Sem trickle ICE.** A negociação é de duas mensagens: oferta e resposta, com os
candidatos já embutidos. Trickle exigiria canal de sinalização vivo dos dois
lados e economizaria cerca de um segundo num fluxo em que o profissional está
andando até o paciente.

### D-17 — Regiões do atlas são pontos, não cápsulas com rótulo

A especificação pede chips sobre cada região detectada. A primeira versão pôs o
nome da região numa cápsula em cada centróide — e sobre um rosto real, que ocupa
umas trezentas colunas de pixels na tela, quinze cápsulas cobrem o rosto inteiro.
O conteúdo é o rosto; qualquer coisa que compita com ele está errada.

O que ficou:

- Cada região vira um **anel** com alvo de 44pt. O nome vive no `aria-label`,
  aparece no painel quando a aplicação é selecionada, e todos aparecem de uma vez
  no botão "Nomes" — que é consulta de segundos, não estado de trabalho.
- Só aparecem as regiões que aceitam a técnica ativa. Desenhar as outras
  apagadas enchia o rosto de rótulo inútil.
- O ponto fica no **landmark de ancoragem** da região, não no centróide do
  polígono. Em região alongada como a linha mandibular, o centro do fecho convexo
  cai no meio da bochecha — longe da mandíbula e por cima do ponto de outra
  região.

### D-18 — Precisão de fragmento explícita em todo programa GLSL

Todo `GlProgram.from` leva `preferredFragmentPrecision: 'highp'`.

O Pixi injeta `highp` no vertex e `mediump` no fragmento. Como os nossos
fragmentos redeclaram uniforms do vertex do filtro (`uInputSize`,
`uOutputFrame`), o GLSL ES recusa ligar o programa quando as precisões diferem —
e o Pixi registra o erro no console e segue. O sintoma é tela preta, com
TypeScript limpo, lint limpo e todos os testes de unidade passando.

Fora isso, meia precisão em coordenada de textura de uma foto de 2048 px produz
salto visível na amostragem.

A bancada em `/diagnostico/render` e `e2e/render.spec.ts` existem por causa
desta classe de defeito: ela só aparece num navegador de verdade.

### D-19 — Os filtros que desenham a foto herdam a resolução do canvas

`Filter.defaultOptions.resolution` do Pixi é **1**, e o canvas roda em
`min(devicePixelRatio, 2)`. Um filtro que não pede `resolution: 'inherit'`
renderiza a metade da resolução do aparelho e é reescalado na composição.

O efeito era duplo e nenhum dos dois aparecia em teste de tipo ou de unidade:

- a foto simulada saía mais macia que a original, e o profissional julgava
  textura de pele contra um borrão;
- como o passe de suavização só entra quando existe toxina, aplicar a primeira
  toxina reamostrava a foto **inteira** — três quartos dos pixels alterados
  caíam fora da região tratada.

O filtro do campo continua em resolução própria: ele desenha num `RenderTexture`
de tamanho fixo, e 1/4 da foto é a escolha deliberada de D-08.

`e2e/warp.spec.ts` mede, e `tests/guardrails.test.ts` exige os dois `'inherit'`.

### D-24 — O produto funciona fora de contexto seguro

Testado no celular apontando para o computador — `http://192.168.x.x:3000` —,
o app não fazia nada. Dois motivos, os dois invisíveis em `localhost`, que é
contexto seguro por definição e por isso esconde a classe inteira de problema.

**`crypto.randomUUID` não existe em contexto inseguro.** É API restrita a HTTPS
e localhost. Toda foto e toda aplicação nasciam de um `crypto.randomUUID()`, e
ali ele é `undefined`: o `TypeError` caía no `catch` e a interface dizia apenas
que não foi possível preparar a foto. `lib/id.ts` passa a gerar o UUID v4 com
`getRandomValues` — que existe em contexto inseguro — e com `Math.random` como
último recurso. O formato continua UUID v4 porque o Postgres tem coluna `uuid`
do outro lado; a fonte de aleatoriedade é que muda, e vale porque estes ids
identificam linha, não segredo.

**O dev server bloqueia origem cruzada.** O Next responde 403 em todo
`/_next/*` pedido de um host que não está em `allowedDevOrigins`, e a página
abre sem JavaScript nenhum. Testar no celular apontando para a máquina de
desenvolvimento é o fluxo normal deste produto — webcam de monitor não serve
para foto de rosto —, então as faixas privadas entram na lista:
`192.168.*.*`, `10.*.*.*`, `172.*.*.*` e `*.local`. O casamento do Next é por
segmento separado por ponto, com curinga: não aceita CIDR, e IP público
continua bloqueado (verificado contra a própria função do Next).

Verificado emulando Android Chrome contra o IP da rede: contexto inseguro,
detecção completa, toque abrindo o painel e pixels mudando.

Fica registrado o que **não** funciona sem HTTPS, por decisão do navegador:
service worker (a PWA não instala e não guarda o modelo offline) e a captura
pelo celular por WebRTC (D-16), que precisa de `RTCPeerConnection`. Para
exercitar essas duas, um túnel HTTPS ou o ambiente publicado.

### D-23 — A detecção sobrevive ao WebKit

Testada com uma foto de rosto de verdade, a detecção falhava em **todo**
Safari — o navegador do iPad, o aparelho para o qual o produto existe. Três
defeitos independentes, um atrás do outro:

**O runtime do MediaPipe pedia `document` dentro do worker.** O teste interno
de `OffscreenCanvas` dele reprova no WebKit e cai em `document.createElement` —
que não existe em worker. Correção dupla: o canvas vai explícito na criação
(`canvas: new OffscreenCanvas(1, 1)` quando o ambiente tem), e o `detect()` que
quebra em GPU refaz uma vez em CPU — criar em GPU pode funcionar e só a
primeira foto quebrar, então o fallback da criação nunca dispararia.

**Worker sem canvas nenhum.** Há WebKits — o do Playwright hoje, Safaris mais
velhos — em que worker não tem `OffscreenCanvas` nem `document`. O núcleo da
análise saiu do worker para `lib/face/analysis.ts`, compartilhado, e
`analyzePhoto` ganhou plano B: se o worker devolve falha de engine, a mesma
análise roda na main thread, que sempre tem canvas. Custa alguns quadros uma
vez por foto (D-06 intacto). Por isso a API recebe o `Blob`, não um bitmap:
cada tentativa consome o seu, e bitmap transferido para worker não volta.

**IndexedDB que recusa Blob.** Navegação privada do WebKit (e o build headless)
grava `ArrayBuffer` mas recusa `Blob`. A foto agora é gravada como bytes + tipo
e o Blob é reconstruído na leitura; linhas antigas com Blob continuam legíveis.
E persistir deixou de ser fatal: sem armazenamento, a sessão segue em memória —
só não sobrevive ao reload.

De quebra, a tela de teste parou de esconder o motivo: "a detecção falhou"
virou "a detecção falhou: <causa>". O genérico escondia a causa exatamente de
quem podia consertá-la.

Verificado com foto real nos dois motores (WebKit e Chromium): detecção,
toque alterando pixels, e sessão restaurada após reload. O realce especular do
preenchedor foi medido na foto real: +4,2% de brilho no núcleo da região, dentro
da faixa de 3–8% da especificação.

### D-22 — A aplicação nasce no núcleo da região, e a intensidade é linear

O simulador não simulava. Tocar numa região punha o marcador na tela, abria o
painel, gravava a aplicação — e a foto não mudava. Medido na bancada: 0,12% dos
pixels alterados com o controle no máximo, deslocamento perto de zero.

Eram três perdas em série, e cada uma multiplicava a seguinte.

**O ponto de aplicação estava na borda.** A aplicação nascia no landmark de
ancoragem, que é um dos índices da própria região — logo, um vértice do fecho
convexo. A máscara da região vale zero na borda por construção (é o que impede a
simulação de arrastar fundo e cabelo). O anel apontava exatamente para o único
lugar da região onde tocar não faz efeito. Agora cada instância carrega um
`core`: o centro do maior círculo que cabe no polígono. É onde o anel é
desenhado e onde a aplicação nasce.

**O feather era maior que a região.** 0,09 DIP fixo. A malar tem folga para
isso; o vermelhão do lábio tem meia espessura disso, e a máscara dele nunca
chegava perto de 1 — a amplitude pedida saía cortada em qualquer lugar da
região. O feather agora é limitado a metade do raio inscrito, então toda região
tem núcleo de máscara cheia.

**A curva escondia o teto.** `amplitudeFor` elevava a intensidade ao quadrado.
O teto do preenchedor já é conservador — 0,038 DIP, cerca de 2,4 mm aparentes —,
e o padrão de 45% entregava 20% disso: meio milímetro, antes da máscara. O mapa
agora é linear, e o padrão subiu para 50%. O teto continua onde estava, que é o
que D-05 protege; a curva não é lugar de esconder limite de segurança. Uma
simulação que não se vê não protege ninguém — o profissional conclui que o
controle não funciona e trabalha sempre no fim do curso.

O raio padrão também deixou de ser fixo: 1,5 vez o raio inscrito da região,
ainda sob o teto da técnica. O pico do perfil de bojo fica em um terço do raio,
e com raio fixo esse pico caía fora da máscara nas regiões pequenas.

Depois das três, medido na mesma bancada, na glabela: deslocamento de 7,0 px no
padrão e 13,0 px no máximo, contra um teto de 13,3 px. Antes: nada mensurável.

`e2e/simulacao.spec.ts` mede tudo isso pelo caminho do produto — toque no anel,
store, atlas, máscara — sobre a bancada `/diagnostico/interface`.
`e2e/warp.spec.ts` continua medindo o pipeline isolado. As duas provas são
necessárias: o pipeline sempre esteve certo, e era a integração que estava
errada.

### D-21 — O controle não fica por cima da foto

O painel de ajuste abria flutuando sobre o rosto. No único momento em que o
profissional precisa olhar o resultado — arrastando a intensidade — ele estava
olhando para o painel. Material translúcido não resolve: ver a foto borrada por
trás de um controle não é ver a foto.

O palco e a barra de controles passam a ser irmãos num flex, não camadas
empilhadas. Retrato empilha, paisagem põe a barra ao lado; nos dois casos a foto
tem um retângulo só dela, e sobre ela só existe o que é a própria interação: os
anéis de região e os marcadores.

Duas alturas ficam reservadas na barra — a linha de recado e o espaço do ajuste.
Sem isso, selecionar uma aplicação faria a barra crescer, a foto encolher e os
anéis andarem debaixo do dedo que acabou de tocar neles. Reservar espaço vazio é
mais barato do que reposicionar o rosto no meio do trabalho.

O que a barra ganhou de graça: ela não precisa mais ser vidro. O vidro existia
para deixar ver a foto por baixo do controle; sem nada por baixo, a superfície é
opaca.

`e2e/interface-layout.spec.ts` mede as três propriedades — nenhuma interseção com
o palco, o palco não muda de tamanho ao selecionar, todo alvo com 44 pt — nas duas
orientações, sobre a bancada `/diagnostico/interface`.

### D-20 — Em teste, a raiz é o simulador e não há porteiro

O produto tem duas metades com exigências opostas. Foto, detecção, warp e render
não precisam de conta: rodam inteiros no aparelho, e a foto nunca sai dele
(D-01). Paciente, consentimento, protocolo e auditoria só existem sob RLS, e
precisam de perfil.

Enquanto o app está em teste, `/` é a primeira metade e mais nada. O redirect
preventivo do `proxy.ts` saiu — ele mandava qualquer visitante para `/login`
antes de a rota decidir o que fazer. As rotas que tocam em dado de paciente
continuam pedindo perfil no próprio `layout`, então o que caiu foi a barreira
antecipada, não a autorização: quem abrir `/pacientes` sem sessão continua
parando no login, e nenhuma política do Postgres foi afrouxada.

O que a tela solta não oferece — PDF, sincronização e captura pelo celular —
está em `app/TestBench.tsx` e no README. A ficha é o caso interessante: ela sai
do fluxo em vez de sair marcada como teste, porque a marca d'água existe para
amarrar a simulação a um conselho e a um número de registro, e uma ficha anônima
é o que ela existe para impedir.

O bloco removido do `proxy.ts` ficou comentado no lugar, e o caminho de volta
está no README.

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
| E-09 | O QR é desenhado com preto sobre branco fixos (`--qr-paper`, `--qr-ink`), fora do sistema de tema. | Leitor de código conta com módulo escuro sobre fundo claro, e QR invertido falha em parte dos aparelhos. A tela do simulador é escuro fixo (E-01), então o código ganha uma placa clara. Continuam sendo papéis semânticos em CSS variable — só não acompanham o tema. |

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
| 2026-08-14 | D-16 e E-09: captura pelo celular por WebRTC. **Emenda à regra de ouro (D-01)** — a foto passa a existir em dois aparelhos da clínica. | Engenharia |
| 2026-08-14 | D-17 e D-18: regiões viram anéis, e precisão de fragmento explícita nos shaders. Correção de dois defeitos de render que só aparecem em navegador; bancada em `/diagnostico/render`. | Engenharia |
| 2026-08-18 | D-24: no celular pelo IP da rede o app não fazia nada — `crypto.randomUUID` não existe fora de contexto seguro, e o dev server bloqueava origem cruzada. `lib/id.ts` e `allowedDevOrigins`. | Engenharia |
| 2026-08-18 | D-23: a detecção falhava em todo Safari (runtime pedia `document` no worker). Canvas explícito, retry em CPU, fallback de main thread e foto gravada como bytes. Verificado com foto real nos dois motores. | Engenharia |
| 2026-08-18 | D-22: a simulação não se via. Aplicação passa a nascer no núcleo da região, feather limitado pelo raio inscrito, intensidade linear. Medido em `e2e/simulacao.spec.ts`. | Engenharia |
| 2026-08-18 | D-21: o painel de ajuste sai de cima da foto. Palco e controles viram irmãos num flex, com altura reservada para não reescalar a foto ao selecionar. Bancada em `/diagnostico/interface`. | Engenharia |
| 2026-08-18 | D-20: em teste, a raiz vira a tela de captura e simulação e o `proxy.ts` para de redirecionar para o login. Nada de RLS mudou. | Engenharia |
| 2026-08-14 | D-19 e a nota de proporção em D-08: dois defeitos achados medindo pixel. O deslocamento passava 32% do teto da região, e os filtros rodavam a metade da resolução do aparelho. Bancada em `/diagnostico/warp` e `e2e/warp.spec.ts`. | Engenharia |

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
