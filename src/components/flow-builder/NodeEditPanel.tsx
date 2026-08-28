import { type Node } from "@xyflow/react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, Plus, Trash2, Upload, Image as ImageIcon, Loader2, FileText, Video as VideoIcon, Mic } from "lucide-react";
import { useAiAgents } from "@/hooks/use-ai-agents";
import { useChatLabels } from "@/hooks/use-chat-labels";
import { AudioRecorder } from "@/components/AudioRecorder";
import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface NodeEditPanelProps {
  node: Node;
  templates: any[];
  onUpdate: (data: Record<string, unknown>) => void;
  onClose: () => void;
  variationEnabled?: boolean;
}

export function NodeEditPanel({ node, templates, onUpdate, onClose, variationEnabled }: NodeEditPanelProps) {
  const { type, data } = node;

  if (type === "trigger") return null;

  const typeLabels: Record<string, string> = {
    message: "Mensagem",
    delay: "Delay",
    condition: "Condição",
    interactive_buttons: "Mensagem com Botões",
    cta_url: "Botão com Link",
    no_response: "Sem Resposta",
    ai_agent: "Agente IA",
    blacklist: "Blacklist",
    tag: "Etiqueta",
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
              <ImageUploadField
                mediaUrl={(data.media_url as string) || null}
                mediaType={(data.media_type as string) || null}
                onChange={(url) =>
                  onUpdate({ media_url: url, media_type: url ? "image" : null })
                }
              />
            )}
            {!data.template_id && (
              <DocumentUploadField
                mediaUrl={(data.media_url as string) || null}
                mediaType={(data.media_type as string) || null}
                fileName={(data.file_name as string) || null}
                onChange={(url) =>
                  onUpdate({ media_url: url, media_type: url ? "document" : null })
                }
                onFileNameChange={(name) => onUpdate({ file_name: name })}
              />
            )}
            {!data.template_id && (
              <VideoUploadField
                mediaUrl={(data.media_url as string) || null}
                mediaType={(data.media_type as string) || null}
                onChange={(url) =>
                  onUpdate({ media_url: url, media_type: url ? "video" : null })
                }
              />
            )}
            {!data.template_id && (
              <AudioUploadField
                mediaUrl={(data.media_url as string) || null}
                mediaType={(data.media_type as string) || null}
                onChange={(url) =>
                  onUpdate({ media_url: url, media_type: url ? "audio" : null, file_name: null })
                }
              />
            )}
            {!data.template_id && (
              <div className="space-y-2">
                <Label className="text-xs">
                  {data.media_url && data.media_type !== "document" ? "Legenda (opcional)" : "Mensagem"}
                </Label>
                <textarea
                  value={(data.custom_message as string) || ""}
                  onChange={(e) => onUpdate({ custom_message: e.target.value })}
                  placeholder={
                    data.media_url && data.media_type !== "document"
                      ? "Texto que aparecerá abaixo da mídia..."
                      : "Digite a mensagem... (use {nome} para personalizar)"
                  }
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[80px] resize-y focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  rows={3}
                />
              </div>
            )}
            {variationEnabled && !data.template_id && (
              <MessageVariationsField
                variations={(data.message_variations as string[]) || []}
                onChange={(v) => onUpdate({ message_variations: v })}
              />
            )}
            {data.template_id && (
              <TemplateVariationsField
                mainTemplateId={data.template_id as string}
                variations={(data.template_variations as string[]) || []}
                templates={templates}
                onChange={(v) => onUpdate({ template_variations: v })}
              />
            )}
          </>
        )}

        {type === "delay" && (
          <div className="space-y-2">
            <Label className="text-xs">Tempo de espera</Label>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Input
                  type="number"
                  min={0}
                  value={(data.delay_minutes as number) ?? 0}
                  onChange={(e) =>
                    onUpdate({ delay_minutes: Math.max(0, parseInt(e.target.value) || 0) })
                  }
                  className="h-8 text-sm"
                />
                <p className="text-[11px] text-muted-foreground">minutos</p>
              </div>
              <div className="space-y-1">
                <Input
                  type="number"
                  min={0}
                  max={59}
                  value={(data.delay_min_seconds as number) ?? 0}
                  onChange={(e) => {
                    const secs = Math.min(59, Math.max(0, parseInt(e.target.value) || 0));
                    onUpdate({ delay_min_seconds: secs, delay_max_seconds: secs });
                  }}
                  className="h-8 text-sm"
                />
                <p className="text-[11px] text-muted-foreground">segundos</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Total: {((data.delay_minutes as number) || 0)}min{" "}
              {((data.delay_min_seconds as number) || 0)}s
            </p>
          </div>
        )}


        {type === "condition" && (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label className="text-xs">Como comparar a resposta do lead</Label>
              <Select
                value={(data.match_mode as string) || "exact"}
                onValueChange={(v) => onUpdate({ match_mode: v })}
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="exact">Exatamente igual</SelectItem>
                  <SelectItem value="contains">Parecida (contém / aproximada)</SelectItem>
                  <SelectItem value="ai">Parecida com avaliação da IA</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                {(data.match_mode as string) === "ai"
                  ? "A IA lê a resposta do lead e decide se ela corresponde à intenção descrita abaixo."
                  : (data.match_mode as string) === "contains"
                  ? "Aceita respostas que contenham a palavra ou sejam muito parecidas (ignora acentos e erros leves)."
                  : "O texto do lead precisa ser idêntico a uma das palavras abaixo."}
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Palavras / payloads que ativam (uma por linha ou separadas por vírgula)</Label>
              <textarea
                value={(data.trigger_value as string) || ""}
                onChange={(e) => onUpdate({ trigger_value: e.target.value })}
                placeholder={"Ex:\nsim\nquero saber mais\nok"}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[80px] resize-y focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                rows={4}
              />
              <p className="text-[11px] text-muted-foreground">
                Também usadas como referência quando a IA avalia a resposta.
              </p>
            </div>

            {(data.match_mode as string) === "ai" && (
              <div className="space-y-2">
                <Label className="text-xs">O que a IA deve considerar como "resposta correta"</Label>
                <textarea
                  value={(data.ai_match_description as string) || ""}
                  onChange={(e) => onUpdate({ ai_match_description: e.target.value })}
                  placeholder="Ex: o lead demonstrou interesse em participar, mesmo que com outras palavras"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[70px] resize-y focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  rows={3}
                />
              </div>
            )}
          </div>
        )}

        {type === "tag" && (
          <div className="space-y-2">
            <p className="text-[11px] text-muted-foreground">
              Ao passar por este passo, as etiquetas selecionadas são aplicadas ao lead.
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

        {type === "ai_agent" && (
          <AiAgentFields data={data} onUpdate={onUpdate} />
        )}

        {type === "blacklist" && (
          <div className="space-y-3">
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
              <p className="text-xs text-foreground font-medium mb-1">⚠️ Bloqueio definitivo</p>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Quando o lead chegar a este passo, ele será adicionado à sua blacklist e
                automaticamente excluído de todos os disparos futuros.
              </p>
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Motivo (opcional)</Label>
              <Input
                value={(data.reason as string) || ""}
                onChange={(e) => onUpdate({ reason: e.target.value })}
                placeholder="Ex: Pediu cancelamento"
                className="h-8 text-sm"
                maxLength={120}
              />
              <p className="text-[11px] text-muted-foreground">
                Conecte este passo após um botão "Cancelar", "Sair", "Bloquear", etc.
              </p>
            </div>
          </div>
        )}

        {type !== "blacklist" && (
          <StepLabelsField
            selected={(data.label_ids as string[]) || []}
            onChange={(ids) => onUpdate({ label_ids: ids })}
          />
        )}
      </div>
    </div>
  );
}

