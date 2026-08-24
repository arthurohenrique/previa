import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Espelha o "paths" do tsconfig ("@/*" -> "./src/*").
    alias: { '@': path.resolve(__dirname, 'src') },
  },
})
