import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, mergeConfig } from 'vitest/config'
import baseConfig from '../../vitest.config.base'

export default mergeConfig(
    baseConfig,
    defineConfig({
        plugins: [react()],
        resolve: {
            alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
        },
        test: {
            environment: 'jsdom',
            include: ['src/**/*.test.{ts,tsx}'],
            setupFiles: ['./src/test/setup.ts'],
        },
    }),
)
