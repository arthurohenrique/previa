/**
 * Passe de warp — remapeia a foto pelo campo de deslocamento.
 *
 * O remapeamento é para trás: para o tecido *aparecer* deslocado em +d, o pixel
 * de destino é amostrado em −d. Trocar esse sinal é o erro clássico e produz uma
 * simulação que suga em vez de projetar.
 *
 * O realce especular vem da divergência do campo. Divergência positiva significa
 * tecido expandindo, e é isso que a luz revela num preenchimento: um brilho
 * curto no topo do volume. O ganho fica entre 3% e 8% — acima disso vira maquiagem.
 */
export const WARP_FRAGMENT = /* glsl */ `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform sampler2D uField;

uniform vec4 uInputSize;
uniform vec4 uInputClamp;
uniform vec4 uOutputFrame;

uniform float uEncodeScale;
uniform float uSpecular;
uniform vec2 uFieldTexel;

vec2 decode(vec2 uv) {
    return (texture(uField, uv).rg * 2.0 - 1.0) * uEncodeScale;
}

void main() {
    vec2 filterScale = uOutputFrame.zw * uInputSize.zw;
    vec2 uv = vTextureCoord / filterScale;

    vec2 displacement = decode(uv);
    vec2 source = clamp(
        vTextureCoord - displacement * filterScale,
        uInputClamp.xy,
        uInputClamp.zw
    );

    vec4 color = texture(uTexture, source);

    if (uSpecular > 0.0) {
        vec2 left  = decode(uv - vec2(uFieldTexel.x, 0.0));
        vec2 right = decode(uv + vec2(uFieldTexel.x, 0.0));
        vec2 up    = decode(uv - vec2(0.0, uFieldTexel.y));
        vec2 down  = decode(uv + vec2(0.0, uFieldTexel.y));

        float divergence =
            (right.x - left.x) / (2.0 * uFieldTexel.x) +
            (down.y - up.y) / (2.0 * uFieldTexel.y);

        // Luz de cima: o topo do volume acende, a base não.
        float lift = clamp(divergence * 0.5, 0.0, 1.0);
        float highlight = lift * uSpecular;
        color.rgb += highlight * (1.0 - color.rgb);
    }

    finalColor = color;
}
`
