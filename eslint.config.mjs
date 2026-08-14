import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // `any` é proibido no código de domínio (critério de aceite). Onde o tipo
      // vem de fora (Pixi, MediaPipe, Dexie) usa-se `unknown` + narrowing.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      // A foto do paciente é um <img> cru de propósito: next/image otimiza no
      // servidor, e nada da foto pode chegar ao servidor (seção 2).
      '@next/next/no-img-element': 'off',
    },
  },
  {
    // O `use` das fixtures do Playwright não é o `use` do React; a regra de
    // hooks casa pelo nome e acusa falso positivo.
    files: ['e2e/**/*.ts'],
    rules: { 'react-hooks/rules-of-hooks': 'off' },
  },
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    'public/mediapipe/**',
    'playwright-report/**',
    'test-results/**',
  ]),
])

export default eslintConfig
