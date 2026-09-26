import { parseArgs } from 'node:util'

export interface AppOptions {
    port: number
    host: string
    /** Skip opening the browser after the server starts. */
    noOpen: boolean
}

export const APP_OPTIONS = Symbol('APP_OPTIONS')

/** Command-line flags, falling back to environment variables, then defaults. */
export function parseOptions(argv = process.argv.slice(2)): AppOptions {
    const { values } = parseArgs({
        args: argv,
        options: {
            port: { type: 'string', short: 'p', default: process.env.PORT ?? '56469' },
            host: { type: 'string', default: process.env.HOST ?? '127.0.0.1' },
            'no-open': { type: 'boolean', default: false },
        },
    })
    return {
        port: Number(values.port),
        host: values.host ?? '127.0.0.1',
        noOpen: values['no-open'] || process.env.JOHNNY_DEV !== undefined,
    }
}
