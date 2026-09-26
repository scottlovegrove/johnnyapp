import { useCallback, useEffect, useState } from 'react'

const SESSION_PATH = /^\/sessions\/([^/]+)\/?$/

export function sessionIdFromPath(pathname: string = location.pathname): string | null {
    const match = SESSION_PATH.exec(pathname)
    return match?.[1] ? decodeURIComponent(match[1]) : null
}

export function pathForSession(id: string | null): string {
    return id ? `/sessions/${encodeURIComponent(id)}` : '/'
}

/**
 * The active session id, mirrored in the URL so a refresh or a shared link
 * reopens the same session and the back button walks through them.
 */
export function useSessionRoute(): [string | null, (id: string | null) => void] {
    const [id, setId] = useState<string | null>(() => sessionIdFromPath())

    useEffect(() => {
        const onPopState = () => setId(sessionIdFromPath())
        window.addEventListener('popstate', onPopState)
        return () => window.removeEventListener('popstate', onPopState)
    }, [])

    const navigate = useCallback((next: string | null) => {
        const path = pathForSession(next)
        if (location.pathname !== path) history.pushState(null, '', path)
        setId(next)
    }, [])

    return [id, navigate]
}
