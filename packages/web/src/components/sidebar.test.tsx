import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AgentInfo, Project, SessionInfo } from '@johnny/shared'
import { Sidebar } from './sidebar'

const agents: AgentInfo[] = [{ id: 'claude-code', name: 'Claude Code', available: true }]
const project: Project = { id: 'p1', name: 'johnny', path: '/home/me/johnny', createdAt: '' }
const session: SessionInfo = {
    id: 's1',
    agentId: 'claude-code',
    projectId: 'p1',
    cwd: project.path,
    title: 'Session 10:00',
    createdAt: '',
    lastActiveAt: '2026-01-01T10:00:00.000Z',
    origin: 'johnny',
    busy: false,
    resuming: false,
}
const imported: SessionInfo = {
    ...session,
    id: 's2',
    title: 'Started in the terminal',
    lastActiveAt: '2026-01-02T10:00:00.000Z',
    origin: 'agent',
}

function renderSidebar(overrides: Partial<Parameters<typeof Sidebar>[0]> = {}) {
    const props = {
        agents,
        projects: [project],
        sessions: [session],
        activeId: null,
        status: 'open' as const,
        onSelect: vi.fn(),
        onCreateSession: vi.fn(async () => {}),
        onImportSessions: vi.fn(async () => {}),
        onRemoveSession: vi.fn(async () => {}),
        onAddProject: vi.fn(async () => {}),
        onRemoveProject: vi.fn(async () => {}),
        ...overrides,
    }
    render(<Sidebar {...props} />)
    return props
}

describe('Sidebar', () => {
    beforeEach(() => localStorage.clear())

    it('lists sessions under their project and selects one on click', async () => {
        const user = userEvent.setup()
        const props = renderSidebar()

        await user.click(screen.getByRole('button', { name: 'Session 10:00' }))
        expect(props.onSelect).toHaveBeenCalledWith('s1')
    })

    it('collapses a project to just its name and remembers that', async () => {
        const user = userEvent.setup()
        renderSidebar()

        expect(screen.getByText('/home/me/johnny')).toBeInTheDocument()
        await user.click(screen.getByRole('button', { name: /johnny/, expanded: true }))

        expect(screen.queryByText('/home/me/johnny')).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Session 10:00' })).not.toBeInTheDocument()
        expect(JSON.parse(localStorage.getItem('johnny.sidebar.collapsed') ?? '{}')).toEqual({
            p1: true,
        })
    })

    it('starts a session in the project with the selected agent', async () => {
        const user = userEvent.setup()
        const props = renderSidebar()

        await user.click(screen.getByRole('button', { name: 'New session' }))
        expect(props.onCreateSession).toHaveBeenCalledWith('claude-code', 'p1')
    })

    it('imports sessions from the agent and shows them newest first with a marker', async () => {
        const user = userEvent.setup()
        const props = renderSidebar({ sessions: [session, imported] })

        await user.click(screen.getByRole('button', { name: 'Import sessions from agent' }))
        expect(props.onImportSessions).toHaveBeenCalledWith('claude-code', 'p1')

        const rows = screen.getAllByRole('button', {
            name: /Session 10:00|Started in the terminal/,
        })
        expect(rows.map((r) => r.textContent)).toEqual(['Started in the terminal', 'Session 10:00'])
        expect(screen.getByLabelText('Started outside Johnny')).toBeInTheDocument()

        const [removeNewest] = screen.getAllByRole('button', { name: 'Remove session' })
        if (!removeNewest) throw new Error('expected a remove button')
        await user.click(removeNewest)
        expect(props.onRemoveSession).toHaveBeenCalledWith('s2')
    })

    it('adds a project from the typed path', async () => {
        const user = userEvent.setup()
        const props = renderSidebar()

        await user.click(screen.getByRole('button', { name: /Add project/ }))
        await user.type(screen.getByPlaceholderText(/path/), '~/other{Enter}')

        expect(props.onAddProject).toHaveBeenCalledWith('~/other')
    })
})
