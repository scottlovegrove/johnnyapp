import { useEffect, useState } from 'react'

const CAPTIONS = [
    'Turning back to the first page of the score…',
    'Rehearsing the earlier movements…',
    'Cueing the orchestra…',
    'Nearly at the bar where we left off…',
]

const NOTES = [
    { id: 'n1', glyph: '♩' },
    { id: 'n2', glyph: '♪' },
    { id: 'n3', glyph: '♫' },
    { id: 'n4', glyph: '♩' },
    { id: 'n5', glyph: '♪' },
    { id: 'n6', glyph: '♬' },
]

/**
 * Shown while the agent re-attaches to a session and replays its history. A
 * baton keeps time over a staff while the notes fill back in.
 */
export function Resuming() {
    const [caption, setCaption] = useState(0)

    useEffect(() => {
        const timer = setInterval(() => setCaption((c) => (c + 1) % CAPTIONS.length), 2400)
        return () => clearInterval(timer)
    }, [])

    return (
        <div
            role="status"
            aria-live="polite"
            className="flex flex-1 flex-col items-center justify-center gap-6 text-muted-foreground"
        >
            <svg viewBox="0 0 240 120" width="240" height="120" aria-hidden="true">
                {[0, 1, 2, 3, 4].map((i) => (
                    <line
                        key={`staff-${i}`}
                        x1="20"
                        x2="220"
                        y1={50 + i * 10}
                        y2={50 + i * 10}
                        stroke="currentColor"
                        strokeOpacity="0.25"
                    />
                ))}
                {NOTES.map((note, i) => (
                    <text
                        key={note.id}
                        className="note"
                        x={40 + i * 30}
                        y={78 + (i % 3) * -10}
                        fontSize="22"
                        fill="currentColor"
                        style={{ animationDelay: `${i * 0.5}s` }}
                    >
                        {note.glyph}
                    </text>
                ))}
                <g className="baton" style={{ transformBox: 'fill-box' }}>
                    <line
                        x1="120"
                        y1="118"
                        x2="120"
                        y2="18"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                    />
                    <circle cx="120" cy="18" r="3" fill="currentColor" />
                </g>
            </svg>
            <div className="text-center text-sm">
                <div className="font-medium text-foreground">Resuming session</div>
                <div className="mt-1 h-5">{CAPTIONS[caption]}</div>
            </div>
        </div>
    )
}
