import { notFound } from 'next/navigation'
import { RenderHarness } from './RenderHarness'

/**
 * Bancada de render.
 *
 * Monta o simulador com uma foto e uma geometria sintéticas, sem detecção e sem
 * paciente. Existe por um motivo específico: os defeitos que quebram a tela do
 * simulador — programa GLSL que não liga, animação que sobrescreve
 * posicionamento — não aparecem no TypeScript, no lint nem em teste de unidade.
 * Aparecem como tela preta. O único jeito de pegá-los é abrir um navegador de
 * verdade, e é o que `e2e/render.spec.ts` faz aqui.
 *
 * Fora de desenvolvimento a rota não existe.
 */
export default function RenderDiagnosticPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <RenderHarness />
}
