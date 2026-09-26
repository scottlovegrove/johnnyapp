import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PermissionRequest } from '@johnny/shared'
import { PermissionBar } from './permission-bar'

const request: PermissionRequest = {
    requestId: 'r1',
    sessionId: 's1',
    toolCall: { toolCallId: 'c1', title: 'Run command', rawInput: { command: 'rm -rf dist' } },
    options: [
        { optionId: 'always', name: 'Always allow', kind: 'allow_always' },
        { optionId: 'once', name: 'Allow', kind: 'allow_once' },
        { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
    ],
}

describe('PermissionBar', () => {
    it('shows what is being asked, including the command, and every option', () => {
        render(<PermissionBar request={request} onChoose={vi.fn()} />)
        expect(screen.getByText('Run command')).toBeInTheDocument()
        expect(screen.getByText('rm -rf dist')).toBeInTheDocument()
        for (const name of ['Always allow', 'Allow', 'Reject']) {
            expect(screen.getByRole('button', { name })).toBeInTheDocument()
        }
    })

    it('reports the chosen option id, or null to cancel the turn', async () => {
        const user = userEvent.setup()
        const onChoose = vi.fn()
        render(<PermissionBar request={request} onChoose={onChoose} />)

        await user.click(screen.getByRole('button', { name: 'Allow' }))
        expect(onChoose).toHaveBeenLastCalledWith('once')

        await user.click(screen.getByRole('button', { name: 'Cancel turn' }))
        expect(onChoose).toHaveBeenLastCalledWith(null)
    })
})
