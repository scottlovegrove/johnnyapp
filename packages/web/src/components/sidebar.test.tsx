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
    busy: false,
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

    it('adds a project from the typed path', async () => {
        const user = userEvent.setup()
        const props = renderSidebar()

        await user.click(screen.getByRole('button', { name: /Add project/ }))
        await user.type(screen.getByPlaceholderText(/path/), '~/other{Enter}')

        expect(props.onAddProject).toHaveBeenCalledWith('~/other')
    })
})
