import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Image as ImageIcon, Save, Loader2, Upload, Trash2, Zap, ShoppingCart, CheckCircle2, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

type EventType = "pix_generated" | "cart_abandoned" | "purchase_confirmed" | "purchase_refused";

const EVENT_DEFS: { key: EventType; label: string; desc: string; icon: any; color: string }[] = [
  { key: "pix_generated", label: "PIX Gerado", desc: "Quando um PIX é criado e está aguardando pagamento", icon: Zap, color: "text-emerald-500" },
  { key: "cart_abandoned", label: "Carrinho Abandonado", desc: "Cliente entrou no checkout mas não finalizou", icon: ShoppingCart, color: "text-orange-500" },
  { key: "purchase_confirmed", label: "Compra Confirmada", desc: "Pagamento aprovado, boas-vindas/entrega", icon: CheckCircle2, color: "text-green-600" },
  { key: "purchase_refused", label: "Compra Recusada / Expirada", desc: "PIX expirado ou cartão recusado (recuperação)", icon: XCircle, color: "text-red-500" },
];

interface EventConfig {
  id?: string;
  event_type: EventType;
  agent_id: string | null;
  active: boolean;
  send_media: boolean;
  media_url: string | null;
  media_type: string;
  message_template: string;
}

interface AgentLite { id: string; name: string; active: boolean }

const DEFAULT_TEMPLATES: Record<EventType, string> = {
  pix_generated: "Olá {nome}! 🔥\n\n*PIX GERADO* ✅\n\nFinalize sua matrícula de forma *rápida e segura*.\n\n🔗 Clique no link abaixo para acessar seu código PIX:\n{link}\n\n🔒 Sua vaga ainda *está reservada*!",
  cart_abandoned: "Oi {nome}! 👀\n\nVi que você começou sua matrícula{produto} mas não finalizou.\n\nPosso te ajudar com alguma dúvida? Sua vaga ainda está reservada! 💜",
  purchase_confirmed: "Parabéns {nome}! 🎉\n\nSua compra{produto} foi *confirmada*. Seja muito bem-vindo(a)!\n\nEm instantes você receberá os acessos por aqui. ✨",
  purchase_refused: "Olá {nome}, 😕\n\nO pagamento{produto} não foi aprovado.\n\nQuer tentar novamente? Posso gerar um novo link agora mesmo. 🔁",
};

