import { ModuleKind, ScriptTarget, transpileModule } from 'typescript'
import { defineConfig, mergeConfig } from 'vitest/config'
import baseConfig from '../../vitest.config.base'

/**
 * esbuild does not emit decorator metadata, which Nest's dependency injection
 * relies on, so TypeScript sources are transpiled with tsc instead.
 */
function tsDecorators() {
    return {
        name: 'ts-decorators-metadata',
        enforce: 'pre' as const,
        transform(code: string, id: string) {
            if (!id.endsWith('.ts')) return null
            const result = transpileModule(code, {
                fileName: id,
                compilerOptions: {
                    module: ModuleKind.ESNext,
                    target: ScriptTarget.ES2022,
                    experimentalDecorators: true,
                    emitDecoratorMetadata: true,
                    sourceMap: true,
                },
            })
            return {
                code: result.outputText,
                map: result.sourceMapText ? JSON.parse(result.sourceMapText) : null,
            }
        },
    }
}

export default mergeConfig(
    baseConfig,
    defineConfig({
        plugins: [tsDecorators()],
        test: {
            include: ['src/**/*.spec.ts'],
            setupFiles: ['test/vitest-setup.ts'],
        },
    }),
)
