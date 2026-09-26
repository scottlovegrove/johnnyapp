import { LoginAttemptsService } from './login-attempts.service'

describe('LoginAttemptsService', () => {
    it('locks an address out after five failures inside the window and forgives it after', () => {
        const attempts = new LoginAttemptsService()
        const start = 1_000_000
        for (let i = 0; i < 4; i++) attempts.failed('1.2.3.4', start + i)
        expect(attempts.allowed('1.2.3.4', start + 10)).toBe(true)

        attempts.failed('1.2.3.4', start + 5)
        expect(attempts.allowed('1.2.3.4', start + 10)).toBe(false)
        expect(attempts.allowed('5.6.7.8', start + 10)).toBe(true)

        expect(attempts.allowed('1.2.3.4', start + 15 * 60 * 1000 + 6)).toBe(true)
    })

    it('a successful login clears the count', () => {
        const attempts = new LoginAttemptsService()
        for (let i = 0; i < 5; i++) attempts.failed('1.2.3.4')
        expect(attempts.allowed('1.2.3.4')).toBe(false)
        attempts.reset('1.2.3.4')
        expect(attempts.allowed('1.2.3.4')).toBe(true)
    })
})