/** Etiquetas aplicadas ao lead quando ele passa por este passo do fluxo. */
function StepLabelsField({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const { labels, isLoading } = useChatLabels();
  const { team } = useTeam();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#6366f1");
  const [saving, setSaving] = useState(false);

  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  };

  /** Cria a etiqueta na conta (dono) e já a marca neste passo do fluxo. */
  const createLabel = async () => {
    const name = newName.trim();
    if (!name) {
      toast.error("Informe o nome da etiqueta");
      return;
    }
    setSaving(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth?.user?.id;
      if (!userId) throw new Error("Sessão expirada");

      const { data, error } = await supabase
        .from("chat_labels")
        .insert({ name, color: newColor, user_id: team?.ownerId ?? userId })
        .select("id")
        .single();
      if (error) throw error;

      await queryClient.invalidateQueries({ queryKey: ["chat-labels"] });
      if (data?.id) onChange([...selected, data.id]);
      toast.success("Etiqueta criada");
      setNewName("");
      setCreating(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao criar etiqueta");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2 border-t border-border pt-4">
      <Label className="text-xs">Etiquetas ao passar por este passo</Label>
      {isLoading ? (
        <p className="text-[11px] text-muted-foreground">Carregando etiquetas...</p>
      ) : labels.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          Nenhuma etiqueta criada ainda. Crie a primeira abaixo.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {labels.map((l) => {
            const active = selected.includes(l.id);
            return (
              <button
                key={l.id}
                type="button"
                onClick={() => toggle(l.id)}
                className={`text-[11px] px-2 py-1 rounded-md border transition-colors ${
                  active ? "text-background" : "text-foreground bg-background hover:bg-muted"
                }`}
                style={
                  active
                    ? { backgroundColor: l.color, borderColor: l.color }
                    : { borderColor: l.color }
                }
              >
                {l.name}
              </button>
            );
          })}
        </div>
      )}

      {creating ? (
        <div className="space-y-2 rounded-md border border-border p-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nome da etiqueta"
            className="h-8 text-sm"
            maxLength={40}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void createLabel();
              }
            }}
          />
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={newColor}
              onChange={(e) => setNewColor(e.target.value)}
              className="h-8 w-10 rounded border border-input bg-background p-0.5"
              aria-label="Cor da etiqueta"
            />
            <Button size="sm" className="h-8 text-xs" disabled={saving} onClick={() => void createLabel()}>
              {saving ? <Loader2 size={12} className="animate-spin" /> : "Criar"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs"
              disabled={saving}
              onClick={() => {
                setCreating(false);
                setNewName("");
              }}
            >
              Cancelar
            </Button>
          </div>
        </div>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 text-xs"
          onClick={() => setCreating(true)}
        >
          <Plus size={12} /> Nova etiqueta
        </Button>
      )}

      <p className="text-[11px] text-muted-foreground">
        Útil para acompanhar por quais etapas do fluxo cada lead passou.
      </p>
    </div>
  );
}


