import { useState } from "react";
import { SendHorizontal, Square } from "lucide-react";
import { Button } from "./ui/button";

interface Props {
  busy: boolean;
  onSend(text: string): void;
  onCancel(): void;
}

export function Composer({ busy, onSend, onCancel }: Props) {
  const [text, setText] = useState("");

  function send() {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    onSend(trimmed);
    setText("");
  }

  return (
    <div className="border-t p-3">
      <div className="flex items-end gap-2">
        <textarea
          className="min-h-[2.5rem] max-h-48 flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-ring outline-none"
          rows={Math.min(6, text.split("\n").length)}
          placeholder={busy ? "Agent is working…" : "Message the agent (Enter to send, Shift+Enter for newline)"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        {busy ? (
          <Button variant="destructive" size="icon" onClick={onCancel} title="Cancel">
            <Square />
          </Button>
        ) : (
          <Button size="icon" onClick={send} disabled={!text.trim()} title="Send">
            <SendHorizontal />
          </Button>
        )}
      </div>
    </div>
  );
}
