import { notFound } from 'next/navigation'
import { InterfaceHarness } from './InterfaceHarness'

/**
 * Bancada de layout do simulador.
 *
 * O simulador de verdade, com foto e geometria sintéticas, para medir uma coisa
 * só: nenhum controle pode ficar por cima da foto do paciente. Já ficou — o
 * painel de ajuste abria sobre o rosto, bem onde o profissional estava olhando.
 *
 * Fora de desenvolvimento a rota não existe.
 */
export default function InterfaceDiagnosticPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <InterfaceHarness />
}
