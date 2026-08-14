/**
 * Toxina — separação de frequência.
 *
 * A toxina não empurra tecido; ela relaxa o músculo e o vinco some. Simular isso
 * com deslocamento é errado e fica plástico. O certo é separar bandas:
 *
 *   baixa   = borrão largo — carrega a sombra do vinco
 *   alta    = original − borrão curto — carrega poro, pelo, textura
 *   result  = baixa + alta
 *
 * A sombra do vinco vive na banda média-baixa e desaparece; o poro vive na alta
 * e sobrevive. É a diferença entre "sem ruga" e "sem pele".
 *
 * Os dois borrões são calculados sobre a foto original, não sobre a já
 * deformada: onde há toxina o deslocamento é praticamente zero (teto de 0.006
 * DIP), então a diferença é invisível e economiza dois blurs por frame.
 */
export const SMOOTH_FRAGMENT = /* glsl */ `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform sampler2D uField;
uniform sampler2D uBlurSmall;
uniform sampler2D uBlurLarge;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;

void main() {
    vec2 uv = vTextureCoord / (uOutputFrame.zw * uInputSize.zw);

    vec4 original = texture(uTexture, vTextureCoord);
    float amount = texture(uField, uv).b;

    if (amount <= 0.001) {
        finalColor = original;
        return;
    }

    vec3 low = texture(uBlurLarge, uv).rgb;
    vec3 detail = original.rgb - texture(uBlurSmall, uv).rgb;

    finalColor = vec4(mix(original.rgb, low + detail, amount), original.a);
}
`
