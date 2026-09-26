import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'

process.env.TZ = 'UTC'

// jsdom doesn't implement scrollIntoView; the transcript scrolls to its end.
if (!window.HTMLElement.prototype.scrollIntoView) {
    window.HTMLElement.prototype.scrollIntoView = vi.fn()
}
