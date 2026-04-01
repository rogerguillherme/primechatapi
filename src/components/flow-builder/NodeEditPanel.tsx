import { type Node } from "@xyflow/react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, Plus, Trash2 } from "lucide-react";

interface NodeEditPanelProps {
  node: Node;
  templates: any[];
  onUpdate: (data: Record<string, unknown>) => void;
  onClose: () => void;
}

export function NodeEditPanel({ node, templates, onUpdate, onClose }: NodeEditPanelProps) {
  const { type, data } = node;

  if (type === "trigger") return null;

  const typeLabels: Record<string, string> = {
    message: "Mensagem",
    delay: "Delay",
    condition: "Condição",
    interactive_buttons: "Mensagem com Botões",
    cta_url: "Botão com Link",
    no_response: "Sem Resposta",
  };

  return (
    <div className="absolute top-0 right-0 w-80 h-full bg-background border-l border-border shadow-xl overflow-y-auto">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="text-sm font-semibold">{typeLabels[type || ""] || "Editar"}</h3>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X size={16} />
        </button>
      </div>

      <div className="p-4 space-y-4">
        {type === "message" && (
          <>
            <div className="space-y-2">
              <Label className="text-xs">Template</Label>
              <Select
                value={(data.template_id as string) || "custom"}
                onValueChange={(v) => onUpdate({ template_id: v === "custom" ? null : v })}
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="custom">Mensagem personalizada</SelectItem>
                  {templates?.map((t: any) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name} {t.template_name ? `(${t.template_name})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {!data.template_id && (
              <div className="space-y-2">
                <Label className="text-xs">Mensagem</Label>
                <textarea
                  value={(data.custom_message as string) || ""}
                  onChange={(e) => onUpdate({ custom_message: e.target.value })}
                  placeholder="Digite a mensagem... (use {nome} para personalizar)"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[80px] resize-y focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  rows={3}
                />
              </div>
            )}
          </>
        )}

        {type === "delay" && (
          <div className="space-y-2">
            <Label className="text-xs">Aguardar (minutos)</Label>
            <Input
              type="number"
              min={1}
              value={(data.delay_minutes as number) || 60}
              onChange={(e) => onUpdate({ delay_minutes: parseInt(e.target.value) || 1 })}
              className="h-8 text-sm"
            />
            {((data.delay_minutes as number) || 0) >= 60 && (
              <p className="text-xs text-muted-foreground">
                = {Math.floor(((data.delay_minutes as number) || 0) / 60)}h
                {((data.delay_minutes as number) || 0) % 60 > 0
                  ? ` ${((data.delay_minutes as number) || 0) % 60}min`
                  : ""}
              </p>
            )}
          </div>
        )}

        {type === "condition" && (
          <div className="space-y-2">
            <Label className="text-xs">Texto do botão clicado (payload)</Label>
            <Input
              value={(data.trigger_value as string) || ""}
              onChange={(e) => onUpdate({ trigger_value: e.target.value })}
              placeholder="Ex: sim, quero_saber_mais"
              className="h-8 text-sm"
            />
            <p className="text-[11px] text-muted-foreground">
              O fluxo só avança se o lead clicar no botão com este payload.
            </p>
          </div>
        )}

        {type === "interactive_buttons" && (
          <>
            <div className="space-y-2">
              <Label className="text-xs">Texto da mensagem</Label>
              <textarea
                value={(data.custom_message as string) || ""}
                onChange={(e) => onUpdate({ custom_message: e.target.value })}
                placeholder="Mensagem acima dos botões..."
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[60px] resize-y focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                rows={2}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Botões (máx. 3)</Label>
              {((data.buttons as any[]) || []).map((btn: any, idx: number) => (
                <div key={btn.id} className="flex items-center gap-2">
                  <Input
                    value={btn.title}
                    onChange={(e) => {
                      const btns = [...((data.buttons as any[]) || [])];
                      btns[idx] = { ...btn, title: e.target.value };
                      onUpdate({ buttons: btns });
                    }}
                    placeholder={`Botão ${idx + 1}`}
                    className="h-8 text-sm"
                    maxLength={20}
                  />
                  {((data.buttons as any[]) || []).length > 1 && (
                    <Button
                      variant="ghost" size="icon" className="h-7 w-7 text-destructive shrink-0"
                      onClick={() => {
                        const btns = ((data.buttons as any[]) || []).filter((_: any, i: number) => i !== idx);
                        onUpdate({ buttons: btns });
                      }}
                    >
                      <Trash2 size={12} />
                    </Button>
                  )}
                </div>
              ))}
              {((data.buttons as any[]) || []).length < 3 && (
                <Button
                  variant="outline" size="sm" className="text-xs gap-1"
                  onClick={() => {
                    const btns = [...((data.buttons as any[]) || []), { id: crypto.randomUUID(), title: "" }];
                    onUpdate({ buttons: btns });
                  }}
                >
                  <Plus size={12} /> Adicionar botão
                </Button>
              )}
            </div>
          </>
        )}

        {type === "cta_url" && (
          <>
            <div className="space-y-2">
              <Label className="text-xs">Texto da mensagem</Label>
              <textarea
                value={(data.custom_message as string) || ""}
                onChange={(e) => onUpdate({ custom_message: e.target.value })}
                placeholder="Mensagem acima do botão..."
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[60px] resize-y focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                rows={2}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Texto do botão</Label>
              <Input
                value={((data.buttons as any[])?.[0]?.title as string) || ""}
                onChange={(e) => {
                  const btn = (data.buttons as any[])?.[0] || { id: crypto.randomUUID(), title: "", url: "" };
                  onUpdate({ buttons: [{ ...btn, title: e.target.value }] });
                }}
                placeholder="Ex: Acessar site"
                className="h-8 text-sm"
                maxLength={20}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">URL do link</Label>
              <Input
                value={((data.buttons as any[])?.[0]?.url as string) || ""}
                onChange={(e) => {
                  const btn = (data.buttons as any[])?.[0] || { id: crypto.randomUUID(), title: "Acessar site", url: "" };
                  onUpdate({ buttons: [{ ...btn, url: e.target.value }] });
                }}
                placeholder="https://exemplo.com"
                className="h-8 text-sm"
              />
            </div>
          </>
        )}

        {type === "no_response" && (
          <div className="space-y-2">
            <Label className="text-xs">Timeout (minutos)</Label>
            <Input
              type="number"
              min={1}
              value={(data.timeout_minutes as number) || 10}
              onChange={(e) => onUpdate({ timeout_minutes: parseInt(e.target.value) || 10 })}
              className="h-8 text-sm"
            />
            {((data.timeout_minutes as number) || 0) >= 60 && (
              <p className="text-xs text-muted-foreground">
                = {Math.floor(((data.timeout_minutes as number) || 0) / 60)}h
                {((data.timeout_minutes as number) || 0) % 60 > 0
                  ? ` ${((data.timeout_minutes as number) || 0) % 60}min`
                  : ""}
              </p>
            )}
            <p className="text-[11px] text-muted-foreground">
              Se o lead não clicar no botão/link anterior dentro deste tempo, o fluxo avança para o próximo passo.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
