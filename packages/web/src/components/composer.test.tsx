import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Composer } from './composer'

describe('Composer', () => {
    it('sends the trimmed text on Enter and clears the box', async () => {
        const user = userEvent.setup()
        const onSend = vi.fn()
        render(<Composer busy={false} onSend={onSend} onCancel={vi.fn()} />)

        const box = screen.getByRole('textbox')
        await user.type(box, '  hello there  {Enter}')

        expect(onSend).toHaveBeenCalledWith('hello there')
        expect(box).toHaveValue('')
    })

    it('inserts a newline on Shift+Enter instead of sending', async () => {
        const user = userEvent.setup()
        const onSend = vi.fn()
        render(<Composer busy={false} onSend={onSend} onCancel={vi.fn()} />)

        await user.type(screen.getByRole('textbox'), 'line one{Shift>}{Enter}{/Shift}line two')

        expect(onSend).not.toHaveBeenCalled()
        expect(screen.getByRole('textbox')).toHaveValue('line one\nline two')
    })

    it('offers cancel instead of send while the agent is busy', async () => {
        const user = userEvent.setup()
        const onSend = vi.fn()
        const onCancel = vi.fn()
        render(<Composer busy onSend={onSend} onCancel={onCancel} />)

        expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument()
        await user.type(screen.getByRole('textbox'), 'ignored{Enter}')
        expect(onSend).not.toHaveBeenCalled()

        await user.click(screen.getByRole('button', { name: 'Cancel' }))
        expect(onCancel).toHaveBeenCalled()
    })
})