function AiAgentFields({ data, onUpdate }: { data: Record<string, unknown>; onUpdate: (d: Record<string, unknown>) => void }) {
  const { agents, isLoading } = useAiAgents();

  return (
    <>
      <div className="space-y-2">
        <Label className="text-xs">Agente</Label>
        <Select
          value={(data.agent_id as string) || ""}
          onValueChange={(v) => {
            const selected = agents.find((a) => a.id === v);
            onUpdate({ agent_id: v, agent_name: selected?.name || "" });
          }}
        >
          <SelectTrigger className="h-8 text-sm">
            <SelectValue placeholder={isLoading ? "Carregando..." : "Selecione um agente..."} />
          </SelectTrigger>
          <SelectContent>
            {agents.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name} {!a.active && "(inativo)"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground">
          Selecione qual agente configurado irá responder neste passo do fluxo.
        </p>
      </div>

      <div className="space-y-2">
        <Label className="text-xs">Instruções adicionais (opcional)</Label>
        <textarea
          value={(data.ai_prompt as string) || ""}
          onChange={(e) => onUpdate({ ai_prompt: e.target.value })}
          placeholder="Instruções extras para este passo específico do fluxo..."
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[80px] resize-y focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          rows={3}
        />
      </div>

      <div className="space-y-2">
        <Label className="text-xs">Máximo de interações</Label>
        <Input
          type="number"
          min={1}
          max={50}
          value={(data.max_interactions as number) || 5}
          onChange={(e) => onUpdate({ max_interactions: parseInt(e.target.value) || 5 })}
          className="h-8 text-sm"
        />
        <p className="text-[11px] text-muted-foreground">
          Após esse número de trocas, o fluxo avança para o próximo passo.
        </p>
      </div>
    </>
  );
}

function TemplateVariationsField({
  mainTemplateId,
  variations,
  templates,
  onChange,
}: {
  mainTemplateId: string;
  variations: string[];
  templates: any[];
  onChange: (v: string[]) => void;
}) {
  const available = templates.filter(
    (t) => t.id !== mainTemplateId && !variations.includes(t.id),
  );
  return (
    <div className="space-y-2 rounded-md border border-dashed border-primary/30 bg-primary/5 p-3">
      <div className="flex items-center justify-between">
        <Label className="text-xs">Templates alternativos</Label>
        <span className="text-[10px] text-muted-foreground">
          {variations.length} alternativa(s)
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        O sistema sorteia entre o template principal e os alternativos a cada envio,
        reduzindo o risco de banimento por repetição.
      </p>
      {variations.map((tid, idx) => {
        const tpl = templates.find((t) => t.id === tid);
        return (
          <div key={tid + idx} className="flex items-center gap-2">
            <div className="flex-1 truncate rounded-md border border-input bg-background px-2 py-1.5 text-xs">
              {tpl ? `${tpl.name}${tpl.template_name ? ` (${tpl.template_name})` : ""}` : "(template removido)"}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-destructive shrink-0"
              onClick={() => onChange(variations.filter((_, i) => i !== idx))}
            >
              <Trash2 size={12} />
            </Button>
          </div>
        );
      })}
      {available.length > 0 && (
        <Select value="" onValueChange={(v) => v && onChange([...variations, v])}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="+ Adicionar template alternativo" />
          </SelectTrigger>
          <SelectContent>
            {available.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name} {t.template_name ? `(${t.template_name})` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

function MessageVariationsField({
  variations,
  onChange,
}: {
  variations: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <div className="space-y-2 rounded-md border border-dashed border-primary/30 bg-primary/5 p-3">
      <div className="flex items-center justify-between">
        <Label className="text-xs">Variações da mensagem</Label>
        <span className="text-[10px] text-muted-foreground">
          {variations.length} variação(ões)
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        O sistema escolherá uma destas versões aleatoriamente a cada envio (anti-ban).
        Deixe vazio para sempre usar a mensagem principal.
      </p>
      {variations.map((v, idx) => (
        <div key={idx} className="flex items-start gap-2">
          <textarea
            value={v}
            onChange={(e) => {
              const next = [...variations];
              next[idx] = e.target.value;
              onChange(next);
            }}
            placeholder={`Variação ${idx + 1}...`}
            rows={2}
            className="flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-xs min-h-[50px] resize-y focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive shrink-0"
            onClick={() => onChange(variations.filter((_, i) => i !== idx))}
          >
            <Trash2 size={12} />
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        className="text-xs gap-1 w-full"
        onClick={() => onChange([...variations, ""])}
      >
        <Plus size={12} /> Adicionar variação
      </Button>
    </div>
  );
}

function ImageUploadField({
  mediaUrl,
  mediaType,
  onChange,
}: {
  mediaUrl: string | null;
  mediaType?: string | null;
  onChange: (url: string | null) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  // Hide image preview slot if a non-image media is set (e.g. document)
  const showPreview = mediaUrl && (!mediaType || mediaType === "image");

  const handleFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Selecione um arquivo de imagem.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Imagem muito grande (máximo 5MB).");
      return;
    }
    setUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Não autenticado");
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${user.id}/flow-${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("chat-media")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) throw upErr;
      const { data: signed, error: signErr } = await supabase.storage
        .from("chat-media")
        .createSignedUrl(path, 60 * 60 * 24 * 365);
      if (signErr || !signed?.signedUrl) throw signErr || new Error("Falha ao gerar URL da imagem");
      onChange(signed.signedUrl);
      toast.success("Imagem carregada!");
    } catch (err: any) {
      toast.error(err.message || "Falha ao enviar imagem");
    } finally {
      setUploading(false);
    }
  };

  // If a non-image media is already attached, don't render the image uploader (one media per node)
  if (mediaUrl && mediaType && mediaType !== "image") return null;

  return (
    <div className="space-y-2">
      <Label className="text-xs flex items-center gap-1.5">
        <ImageIcon size={12} /> Imagem (opcional)
      </Label>
      {showPreview ? (
        <div className="relative rounded-md border border-border overflow-hidden bg-muted/30">
          <img src={mediaUrl} alt="Preview" className="w-full max-h-40 object-contain" />
          <Button
            variant="destructive"
            size="icon"
            className="absolute top-1 right-1 h-6 w-6"
            onClick={() => onChange(null)}
          >
            <Trash2 size={12} />
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
          className="w-full gap-2 text-xs h-9 border-dashed"
        >
          {uploading ? (
            <><Loader2 size={12} className="animate-spin" /> Enviando...</>
          ) : (
            <><Upload size={12} /> Enviar imagem</>
          )}
        </Button>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = "";
        }}
      />
      <p className="text-[11px] text-muted-foreground">
        Pode enviar só imagem, só texto, ou imagem + texto (legenda).
      </p>
    </div>
  );
}

function DocumentUploadField({
  mediaUrl,
  mediaType,
  fileName: fileNameProp,
  onChange,
  onFileNameChange,
}: {
  mediaUrl: string | null;
  mediaType?: string | null;
  fileName?: string | null;
  onChange: (url: string | null) => void;
  onFileNameChange?: (name: string | null) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [localFileName, setLocalFileName] = useState<string | null>(fileNameProp || null);

  const displayName = fileNameProp ?? localFileName;

  const handleFile = async (file: File) => {
    const isPdf =
      file.type === "application/pdf" ||
      file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      toast.error("Selecione um arquivo PDF.");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast.error("PDF muito grande (máximo 20MB).");
      return;
    }
    setUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Não autenticado");
      const path = `${user.id}/flow-doc-${crypto.randomUUID()}.pdf`;
      const { error: upErr } = await supabase.storage
        .from("chat-media")
        .upload(path, file, { contentType: "application/pdf", upsert: false });
      if (upErr) throw upErr;
      const { data: pub } = await supabase.storage.from("chat-media").createSignedUrl(path, 60 * 60 * 24 * 365);
      onChange(pub!.signedUrl);
      // Default the WhatsApp display name to the original filename (without .pdf)
      const cleanName = file.name.replace(/\.pdf$/i, "");
      setLocalFileName(cleanName);
      onFileNameChange?.(cleanName);
      toast.success("PDF carregado!");
    } catch (err: any) {
      toast.error(err.message || "Falha ao enviar PDF");
    } finally {
      setUploading(false);
    }
  };

  // If another media is attached, hide doc uploader
  if (mediaUrl && mediaType && mediaType !== "document") return null;

  const isDocAttached = mediaUrl && mediaType === "document";

  return (
    <div className="space-y-2">
      <Label className="text-xs flex items-center gap-1.5">
        <FileText size={12} /> PDF (opcional)
      </Label>
      {isDocAttached ? (
        <>
          <div className="relative rounded-md border border-border bg-muted/30 p-3 flex items-center gap-2">
            <FileText size={16} className="text-emerald-600 shrink-0" />
            <a
              href={mediaUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-foreground truncate hover:underline flex-1"
              title={displayName || mediaUrl}
            >
              {displayName || "Documento PDF anexado"}
            </a>
            <Button
              variant="destructive"
              size="icon"
              className="h-6 w-6 shrink-0"
              onClick={() => {
                setLocalFileName(null);
                onFileNameChange?.(null);
                onChange(null);
              }}
            >
              <Trash2 size={12} />
            </Button>
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">
              Nome exibido no WhatsApp
            </Label>
            <Input
              value={displayName || ""}
              onChange={(e) => {
                const v = e.target.value;
                setLocalFileName(v);
                onFileNameChange?.(v);
              }}
              placeholder="Ex: Guia da Desinflamação Zero Lipedema"
              className="h-8 text-sm"
              maxLength={100}
            />
            <p className="text-[10px] text-muted-foreground">
              A extensão ".pdf" é adicionada automaticamente.
            </p>
          </div>
        </>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
          className="w-full gap-2 text-xs h-9 border-dashed"
        >
          {uploading ? (
            <><Loader2 size={12} className="animate-spin" /> Enviando...</>
          ) : (
            <><Upload size={12} /> Enviar PDF</>
          )}
        </Button>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = "";
        }}
      />
      {!isDocAttached && (
        <p className="text-[11px] text-muted-foreground">
          Envie um PDF (até 20MB) que será anexado junto à mensagem.
        </p>
      )}
    </div>
  );
}

function VideoUploadField({
  mediaUrl,
  mediaType,
  onChange,
}: {
  mediaUrl: string | null;
  mediaType?: string | null;
  onChange: (url: string | null) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  // Hide if another media type is attached
  if (mediaUrl && mediaType && mediaType !== "video") return null;

  const isVideoAttached = mediaUrl && mediaType === "video";

  const handleFile = async (file: File) => {
    if (!file.type.startsWith("video/")) {
      toast.error("Selecione um arquivo de vídeo.");
      return;
    }
    if (file.size > 16 * 1024 * 1024) {
      toast.error("Vídeo muito grande (máximo 16MB pelo WhatsApp).");
      return;
    }
    setUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Não autenticado");
      const ext = file.name.split(".").pop() || "mp4";
      const path = `${user.id}/flow-video-${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("chat-media")
        .upload(path, file, { contentType: file.type || "video/mp4", upsert: false });
      if (upErr) throw upErr;
      const { data: pub } = await supabase.storage.from("chat-media").createSignedUrl(path, 60 * 60 * 24 * 365);
      onChange(pub!.signedUrl);
      toast.success("Vídeo carregado!");
    } catch (err: any) {
      toast.error(err.message || "Falha ao enviar vídeo");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-2">
      <Label className="text-xs flex items-center gap-1.5">
        <VideoIcon size={12} /> Vídeo (opcional)
      </Label>
      {isVideoAttached ? (
        <div className="relative rounded-md border border-border overflow-hidden bg-muted/30">
          <video src={mediaUrl} controls className="w-full max-h-40" />
          <Button
            variant="destructive"
            size="icon"
            className="absolute top-1 right-1 h-6 w-6"
            onClick={() => onChange(null)}
          >
            <Trash2 size={12} />
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
          className="w-full gap-2 text-xs h-9 border-dashed"
        >
          {uploading ? (
            <><Loader2 size={12} className="animate-spin" /> Enviando...</>
          ) : (
            <><Upload size={12} /> Enviar vídeo</>
          )}
        </Button>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="video/mp4,video/3gpp,video/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = "";
        }}
      />
      {!isVideoAttached && (
        <p className="text-[11px] text-muted-foreground">
          MP4 até 16MB. Pode incluir uma legenda no campo de mensagem.
        </p>
      )}
    </div>
  );
}

/**
 * Campo de áudio da etapa de mensagem.
 *
 * Aceita upload de arquivo (MP3/OGG/M4A) ou gravação direta pelo microfone.
 * Só aparece quando nenhuma outra mídia está anexada — a Meta permite apenas
 * um tipo de mídia por mensagem.
 */
function AudioUploadField({
  mediaUrl,
  mediaType,
  onChange,
}: {
  mediaUrl: string | null;
  mediaType?: string | null;
  onChange: (url: string | null) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  // Esconde se outro tipo de mídia já está anexado
  if (mediaUrl && mediaType && mediaType !== "audio") return null;

  const isAudioAttached = !!mediaUrl && mediaType === "audio";

  const uploadBlob = async (file: File | Blob, ext: string, contentType: string) => {
    setUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Não autenticado");
      const path = `${user.id}/flow-audio-${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("chat-media")
        .upload(path, file, { contentType, upsert: false });
      if (upErr) throw upErr;
      const { data: pub } = await supabase.storage
        .from("chat-media")
        .createSignedUrl(path, 60 * 60 * 24 * 365);
      onChange(pub!.signedUrl);
      toast.success("Áudio carregado!");
    } catch (err: any) {
      toast.error(err.message || "Falha ao enviar áudio");
    } finally {
      setUploading(false);
    }
  };

  const handleFile = async (file: File) => {
    if (!file.type.startsWith("audio/")) {
      toast.error("Selecione um arquivo de áudio.");
      return;
    }
    if (file.size > 16 * 1024 * 1024) {
      toast.error("Áudio muito grande (máximo 16MB pelo WhatsApp).");
      return;
    }
    const ext = file.name.split(".").pop() || "mp3";
    await uploadBlob(file, ext, file.type || "audio/mpeg");
  };

  return (
    <div className="space-y-2">
      <Label className="text-xs flex items-center gap-1.5">
        <Mic size={12} /> Áudio (opcional)
      </Label>
      {isAudioAttached ? (
        <div className="relative rounded-md border border-border bg-muted/30 p-2 pr-9">
          <audio src={mediaUrl!} controls className="w-full h-9" />
          <Button
            variant="destructive"
            size="icon"
            className="absolute top-1 right-1 h-6 w-6"
            onClick={() => onChange(null)}
          >
            <Trash2 size={12} />
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            className="flex-1 gap-2 text-xs h-9 border-dashed"
          >
            {uploading ? (
              <><Loader2 size={12} className="animate-spin" /> Enviando...</>
            ) : (
              <><Upload size={12} /> Enviar áudio</>
            )}
          </Button>
          <div className="shrink-0">
            <AudioRecorder
              disabled={uploading}
              onRecorded={(blob) => uploadBlob(blob, "ogg", "audio/ogg")}
            />
          </div>
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/mpeg,audio/ogg,audio/mp4,audio/aac,audio/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = "";
        }}
      />
      {!isAudioAttached && (
        <p className="text-[11px] text-muted-foreground">
          MP3/OGG (opus) até 16MB, ou grave pelo microfone. Áudio é enviado sem legenda pelo WhatsApp.
        </p>
      )}
    </div>
  );
}
