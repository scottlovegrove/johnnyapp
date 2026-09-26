import { ShieldAlert } from "lucide-react";
import type { PermissionRequest } from "@johnny/shared";
import { Button } from "./ui/button";

interface Props {
  request: PermissionRequest;
  onChoose(optionId: string | null): void;
}

export function PermissionBar({ request, onChoose }: Props) {
  const { toolCall, options } = request;
  const command = toolCall.rawInput && typeof toolCall.rawInput === "object" && "command" in toolCall.rawInput
    ? String((toolCall.rawInput as { command: unknown }).command)
    : null;

  return (
    <div className="border-t border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
      <div className="flex items-start gap-2">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />
        <div className="min-w-0 flex-1">
          <div className="font-medium">{toolCall.title ?? "Permission required"}</div>
          {command && <pre className="mt-1 overflow-x-auto rounded bg-muted px-2 py-1 font-mono text-xs">{command}</pre>}
          <div className="mt-2 flex flex-wrap gap-2">
            {options.map((o) => (
              <Button
                key={o.optionId}
                size="sm"
                variant={o.kind.startsWith("allow") ? "default" : "outline"}
                onClick={() => onChoose(o.optionId)}
              >
                {o.name}
              </Button>
            ))}
            <Button size="sm" variant="ghost" onClick={() => onChoose(null)}>
              Cancel turn
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