export function EventAgentMapping() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<EventType | null>(null);
  const [uploading, setUploading] = useState<EventType | null>(null);
  const [agents, setAgents] = useState<AgentLite[]>([]);
  const [configs, setConfigs] = useState<Record<EventType, EventConfig>>({} as any);

  useEffect(() => {
    const load = async () => {
      if (!user) return;
      setLoading(true);
      const [{ data: agentRows }, { data: cfgRows }] = await Promise.all([
        supabase.from("ai_agents").select("id, name, active").eq("user_id", user.id).order("name"),
        supabase.from("event_agent_config").select("*").eq("user_id", user.id),
      ]);
      setAgents((agentRows as AgentLite[]) || []);

      const map: Record<string, EventConfig> = {};
      (cfgRows || []).forEach((r: any) => { map[r.event_type] = r; });

      const next: Record<EventType, EventConfig> = {} as any;
      EVENT_DEFS.forEach(({ key }) => {
        next[key] = map[key] || {
          event_type: key, agent_id: null, active: false,
          send_media: false, media_url: null, media_type: "image",
          message_template: DEFAULT_TEMPLATES[key],
        };
      });
      setConfigs(next);
      setLoading(false);
    };
    load();
  }, [user]);

  const updateField = <K extends keyof EventConfig>(evt: EventType, key: K, value: EventConfig[K]) => {
    setConfigs(prev => ({ ...prev, [evt]: { ...prev[evt], [key]: value } }));
  };

  const handleUpload = async (evt: EventType, file: File) => {
    if (!user) return;
    setUploading(evt);
    try {
      const ext = file.name.split(".").pop() || "png";
      // Bucket is private and scoped by user folder.
      const path = `${user.id}/event-templates/${evt}-${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("chat-media").upload(path, file, { upsert: true });
      if (error) throw error;
      const { data: signed, error: signErr } = await supabase.storage
        .from("chat-media")
        .createSignedUrl(path, 60 * 60 * 24 * 365);
      if (signErr || !signed?.signedUrl) throw signErr || new Error("Falha ao gerar URL da imagem");
      updateField(evt, "media_url", signed.signedUrl);
      updateField(evt, "send_media", true);
      toast.success("Imagem enviada");
    } catch (e: any) {
      toast.error(`Falha no upload: ${e.message}`);
    } finally {
      setUploading(null);
    }
  };

  const handleSave = async (evt: EventType) => {
    if (!user) return;
    setSaving(evt);
    try {
      const cfg = configs[evt];
      const payload = {
        user_id: user.id,
        event_type: evt,
        agent_id: cfg.agent_id,
        active: cfg.active,
        send_media: cfg.send_media,
        media_url: cfg.media_url,
        media_type: cfg.media_type || "image",
        message_template: cfg.message_template,
      };
      const { data, error } = await supabase
        .from("event_agent_config")
        .upsert(payload, { onConflict: "user_id,event_type" })
        .select("id")
        .single();
      if (error) throw error;
      updateField(evt, "id", data.id as any);
      toast.success("Configuração salva");
    } catch (e: any) {
      toast.error(`Erro ao salvar: ${e.message}`);
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold">Agentes por Evento</h3>
        <p className="text-xs text-muted-foreground">
          Configure qual agente IA, mídia (imagem) e copy serão enviados automaticamente para cada tipo de evento da sua plataforma de pagamento (Hubla, Perfect Pay, etc.).
        </p>
        <p className="text-[10px] text-muted-foreground mt-1">
          Variáveis disponíveis: <code className="bg-muted px-1 rounded">{`{nome}`}</code> · <code className="bg-muted px-1 rounded">{`{link}`}</code> · <code className="bg-muted px-1 rounded">{`{valor}`}</code> · <code className="bg-muted px-1 rounded">{`{produto}`}</code>
        </p>
      </div>

      {EVENT_DEFS.map(({ key, label, desc, icon: Icon, color }) => {
        const cfg = configs[key];
        if (!cfg) return null;
        return (
          <Card key={key} className={cfg.active ? "border-primary/40" : ""}>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 h-9 w-9 rounded-lg bg-muted flex items-center justify-center ${color}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle className="text-sm flex items-center gap-2">
                      {label}
                      {cfg.active && <Badge variant="secondary" className="text-[10px]">Ativo</Badge>}
                    </CardTitle>
                    <CardDescription className="text-xs mt-0.5">{desc}</CardDescription>
                  </div>
                </div>
                <Switch checked={cfg.active} onCheckedChange={(v) => updateField(key, "active", v)} />
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs font-medium">Agente IA</Label>
                  <Select
                    value={cfg.agent_id || "none"}
                    onValueChange={(v) => updateField(key, "agent_id", v === "none" ? null : v)}
                  >
                    <SelectTrigger className="mt-1.5">
                      <SelectValue placeholder="Nenhum (apenas envia a mensagem)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Nenhum (apenas envia a mensagem)</SelectItem>
                      {agents.map(a => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name} {!a.active && "(inativo)"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Agente que responderá as próximas mensagens deste lead após o evento.
                  </p>
                </div>
                <div>
                  <Label className="text-xs font-medium flex items-center gap-2">
                    <ImageIcon className="h-3.5 w-3.5" /> Imagem (opcional)
                  </Label>
                  <div className="mt-1.5 flex items-center gap-2">
                    <Input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleUpload(key, f);
                      }}
                      disabled={uploading === key}
                      className="text-xs"
                    />
                    {cfg.media_url && (
                      <Button
                        type="button" variant="outline" size="icon"
                        onClick={() => { updateField(key, "media_url", null); updateField(key, "send_media", false); }}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    )}
                  </div>
                  {cfg.media_url && (
                    <div className="mt-2 flex items-center gap-2">
                      <img src={cfg.media_url} alt="Preview" className="h-16 w-16 rounded border object-cover" />
                      <div className="flex items-center gap-2 text-xs">
                        <Switch
                          checked={cfg.send_media}
                          onCheckedChange={(v) => updateField(key, "send_media", v)}
                        />
                        <span className="text-muted-foreground">Enviar imagem com a mensagem</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div>
                <Label className="text-xs font-medium">Mensagem (legenda)</Label>
                <Textarea
                  value={cfg.message_template}
                  onChange={(e) => updateField(key, "message_template", e.target.value)}
                  className="mt-1.5 min-h-[110px] text-sm font-mono"
                  placeholder="Use {nome}, {link}, {valor}, {produto}..."
                />
              </div>

              <div className="flex justify-end">
                <Button size="sm" onClick={() => handleSave(key)} disabled={saving === key} className="gap-1.5">
                  {saving === key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  Salvar
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
