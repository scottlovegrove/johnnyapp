import { parseOptions } from './options'

describe('parseOptions', () => {
    it('defaults to serving with token auth on the loopback port', () => {
        expect(parseOptions([])).toMatchObject({
            command: 'serve',
            port: 56469,
            host: '127.0.0.1',
            auth: 'token',
            rotate: false,
        })
    })

    it('parses the token command, proxy auth and flags', () => {
        expect(parseOptions(['token', '--rotate'])).toMatchObject({
            command: 'token',
            rotate: true,
        })
        expect(parseOptions(['--auth', 'proxy', '--host', '0.0.0.0', '-p', '80'])).toMatchObject({
            auth: 'proxy',
            host: '0.0.0.0',
            port: 80,
        })
    })

    it('rejects unknown commands and auth modes', () => {
        expect(() => parseOptions(['dance'])).toThrow('Unknown command')
        expect(() => parseOptions(['--auth', 'magic'])).toThrow('Unknown auth mode')
    })
})
