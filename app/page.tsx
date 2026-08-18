import type { Metadata } from 'next'
import { TestBench } from './TestBench'

export const metadata: Metadata = { title: 'Prévia' }

/**
 * A tela do produto, sozinha: fotografar e simular.
 *
 * Enquanto o app está em teste, a raiz é o simulador — sem login, sem paciente,
 * sem banco no caminho. Tudo que a prévia produz fica no IndexedDB do aparelho,
 * que é onde já ficava; o que saiu do caminho foi o cadastro em volta dela.
 *
 * As telas de paciente, consentimento e protocolos continuam no repositório e
 * seguem funcionando em `/pacientes`, atrás do login. Para devolver a raiz a
 * elas, apague este arquivo e recrie `app/(app)/page.tsx` com um
 * `redirect('/pacientes')`.
 */
export default function Home() {
  return <TestBench />
}
