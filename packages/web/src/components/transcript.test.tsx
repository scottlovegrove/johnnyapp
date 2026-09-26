import { render, screen, within } from '@testing-library/react'
import type { SessionUpdate, TranscriptItem } from '@johnny/shared'
import { Transcript } from './transcript'

let seq = 0
function update(update: SessionUpdate): TranscriptItem {
    return { kind: 'update', id: `u${++seq}`, update, at: '2026-01-01T00:00:00Z' }
}
function chunk(text: string): TranscriptItem {
    return update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } })
}

describe('Transcript', () => {
    it('merges streamed text chunks into one markdown block', () => {
        render(<Transcript items={[chunk('Hello '), chunk('**world**')]} busy={false} />)
        const paragraph = screen.getByText(/Hello/)
        expect(paragraph).toHaveTextContent('Hello world')
        expect(within(paragraph).getByText('world').tagName).toBe('STRONG')
    })

    it('folds repeated tool_call and tool_call_update messages for one id into a single row', () => {
        const items: TranscriptItem[] = [
            update({
                sessionUpdate: 'tool_call',
                toolCallId: 'c1',
                title: 'Read File',
                status: 'pending',
            }),
            update({
                sessionUpdate: 'tool_call',
                toolCallId: 'c1',
                title: 'Read File',
                status: 'pending',
                locations: [{ path: '/repo/package.json' }],
            }),
            update({
                sessionUpdate: 'tool_call_update',
                toolCallId: 'c1',
                status: 'completed',
                content: [{ type: 'content', content: { type: 'text', text: '{ "name": "x" }' } }],
            }),
        ]
        render(<Transcript items={items} busy={false} />)

        expect(screen.getAllByText('Read File')).toHaveLength(1)
        expect(screen.getByText('/repo/package.json')).toBeInTheDocument()
        expect(screen.getByText('{ "name": "x" }')).toBeInTheDocument()
        expect(document.querySelector('.animate-spin')).toBeNull()
    })

    it('groups consecutive tool calls into one summary row', () => {
        const items: TranscriptItem[] = [
            update({
                sessionUpdate: 'tool_call',
                toolCallId: 'c1',
                title: 'Read File',
                status: 'completed',
            }),
            update({
                sessionUpdate: 'tool_call',
                toolCallId: 'c2',
                title: 'Terminal',
                status: 'in_progress',
                rawInput: { command: 'npm test' },
            }),
            update({
                sessionUpdate: 'tool_call',
                toolCallId: 'c3',
                title: 'Read File',
                status: 'failed',
            }),
            chunk('done'),
        ]
        render(<Transcript items={items} busy={false} />)

        expect(screen.getByText('3 tool calls · 1 running · 1 failed')).toBeInTheDocument()
        expect(screen.getByText('npm test')).toBeInTheDocument()
    })

    it('renders user messages, errors and non-normal turn ends', () => {
        const items: TranscriptItem[] = [
            { kind: 'user', id: 'u', text: 'do it', at: '' },
            { kind: 'error', id: 'e', message: 'agent blew up', at: '' },
            { kind: 'turn_end', id: 't', stopReason: 'cancelled', at: '' },
        ]
        render(<Transcript items={items} busy={false} />)
        expect(screen.getByText('do it')).toBeInTheDocument()
        expect(screen.getByText('agent blew up')).toBeInTheDocument()
        expect(screen.getByText('turn ended: cancelled')).toBeInTheDocument()
    })
})
