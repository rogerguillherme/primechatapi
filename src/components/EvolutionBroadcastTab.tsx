import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ContactImporter } from "@/components/ContactImporter";
import { toast } from "sonner";
import {
  Smartphone, GitBranch, MessageSquare, Send, Search, ShieldAlert,
  Sparkles, Loader2, Users, Image as ImageIcon, Info, Upload,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Mode = "message" | "flow";

const VARIABLES = [
  { key: "{nome}", label: "Nome completo" },
  { key: "{primeiro_nome}", label: "Primeiro nome" },
  { key: "{telefone}", label: "Telefone" },
];

// Zero-width unicode chars used to randomize message fingerprint per send.
// Anti-ban: makes every outbound message bytewise unique while staying invisible.
const ZW = ["\u200B", "\u200C", "\u200D", "\u2060"];
function zeroWidthVariant(len = 6) {
  return Array.from({ length: len }, () => ZW[Math.floor(Math.random() * ZW.length)]).join("");
}

function speedLevel(min: number, max: number): {
  level: "seguro" | "moderado" | "agressivo" | "extremo";
  tone: string;
  description: string;
} {
  const avg = (min + max) / 2;
  if (avg >= 20) return { level: "seguro", tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30", description: "Perfil humano. Baixíssimo risco." };
  if (avg >= 10) return { level: "moderado", tone: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30", description: "Aceitável para warmup avançado." };
  if (avg >= 5)  return { level: "agressivo", tone: "bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30", description: "Risco alto de bloqueio em volumes >300." };
  return { level: "extremo", tone: "bg-destructive/15 text-destructive border-destructive/30", description: "Quase certeza de ban. Use apenas para testes internos." };
}

export function EvolutionBroadcastTab() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [accountId, setAccountId] = useState<string>("");
  const [mode, setMode] = useState<Mode>("message");
  const [flowId, setFlowId] = useState<string>("");
  const [message, setMessage] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [delayMin, setDelayMin] = useState(12);
  const [delayMax, setDelayMax] = useState(35);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const { data: accounts = [] } = useQuery({
    queryKey: ["evolution-accounts", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("whatsapp_accounts")
        .select("id, name, phone_number_id, provider, last_health_status")
        .eq("provider", "evolution")
        .order("name");
      if (error) throw error;
      return data || [];
    },
  });

  const { data: flows = [] } = useQuery({
    queryKey: ["whatsapp-flows", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("flows")
        .select("id, name, active, flow_kind, trigger_type")
        .eq("flow_kind", "whatsapp")
        .order("name");
      if (error) throw error;
      return data || [];
    },
  });

  const { data: leads = [] } = useQuery({
    queryKey: ["evolution-broadcast-leads", user?.id],
    enabled: !!user,
    queryFn: async () => {
      // Paginação para contornar limite de 1000 do PostgREST e trazer todos os leads
      // (mesmo conjunto exibido na aba "Disparo API").
      const pageSize = 1000;
      let from = 0;
      const all: any[] = [];
      while (true) {
        const { data, error } = await supabase
          .from("leads")
          .select("id, name, phone, email, unsubscribed, origin")
          .order("name")
          .range(from, from + pageSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        all.push(...data);
        if (data.length < pageSize) break;
        from += pageSize;
      }
      return all;
    },
  });

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return leads;
    return leads.filter((l: any) =>
      (l.name || "").toLowerCase().includes(q) ||
      (l.phone || "").includes(q)
    );
  }, [leads, search]);

  const speed = speedLevel(delayMin, delayMax);
  const account = accounts.find((a: any) => a.id === accountId);
  const totalSeconds = ((delayMin + delayMax) / 2) * selected.size;
  const eta = totalSeconds < 60
    ? `${Math.ceil(totalSeconds)}s`
    : totalSeconds < 3600
      ? `${Math.ceil(totalSeconds / 60)}min`
      : `${(totalSeconds / 3600).toFixed(1)}h`;

  function toggleAll() {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((l: any) => l.id)));
  }
  function toggle(id: string) {
    setSelected((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }
  function insertVar(v: string) {
    setMessage((m) => m + (m && !m.endsWith(" ") ? " " : "") + v);
  }

  async function startFlowBulk(leadIds: string[]) {
    const { data: rootSteps, error: rootErr } = await supabase
      .from("flow_steps")
      .select("*")
      .eq("flow_id", flowId)
      .is("parent_step_id", null)
      .order("step_order")
      .limit(1);
    if (rootErr) throw new Error(rootErr.message);
    let firstStep = rootSteps?.[0];
    if (!firstStep) {
      const { data: any2 } = await supabase
        .from("flow_steps").select("*").eq("flow_id", flowId).order("step_order").limit(1);
      firstStep = any2?.[0];
    }
    if (!firstStep) throw new Error("Fluxo sem etapas. Abra o Flow Builder e salve novamente.");

    const status =
      firstStep.step_type === "delay" ? "waiting_delay"
      : firstStep.step_type === "no_response" ? "waiting_no_response"
      : firstStep.step_type === "condition" ? "waiting_reply"
      : "waiting_delay";

    const nextAt =
      firstStep.step_type === "delay"
        ? new Date(Date.now() + (firstStep.delay_minutes || 0) * 60_000).toISOString()
        : firstStep.step_type === "no_response"
          ? new Date(Date.now() + (firstStep.timeout_minutes || 10) * 60_000).toISOString()
          : new Date().toISOString();

    // Cancel active executions first
    const C = 200;
    for (let i = 0; i < leadIds.length; i += C) {
      const batch = leadIds.slice(i, i + C);
      await supabase.from("flow_executions").update({ status: "cancelled" })
        .in("lead_id", batch)
        .in("status", ["running", "waiting_delay", "waiting_reply", "waiting_no_response"]);
    }

    const I = 50;
    let ok = 0, fail = 0;
    for (let i = 0; i < leadIds.length; i += I) {
      const batch = leadIds.slice(i, i + I);
      const rows = batch.map((lid) => ({
        flow_id: flowId,
        lead_id: lid,
        current_step_id: firstStep!.id,
        status,
        next_action_at: nextAt,
        metadata: { codigo: "", account_id: accountId },
      }));
      const { error } = await supabase.from("flow_executions").insert(rows);
      if (error) { fail += batch.length; console.error(error); } else ok += batch.length;
    }
    supabase.functions.invoke("flow-processor", { body: { auto: true } }).catch(() => {});
    return { ok, fail };
  }

  async function handleSend() {
    if (!accountId) return toast.error("Selecione um número.");
    if (selected.size === 0) return toast.error("Selecione pelo menos um lead.");
    if (mode === "message" && message.trim().length === 0) return toast.error("Escreva a mensagem.");
    if (mode === "flow" && !flowId) return toast.error("Selecione um fluxo.");
    if (delayMin > delayMax) return toast.error("Delay mínimo não pode ser maior que o máximo.");
    if (speed.level === "extremo") {
      const ok = confirm("⚠️ Velocidade EXTREMA: risco quase certo de banimento. Continuar mesmo assim?");
      if (!ok) return;
    }

    setSending(true);
    try {
      const leadIds = Array.from(selected);
      if (mode === "flow") {
        const { ok, fail } = await startFlowBulk(leadIds);
        toast.success(`Fluxo iniciado para ${ok} lead(s)${fail ? `. ${fail} falharam.` : "."}`);
        setSelected(new Set());
      } else {
        // Append zero-width fingerprint so identical bodies still vary at byte level.
        const finalMessage = `${message}${zeroWidthVariant()}`;
        const { data, error } = await supabase.functions.invoke("evolution-bulk-broadcast", {
          body: {
            account_id: accountId,
            lead_ids: leadIds,
            message: finalMessage,
            image_url: imageUrl.trim() || undefined,
            delay_min: delayMin,
            delay_max: delayMax,
          },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        toast.success(`Disparo iniciado: ${data?.total_leads || leadIds.length} leads na fila.`);
        setSelected(new Set());
      }
    } catch (e: any) {
      toast.error(e?.message || "Falha ao iniciar disparo.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Smartphone size={18} className="text-primary" />
            Disparo WhatsApp (não-Cloud)
          </h2>
          <p className="text-xs text-muted-foreground">
            Envio em massa pelos números Evolution (WhatsApp Web). Sem templates, com controle anti-ban.
          </p>
        </div>
        <Badge variant="outline" className={cn("border", speed.tone)}>
          Velocidade: {speed.level.toUpperCase()} · ETA ≈ {eta}
        </Badge>
      </div>

      {/* Top row: account + mode + speed */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><Smartphone size={14}/> Número</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Selecione um número Evolution..." />
              </SelectTrigger>
              <SelectContent>
                {accounts.length === 0 ? (
                  <div className="text-xs text-muted-foreground p-3">
                    Nenhum número Evolution conectado. Vá em Contas e conecte um número WhatsApp Web.
                  </div>
                ) : accounts.map((a: any) => (
                  <SelectItem key={a.id} value={a.id} className="text-sm">
                    {a.name} {a.last_health_status ? `· ${a.last_health_status}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {account && (
              <p className="text-[11px] text-muted-foreground">
                Instância: <code className="font-mono">{account.phone_number_id}</code>
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><Sparkles size={14}/> Tipo de disparo</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex gap-2">
              <Button variant={mode === "message" ? "default" : "outline"} size="sm" className="flex-1"
                onClick={() => setMode("message")}>
                <MessageSquare size={14} className="mr-1.5"/> Mensagem
              </Button>
              <Button variant={mode === "flow" ? "default" : "outline"} size="sm" className="flex-1"
                onClick={() => setMode("flow")}>
                <GitBranch size={14} className="mr-1.5"/> Fluxo
              </Button>
            </div>
            {mode === "flow" && (
              <Select value={flowId} onValueChange={setFlowId}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Selecione um fluxo WhatsApp..." />
                </SelectTrigger>
                <SelectContent>
                  {flows.length === 0 ? (
                    <div className="text-xs text-muted-foreground p-3">
                      Nenhum fluxo do tipo WhatsApp. Crie um no Flow Builder.
                    </div>
                  ) : flows.map((f: any) => (
                    <SelectItem key={f.id} value={f.id} className="text-sm">
                      {f.name} {f.active ? "· ativo" : "· inativo"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><ShieldAlert size={14}/> Controle de velocidade</CardTitle>
            <CardDescription className="text-[11px]">
              Delay aleatório entre mensagens (segundos).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <div className="flex justify-between text-[11px] text-muted-foreground mb-1">
                <span>Mín: <b>{delayMin}s</b></span>
                <span>Máx: <b>{delayMax}s</b></span>
              </div>
              <Slider min={1} max={120} step={1} value={[delayMin, delayMax]}
                onValueChange={(v) => { setDelayMin(v[0]); setDelayMax(v[1]); }} />
            </div>
            <div className={cn("rounded-md border px-2 py-1.5 text-[11px]", speed.tone)}>
              {speed.description}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Anti-ban rules card */}
      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2 text-amber-700 dark:text-amber-300">
            <ShieldAlert size={14}/> Regras anti-ban (WhatsApp Web)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-1.5 text-[12px] text-foreground/85 sm:grid-cols-2">
            <li>• Use <b>delay ≥ 12s</b> em números novos (warmup nas primeiras 2 semanas).</li>
            <li>• Limite <b>≤ 200 disparos/dia</b> em número novo, ≤ 800/dia em maduro.</li>
            <li>• Sempre <b>varie a mensagem</b> com {`{primeiro_nome}`} e blocos opcionais.</li>
            <li>• Cada envio recebe assinatura invisível (zero-width) para variar a impressão digital.</li>
            <li>• Em 5 erros consecutivos o disparo é <b>pausado automaticamente</b>.</li>
            <li>• Não dispare para números que <b>nunca interagiram</b> com você.</li>
            <li>• Respeite a janela <b>9h–21h</b> do fuso do destinatário.</li>
            <li>• Se receber denúncia, <b>pause 24-48h</b> antes de retomar.</li>
          </ul>
        </CardContent>
      </Card>

      {/* Body: leads + message */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Leads */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Users size={14}/> Leads ({selected.size}/{filtered.length})
              </CardTitle>
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setImportOpen(true)}>
                <Upload size={12} className="mr-1"/> Importar lista
              </Button>
            </div>
            <div className="relative mt-2">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"/>
              <Input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar nome ou telefone..." className="pl-9 h-9 text-sm"/>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="px-4 py-2 border-b border-border">
              <button onClick={toggleAll} className="text-xs text-primary hover:underline">
                {selected.size === filtered.length && filtered.length > 0 ? "Desmarcar todos" : "Selecionar todos"}
              </button>
            </div>
            <ScrollArea className="h-[340px]">
              {filtered.map((l: any) => (
                <button key={l.id} onClick={() => toggle(l.id)}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-accent/40",
                    selected.has(l.id) && "bg-primary/5"
                  )}>
                  <Checkbox checked={selected.has(l.id)} className="pointer-events-none"/>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{l.name || "(sem nome)"}</p>
                    <p className="text-[11px] text-muted-foreground font-mono">{l.phone}</p>
                  </div>
                </button>
              ))}
              {filtered.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">Nenhum lead encontrado</p>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Message / flow preview */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              {mode === "message" ? <><MessageSquare size={14}/> Mensagem</> : <><GitBranch size={14}/> Fluxo selecionado</>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {mode === "message" ? (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {VARIABLES.map((v) => (
                    <button key={v.key} type="button" onClick={() => insertVar(v.key)}
                      className="text-[11px] px-2 py-1 rounded-md bg-muted hover:bg-accent border border-border font-mono">
                      {v.key}
                    </button>
                  ))}
                </div>
                <Textarea value={message} onChange={(e) => setMessage(e.target.value)}
                  placeholder="Olá {primeiro_nome}, tudo bem? ..."
                  className="min-h-[180px] text-sm font-mono"/>
                <div className="space-y-1">
                  <Label className="text-xs flex items-center gap-1.5">
                    <ImageIcon size={12}/> URL de imagem (opcional)
                  </Label>
                  <Input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)}
                    placeholder="https://..." className="h-9 text-sm"/>
                </div>
                <div className="flex items-start gap-2 text-[11px] text-muted-foreground bg-muted/40 rounded-md p-2">
                  <Info size={12} className="mt-0.5 shrink-0"/>
                  <span>
                    Uma assinatura invisível (zero-width) é adicionada automaticamente a cada envio para variar
                    o hash da mensagem e reduzir detecção de spam.
                  </span>
                </div>
              </>
            ) : (
              <div className="rounded-md border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
                {flowId
                  ? <>O fluxo selecionado será iniciado para cada lead. O ritmo de envio dentro do fluxo segue as configurações do próprio fluxo.</>
                  : <>Escolha um fluxo do tipo <b>WhatsApp</b> acima.</>}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Footer / send */}
      <div className="flex flex-wrap items-center justify-between gap-3 sticky bottom-0 bg-background/95 backdrop-blur-sm border-t border-border py-3 -mx-1 px-1">
        <div className="text-xs text-muted-foreground">
          {selected.size} lead(s) · delay {delayMin}-{delayMax}s · ETA ≈ {eta}
        </div>
        <Button onClick={handleSend} disabled={sending || !accountId || selected.size === 0} size="lg">
          {sending ? <Loader2 size={16} className="mr-2 animate-spin"/> : <Send size={16} className="mr-2"/>}
          Iniciar disparo
        </Button>
      </div>

      <Dialog open={importOpen} onOpenChange={(o) => {
        setImportOpen(o);
        if (!o) queryClient.invalidateQueries({ queryKey: ["evolution-broadcast-leads"] });
      }}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Importar lista de disparo</DialogTitle>
          </DialogHeader>
          <ContactImporter
            saveButtonLabel="Salvar e selecionar para disparo"
            onImported={async (ids) => {
              await queryClient.invalidateQueries({ queryKey: ["evolution-broadcast-leads"] });
              setSelected(new Set(ids));
              setImportOpen(false);
              toast.success(`${ids.length} lead(s) importado(s) e selecionado(s) para disparo.`);
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
