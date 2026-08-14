/**
 * Limites do pipeline de warp.
 *
 * `MAX_APPLICATIONS` é o tamanho dos arrays de uniform do shader do campo. O
 * teto é do hardware: GLSL ES 3.00 garante 224 vetores de uniform no fragmento,
 * e cada aplicação ocupa três. Trinta e duas aplicações consomem 96 e deixam
 * folga confortável para o resto.
 *
 * `MAX_MASK_SLOTS` é o número de instâncias de região que podem ter máscara ao
 * mesmo tempo: quatro texturas RGBA, quatro regiões por textura. O atlas produz
 * no máximo 15 instâncias (10 regiões, 5 delas simétricas), então cabe tudo.
 */
export const MAX_APPLICATIONS = 32
export const MAX_MASK_TEXTURES = 4
export const MAX_MASK_SLOTS = MAX_MASK_TEXTURES * 4

/** Resolução do campo de deslocamento, como fração da foto. */
export const FIELD_SCALE = 0.25

/** Feather da máscara de região, em fração de DIP. */
export const MASK_FEATHER_IPD = 0.09
