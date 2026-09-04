import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { MessageCircle } from "lucide-react";
import { formatAccountName } from "@/lib/utils";

interface Account {
  id: string;
  name: string;
  is_default: boolean;
  phone_number_id: string;
  display_phone_number?: string | null;
}

interface AccountSelectorProps {
  accounts: Account[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  mode?: "single" | "multi";
  compact?: boolean;
  label?: string;
}

function phoneLabel(a: Account) {
  return a.display_phone_number || a.phone_number_id;
}

export function AccountSelector({ accounts, selectedIds, onToggle, mode = "single", compact = false, label = "Conta" }: AccountSelectorProps) {
  if (!accounts || accounts.length <= 1) return null;

  if (compact) {
    return (
      <div className="space-y-1.5">
        <Label className="text-xs">{label}</Label>
        <select
          value={mode === "single" ? (Array.from(selectedIds)[0] || "") : ""}
          onChange={(e) => {
            if (mode === "single") {
              // Clear all and select new
              for (const id of selectedIds) onToggle(id);
              if (e.target.value) onToggle(e.target.value);
            }
          }}
          className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {formatAccountName(a)} {a.is_default ? "(padrão)" : ""}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label>{label}{mode === "multi" ? " (selecione uma ou mais)" : ""}</Label>
      <div className="space-y-1.5">
        {accounts.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => {
              if (mode === "single") {
                // Clear all and select new
                for (const id of selectedIds) {
                  if (id !== a.id) onToggle(id);
                }
                if (!selectedIds.has(a.id)) onToggle(a.id);
              } else {
                onToggle(a.id);
              }
            }}
            className="w-full flex items-center gap-3 p-2.5 rounded-lg border border-border hover:bg-accent/40 transition-colors text-left"
          >
            {mode === "multi" && (
              <Checkbox checked={selectedIds.has(a.id)} className="pointer-events-none" />
            )}
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
              <MessageCircle size={14} className="text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-medium truncate">{formatAccountName(a)}</span>
                {a.is_default && <Badge variant="default" className="text-[10px] px-1.5 py-0">Padrão</Badge>}
              </div>
              <p className="text-xs text-muted-foreground tabular-nums truncate">{phoneLabel(a)}</p>
            </div>
            {mode === "single" && (
              <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${selectedIds.has(a.id) ? "border-primary bg-primary" : "border-muted-foreground/40"}`}>
                {selectedIds.has(a.id) && <div className="w-2 h-2 rounded-full bg-primary-foreground" />}
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
