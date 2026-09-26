import { act, renderHook } from '@testing-library/react'
import { pathForSession, sessionIdFromPath, useSessionRoute } from './session-route'

describe('session route', () => {
    beforeEach(() => history.replaceState(null, '', '/'))

    it('maps between session ids and paths', () => {
        expect(sessionIdFromPath('/')).toBeNull()
        expect(sessionIdFromPath('/sessions/abc-123')).toBe('abc-123')
        expect(sessionIdFromPath('/sessions/a%20b/')).toBe('a b')
        expect(pathForSession('abc-123')).toBe('/sessions/abc-123')
        expect(pathForSession(null)).toBe('/')
    })

    it('starts from the URL, pushes on navigation and follows the back button', () => {
        history.replaceState(null, '', '/sessions/first')
        const { result } = renderHook(() => useSessionRoute())
        expect(result.current[0]).toBe('first')

        act(() => result.current[1]('second'))
        expect(result.current[0]).toBe('second')
        expect(location.pathname).toBe('/sessions/second')

        act(() => {
            history.back()
            // jsdom updates the location synchronously but only fires
            // popstate asynchronously; dispatch it the way the browser would.
            history.replaceState(null, '', '/sessions/first')
            window.dispatchEvent(new PopStateEvent('popstate'))
        })
        expect(result.current[0]).toBe('first')

        act(() => result.current[1](null))
        expect(location.pathname).toBe('/')
        expect(result.current[0]).toBeNull()
    })
})
