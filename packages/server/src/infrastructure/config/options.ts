import { parseArgs } from 'node:util'

export type AuthMode = 'token' | 'proxy'

export interface AppOptions {
    /** `serve` runs the server; `token` prints (or rotates) the access token and exits. */
    command: 'serve' | 'token'
    port: number
    host: string
    /** Skip opening the browser after the server starts. */
    noOpen: boolean
    /**
     * `token`: every request needs the access token (login page or cookie).
     * `proxy`: no check at all; only for when a reverse proxy already
     * authenticates the user before traffic reaches Johnny.
     */
    auth: AuthMode
    /** With the `token` command: replace the stored token with a new one. */
    rotate: boolean
}

export const APP_OPTIONS = Symbol('APP_OPTIONS')

function parseAuthMode(value: string | undefined): AuthMode {
    if (value === undefined || value === 'token') return 'token'
    if (value === 'proxy') return 'proxy'
    throw new Error(`Unknown auth mode "${value}" (expected "token" or "proxy")`)
}

/** Command-line flags, falling back to environment variables, then defaults. */
export function parseOptions(argv = process.argv.slice(2)): AppOptions {
    const { values, positionals } = parseArgs({
        args: argv,
        allowPositionals: true,
        options: {
            port: { type: 'string', short: 'p', default: process.env.PORT ?? '56469' },
            host: { type: 'string', default: process.env.HOST ?? '127.0.0.1' },
            auth: { type: 'string', default: process.env.JOHNNY_AUTH ?? 'token' },
            'no-open': { type: 'boolean', default: false },
            rotate: { type: 'boolean', default: false },
        },
    })
    const [command = 'serve'] = positionals
    if (command !== 'serve' && command !== 'token') {
        throw new Error(`Unknown command "${command}" (expected "serve" or "token")`)
    }
    return {
        command,
        port: Number(values.port),
        host: values.host ?? '127.0.0.1',
        noOpen: values['no-open'] || process.env.JOHNNY_DEV !== undefined,
        auth: parseAuthMode(values.auth),
        rotate: values.rotate,
    }
}
