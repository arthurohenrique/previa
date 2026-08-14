import { MAX_APPLICATIONS } from './constants'

/**
 * Campo de deslocamento — um passe, não um por ponto.
 *
 * Todas as aplicações são somadas numa única varredura em 1/4 da resolução da
 * foto. O custo em passes é O(1): vinte aplicações rodam no mesmo framerate que
 * uma, porque o que muda é o número de iterações de um laço já barato, não o
 * número de render targets.
 *
 * Saída, em RGBA8:
 *   R, G  deslocamento (dx, dy) em UV da foto, com viés de 0.5 e escala uEncodeScale
 *   B     mistura de suavização acumulada (só a toxina alimenta este canal)
 *   A     1
 *
 * O viés dispensa blending aditivo e com ele todo o problema de alfa
 * pré-multiplicado: a soma acontece dentro do shader, com precisão de float, e
 * só o resultado final é quantizado.
 */
export const FIELD_FRAGMENT = /* glsl */ `
in vec2 vTextureCoord;
out vec4 finalColor;

// O Pixi exige o sampler de entrada do filtro. Aqui ele não é lido: o campo é
// gerado do zero, não derivado da imagem.
uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;

uniform sampler2D uMask0;
uniform sampler2D uMask1;
uniform sampler2D uMask2;
uniform sampler2D uMask3;

// uApp0: centro (x, y) e raios (rx, ry) em UV da foto
// uApp1: amplitude, direção fixa (x, y), modo de direção (0 radial, 1 fixa)
// uApp2: slot de máscara, suavização, reservado, reservado
uniform vec4 uApp0[${MAX_APPLICATIONS}];
uniform vec4 uApp1[${MAX_APPLICATIONS}];
uniform vec4 uApp2[${MAX_APPLICATIONS}];

uniform float uCount;
uniform float uEncodeScale;
uniform float uAspect;

vec4 sampleMask(float textureIndex, vec2 uv) {
    if (textureIndex < 0.5) return texture(uMask0, uv);
    if (textureIndex < 1.5) return texture(uMask1, uv);
    if (textureIndex < 2.5) return texture(uMask2, uv);
    return texture(uMask3, uv);
}

float maskAt(float slot, vec2 uv) {
    float textureIndex = floor(slot * 0.25);
    float channel = slot - textureIndex * 4.0;
    vec4 texel = sampleMask(textureIndex, uv);
    vec4 selector = vec4(
        step(channel, 0.5),
        step(0.5, channel) * step(channel, 1.5),
        step(1.5, channel) * step(channel, 2.5),
        step(2.5, channel)
    );
    return dot(texel, selector);
}

// Perfil radial do deslocamento: zero no centro, zero na borda, pico em t = 1/3.
//
// Zero no centro porque ali não existe direção — empurrar o pixel central para
// "fora" é indefinido, e forçar um valor produz o furo que denuncia simulação
// mal feita. Zero na borda para o efeito costurar com o tecido vizinho sem
// degrau.
float bulgeProfile(float t) {
    if (t >= 1.0) return 0.0;
    float k = 1.0 - t;
    return t * k * k * 6.75;
}

// Perfil da suavização: platô no miolo, queda suave na borda. A toxina relaxa
// uma área inteira, não um ponto.
float smoothProfile(float t) {
    return 1.0 - smoothstep(0.55, 1.0, t);
}

void main() {
    vec2 uv = vTextureCoord / (uOutputFrame.zw * uInputSize.zw);

    vec2 displacement = vec2(0.0);
    float smoothing = 0.0;

    for (int i = 0; i < ${MAX_APPLICATIONS}; i++) {
        if (float(i) >= uCount) break;

        vec4 app0 = uApp0[i];
        vec4 app1 = uApp1[i];
        vec4 app2 = uApp2[i];

        vec2 center = app0.xy;
        vec2 radius = max(app0.zw, vec2(1e-5));

        vec2 delta = uv - center;
        float t = length(delta / radius);
        if (t >= 1.0) continue;

        float mask = maskAt(app2.x, uv);
        if (mask <= 0.0) continue;

        // A direção é calculada num espaço de pixels quadrados, senão o empurrão
        // sai achatado em foto que não é 1:1. uAspect é largura/altura, então
        // (dx, dy/aspect) é proporcional ao delta em pixels.
        vec2 squared = vec2(delta.x, delta.y / uAspect);
        float squaredLength = length(squared);
        vec2 radial = squaredLength > 1e-6 ? squared / squaredLength : vec2(0.0);
        vec2 direction = mix(radial, app1.yz, step(0.5, app1.w));

        // E a volta para UV é (dx, dy*aspect): um deslocamento de k pixels vale
        // k/largura em u e k/altura em v, e altura = largura/aspect.
        //
        // Inverter estes dois fatores custou caro uma vez: o deslocamento saía
        // 1/aspect maior que o teto da região — 33% acima numa foto 3:4 — e
        // ainda esticado na horizontal. O teto por região é requisito de
        // segurança (D-05), não sugestão. Medido em e2e/warp.spec.ts.
        float magnitude = app1.x * bulgeProfile(t) * mask;
        displacement += vec2(direction.x, direction.y * uAspect) * magnitude;

        smoothing += app2.y * smoothProfile(t) * mask;
    }

    vec2 encoded = clamp(displacement / uEncodeScale, vec2(-1.0), vec2(1.0)) * 0.5 + 0.5;
    finalColor = vec4(encoded, clamp(smoothing, 0.0, 1.0), 1.0);
}
`
