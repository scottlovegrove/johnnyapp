import { useEffect, useMemo, useRef } from 'react'
import Markdown from 'react-markdown'
import { Brain, CheckCircle2, CircleDashed, Loader2, Wrench, XCircle } from 'lucide-react'
import type { SessionUpdate, TranscriptItem } from '@johnny/shared'
import type { ToolCall, ToolCallContent, ToolCallUpdate } from '@agentclientprotocol/sdk'
import { cn } from '@/lib/utils'

type ToolStatus = 'pending' | 'in_progress' | 'completed' | 'failed'

interface ToolBlock {
    kind: 'tool'
    id: string
    title: string
    detail: string | null
    status: ToolStatus
    output: string
}

/** A transcript flattened into renderable blocks; adjacent text chunks merge. */
type Block =
    | { kind: 'user'; id: string; text: string }
    | { kind: 'assistant'; id: string; text: string }
    | { kind: 'thought'; id: string; text: string }
    | { kind: 'tools'; id: string; tools: ToolBlock[] }
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

/**
 * The most specific thing we know about what the tool is acting on: a file
 * path from `locations`, else a command / path from the raw input.
 */
function toolDetail(u: ToolCall | ToolCallUpdate): string | null {
    const location = u.locations?.[0]?.path
    if (location) return location
    const input = u.rawInput
    if (input && typeof input === 'object') {
        for (const key of ['command', 'file_path', 'path', 'pattern', 'query']) {
            const value = (input as Record<string, unknown>)[key]
            if (typeof value === 'string' && value) return value
        }
    }
    return null
}

function buildBlocks(items: TranscriptItem[]): Block[] {
    const blocks: Block[] = []
    const tools = new Map<string, ToolBlock>()

    // Tool calls arrive as `tool_call` (sometimes more than once for the same
    // id as the agent fills in details) followed by `tool_call_update`s, so
    // every message for an id folds into one block. Consecutive tool blocks
    // are grouped so a burst of file reads is one collapsible row.
    const upsertTool = (u: ToolCall | ToolCallUpdate) => {
        const existing = tools.get(u.toolCallId)
        const detail = toolDetail(u)
        if (existing) {
            if (u.title) existing.title = u.title
            if (detail) existing.detail = detail
            if (u.status) existing.status = u.status
            if (u.content) existing.output = toolOutput(u.content)
            return
        }
        const block: ToolBlock = {
            kind: 'tool',
            id: u.toolCallId,
            title: u.title ?? 'Tool',
            detail,
            status: u.status ?? 'pending',
            output: toolOutput(u.content),
        }
        tools.set(u.toolCallId, block)
        const last = blocks[blocks.length - 1]
        if (last?.kind === 'tools') last.tools.push(block)
        else blocks.push({ kind: 'tools', id: u.toolCallId, tools: [block] })
    }

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
            case 'tool_call':
            case 'tool_call_update':
                upsertTool(u)
                break
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

function ToolRow({ tool }: { tool: ToolBlock }) {
    return (
        <details className="text-xs">
            <summary className="flex cursor-pointer items-center gap-2 px-2 py-1 hover:bg-accent/50">
                <Wrench className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="shrink-0 font-medium">{tool.title}</span>
                {tool.detail && (
                    <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">
                        {tool.detail}
                    </span>
                )}
                <span className="ml-auto shrink-0">{statusIcon[tool.status]}</span>
            </summary>
            {tool.output && (
                <pre className="max-h-64 overflow-auto border-t bg-muted px-2 py-1.5 font-mono">
                    {tool.output}
                </pre>
            )}
        </details>
    )
}

function ToolGroup({ tools }: { tools: ToolBlock[] }) {
    const [only] = tools
    if (tools.length === 1 && only) {
        return (
            <div className="rounded-md border">
                <ToolRow tool={only} />
            </div>
        )
    }
    const running = tools.filter((t) => t.status === 'pending' || t.status === 'in_progress')
    const failed = tools.filter((t) => t.status === 'failed')
    const summary = [
        `${tools.length} tool calls`,
        running.length > 0 && `${running.length} running`,
        failed.length > 0 && `${failed.length} failed`,
    ]
        .filter(Boolean)
        .join(' · ')
    return (
        <details className="rounded-md border text-xs">
            <summary className="flex cursor-pointer items-center gap-2 px-2 py-1.5">
                <Wrench className="size-3.5 text-muted-foreground" />
                <span className="flex-1">{summary}</span>
                {running.length > 0 ? (
                    <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                ) : failed.length > 0 ? (
                    <XCircle className="size-3.5 text-destructive" />
                ) : (
                    <CheckCircle2 className="size-3.5 text-emerald-500" />
                )}
            </summary>
            <div className="divide-y border-t">
                {tools.map((t) => (
                    <ToolRow key={t.id} tool={t} />
                ))}
            </div>
        </details>
    )
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
                        case 'tools':
                            return <ToolGroup key={b.id} tools={b.tools} />
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
