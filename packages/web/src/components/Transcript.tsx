import { useEffect, useMemo, useRef } from 'react'
import Markdown from 'react-markdown'
import { Brain, CheckCircle2, CircleDashed, Loader2, Wrench, XCircle } from 'lucide-react'
import type { SessionUpdate, TranscriptItem } from '@johnny/shared'
import type { ToolCallContent } from '@agentclientprotocol/sdk'
import { cn } from '@/lib/utils'

type ToolStatus = 'pending' | 'in_progress' | 'completed' | 'failed'

/** A transcript flattened into renderable blocks; adjacent text chunks merge. */
type Block =
    | { kind: 'user'; id: string; text: string }
    | { kind: 'assistant'; id: string; text: string }
    | { kind: 'thought'; id: string; text: string }
    | { kind: 'tool'; id: string; title: string; status: ToolStatus; output: string }
    | { kind: 'turn_end'; id: string; stopReason: string }
    | { kind: 'error'; id: string; message: string }

function chunkText(update: SessionUpdate & { content: { type: string } }): string {
    return update.content.type === 'text'
        ? (update.content as { text: string }).text
        : `[${update.content.type}]`
}

function toolOutput(content: ToolCallContent[] | null | undefined): string {
    if (!content) return ''
    return content
        .map((c) => {
            if (c.type === 'content')
                return c.content.type === 'text' ? c.content.text : `[${c.content.type}]`
            if (c.type === 'diff') return `--- ${c.path}\n${c.newText}`
            return ''
        })
        .filter(Boolean)
        .join('\n')
}

function buildBlocks(items: TranscriptItem[]): Block[] {
    const blocks: Block[] = []
    const tools = new Map<string, Extract<Block, { kind: 'tool' }>>()

    for (const item of items) {
        if (item.kind === 'user') {
            blocks.push({ kind: 'user', id: item.id, text: item.text })
            continue
        }
        if (item.kind === 'turn_end') {
            blocks.push({ kind: 'turn_end', id: item.id, stopReason: item.stopReason })
            continue
        }
        if (item.kind === 'error') {
            blocks.push({ kind: 'error', id: item.id, message: item.message })
            continue
        }

        const u = item.update
        const last = blocks[blocks.length - 1]
        switch (u.sessionUpdate) {
            case 'agent_message_chunk':
                if (last?.kind === 'assistant') last.text += chunkText(u)
                else blocks.push({ kind: 'assistant', id: item.id, text: chunkText(u) })
                break
            case 'agent_thought_chunk':
                if (last?.kind === 'thought') last.text += chunkText(u)
                else blocks.push({ kind: 'thought', id: item.id, text: chunkText(u) })
                break
            case 'tool_call': {
                const block: Extract<Block, { kind: 'tool' }> = {
                    kind: 'tool',
                    id: u.toolCallId,
                    title: u.title,
                    status: u.status ?? 'pending',
                    output: toolOutput(u.content),
                }
                tools.set(u.toolCallId, block)
                blocks.push(block)
                break
            }
            case 'tool_call_update': {
                const block = tools.get(u.toolCallId)
                if (!block) break
                if (u.title) block.title = u.title
                if (u.status) block.status = u.status
                if (u.content) block.output = toolOutput(u.content)
                break
            }
            default:
                break
        }
    }
    return blocks
}

const statusIcon: Record<ToolStatus, React.ReactNode> = {
    pending: <CircleDashed className="size-3.5 text-muted-foreground" />,
    in_progress: <Loader2 className="size-3.5 animate-spin text-muted-foreground" />,
    completed: <CheckCircle2 className="size-3.5 text-emerald-500" />,
    failed: <XCircle className="size-3.5 text-destructive" />,
}

export function Transcript({ items, busy }: { items: TranscriptItem[]; busy: boolean }) {
    const blocks = useMemo(() => buildBlocks(items), [items])
    const bottom = useRef<HTMLDivElement>(null)

    useEffect(() => {
        bottom.current?.scrollIntoView({ block: 'end' })
    }, [blocks])

    return (
        <div className="flex-1 overflow-y-auto px-4 py-4">
            <div className="mx-auto flex max-w-3xl flex-col gap-3">
                {blocks.map((b) => {
                    switch (b.kind) {
                        case 'user':
                            return (
                                <div
                                    key={b.id}
                                    className="self-end rounded-xl bg-primary px-4 py-2 text-sm text-primary-foreground whitespace-pre-wrap max-w-[80%]"
                                >
                                    {b.text}
                                </div>
                            )
                        case 'assistant':
                            return (
                                <div key={b.id} className="prose-chat text-sm">
                                    <Markdown>{b.text}</Markdown>
                                </div>
                            )
                        case 'thought':
                            return (
                                <details key={b.id} className="text-xs text-muted-foreground">
                                    <summary className="flex cursor-pointer items-center gap-1">
                                        <Brain className="size-3" /> Thinking
                                    </summary>
                                    <div className="mt-1 whitespace-pre-wrap pl-4">{b.text}</div>
                                </details>
                            )
                        case 'tool':
                            return (
                                <details key={b.id} className="rounded-md border text-xs">
                                    <summary className="flex cursor-pointer items-center gap-2 px-2 py-1.5">
                                        <Wrench className="size-3.5 text-muted-foreground" />
                                        <span className="flex-1 truncate font-mono">{b.title}</span>
                                        {statusIcon[b.status]}
                                    </summary>
                                    {b.output && (
                                        <pre className="max-h-64 overflow-auto border-t bg-muted px-2 py-1.5 font-mono">
                                            {b.output}
                                        </pre>
                                    )}
                                </details>
                            )
                        case 'turn_end':
                            return b.stopReason === 'end_turn' ? null : (
                                <div
                                    key={b.id}
                                    className="text-center text-xs text-muted-foreground"
                                >
                                    turn ended: {b.stopReason}
                                </div>
                            )
                        case 'error':
                            return (
                                <div
                                    key={b.id}
                                    className={cn(
                                        'rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive',
                                    )}
                                >
                                    {b.message}
                                </div>
                            )
                    }
                })}
                {busy && blocks[blocks.length - 1]?.kind === 'user' && (
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                )}
                <div ref={bottom} />
            </div>
        </div>
    )
}
