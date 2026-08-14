import { notFound } from 'next/navigation'
import { WarpHarness } from './WarpHarness'

/**
 * Bancada do warp.
 *
 * Monta o pipeline de deformação isolado — sem detecção, sem paciente, sem
 * interface — com uma foto e uma geometria determinísticas, e expõe a leitura
 * dos pixels do resultado.
 *
 * Existe para responder à única pergunta que importa neste produto: aplicar um
 * procedimento muda mesmo a foto, e muda no lugar certo, na medida certa? Isso
 * não é verificável por teste de unidade — o efeito nasce num shader, dentro de
 * um contexto WebGL. `e2e/warp.spec.ts` responde aqui, medindo pixel.
 *
 * Fora de desenvolvimento a rota não existe.
 */
export default function WarpDiagnosticPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <WarpHarness />
}
