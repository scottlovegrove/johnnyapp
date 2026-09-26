import { defineConfig } from 'vitest/config'

/** Base Vitest configuration; packages extend it with mergeConfig. */
export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        clearMocks: true,
        testTimeout: 30000,
        exclude: ['dist/**', 'node_modules/**'],
    },
})
