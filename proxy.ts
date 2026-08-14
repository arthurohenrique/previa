import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

// Next 16: `middleware.ts` foi renomeado para `proxy.ts` e o export chama
// `proxy`. O runtime é Node.js e não é configurável.
//
// Este arquivo faz duas coisas e mais nada: renova a sessão do Supabase e manda
// visitante não autenticado para o login. Nenhuma imagem passa por aqui — nem
// poderia, já que a foto nunca chega ao servidor (D-01).

// `/captura` é público de propósito: quem escaneia o QR é o celular do
// profissional, que não está logado. A autorização é a posse do identificador do
// pareamento — 128 bits aleatórios, cinco minutos de validade.
//
// `/diagnostico` é a bancada de render, que não toca em dado de paciente e
// devolve 404 fora de desenvolvimento.
const PUBLIC_PATHS = ['/login', '/auth', '/captura', '/diagnostico']

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  // Sem env configurada não há sessão para renovar; deixa passar para que o
  // erro apareça na página, com mensagem útil, em vez de virar 500 opaco.
  if (!url || !anonKey) return response

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value)
        }
        response = NextResponse.next({ request })
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options)
        }
      },
    },
  })

  // getUser() e não getSession(): valida o token no servidor de auth em vez de
  // confiar no cookie.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))

  if (!user && !isPublic) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  if (user && pathname === '/login') {
    const homeUrl = request.nextUrl.clone()
    homeUrl.pathname = '/pacientes'
    homeUrl.search = ''
    return NextResponse.redirect(homeUrl)
  }

  return response
}

export const config = {
  matcher: [
    // Tudo, menos assets estáticos, o modelo, o WASM e os arquivos da PWA.
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw\\.js|models/|mediapipe/|icons/|.*\\.(?:png|jpg|jpeg|svg|webp|task|wasm)$).*)',
  ],
}
