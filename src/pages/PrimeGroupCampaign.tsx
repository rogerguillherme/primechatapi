import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  Megaphone, Plus, Loader2, Smartphone, Layers, Search, Send, Save,
  CalendarClock, Info, Users2,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  logActivity, STATUS_LABEL, STATUS_CLASSE,
  type PgCampaign, type CampaignStatus,
} from "@/lib/prime-group";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

interface Instancia { id: string; name: string; status: string | null; display_phone_number: string | null; }
interface Grupo { id: string; group_jid: string; name: string; participants_count: number; }

/**
 * Campanhas do Prime Group — cria um disparo pra vários grupos a partir de UMA
 * instância, com intervalo anti-ban. Grava em pg_campaigns + pg_campaign_targets.
 * O motor de envio (Evolution) é a fase final; aqui a campanha nasce agendada.
 */
export default function PrimeGroupCampaign() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [aberto, setAberto] = useState(false);

  const { data: campanhas = [], isLoading } = useQuery({
    queryKey: ["pg-campaigns"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("pg_campaigns").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PgCampaign[];
    },
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold flex items-center gap-2">
            <Megaphone className="h-6 w-6 text-primary" /> Campanhas
          </h1>
          <p className="text-sm text-muted-foreground">Disparos para grupos de WhatsApp em escala</p>
        </div>
        <Dialog open={aberto} onOpenChange={setAberto}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-1.5" /> Nova campanha</Button>
          </DialogTrigger>
          <NovaCampanha userId={user?.id} onDone={() => { setAberto(false); qc.invalidateQueries({ queryKey: ["pg-campaigns"] }); }} />
        </Dialog>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando…
        </div>
      ) : campanhas.length === 0 ? (
        <Card className="p-12 text-center">
          <Megaphone className="h-10 w-10 mx-auto text-muted-foreground/40" />
          <p className="mt-3 font-medium">Nenhuma campanha ainda</p>
          <p className="text-sm text-muted-foreground mt-1">Crie a primeira para disparar para seus grupos.</p>
          <Button className="mt-4" onClick={() => setAberto(true)}><Plus className="h-4 w-4 mr-1.5" /> Nova campanha</Button>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {campanhas.map((c) => {
            const prog = c.total_targets > 0 ? Math.round(((c.sent_count + c.error_count) / c.total_targets) * 100) : 0;
            return (
              <Card key={c.id} className="p-5 hover:shadow-elevated transition-shadow cursor-pointer"
                onClick={() => navigate("/prime-group/historico")}>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold leading-tight">{c.name}</h3>
                  <StatusBadge status={c.status} />
                </div>
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2 min-h-[2rem]">{c.message || "— sem mensagem —"}</p>
                <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><Layers className="h-3.5 w-3.5" /> {c.total_targets} grupos</span>
                  <span className="flex items-center gap-1 text-emerald-600"><Send className="h-3.5 w-3.5" /> {c.sent_count}</span>
                  {c.error_count > 0 && <span className="text-red-600">{c.error_count} erros</span>}
                </div>
                {c.total_targets > 0 && <Progress value={prog} className="mt-3 h-1.5" />}
                {c.scheduled_at && (
                  <p className="mt-2 text-[11px] text-muted-foreground flex items-center gap-1">
                    <CalendarClock className="h-3 w-3" /> {new Date(c.scheduled_at).toLocaleString("pt-BR")}
                  </p>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: CampaignStatus }) {
  return (
    <span className={`shrink-0 text-[10px] font-semibold uppercase px-2 py-0.5 rounded ${STATUS_CLASSE[status] ?? "bg-muted text-muted-foreground"}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Diálogo de criação
// ---------------------------------------------------------------------------
function NovaCampanha({ userId, onDone }: { userId?: string; onDone: () => void }) {
  const [nome, setNome] = useState("");
  const [instancia, setInstancia] = useState<string>("");
  const [selecionados, setSelecionados] = useState<Record<string, boolean>>({});
  const [busca, setBusca] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [midiaUrl, setMidiaUrl] = useState("");
  const [midiaTipo, setMidiaTipo] = useState<string>("nenhuma");
  const [intMin, setIntMin] = useState(8);
  const [intMax, setIntMax] = useState(25);
  const [agendar, setAgendar] = useState(false);
  const [quando, setQuando] = useState("");

  const { data: instancias = [] } = useQuery({
    queryKey: ["pg-instances-select"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("whatsapp_accounts")
        .select("id, name, status, display_phone_number")
        .eq("provider", "evolution").order("name");
      if (error) throw error;
      return (data ?? []) as Instancia[];
    },
  });

  const { data: grupos = [], isLoading: carregandoGrupos } = useQuery({
    queryKey: ["pg-groups-for", instancia],
    enabled: !!instancia,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("whatsapp_groups")
        .select("id, group_jid, name, participants_count")
        .eq("account_id", instancia)
        .order("name");
      if (error) throw error;
      return (data ?? []) as Grupo[];
    },
  });

  const gruposFiltrados = useMemo(
    () => grupos.filter((g) => g.name.toLowerCase().includes(busca.toLowerCase())),
    [grupos, busca],
  );
  const totalSelecionados = useMemo(
    () => grupos.filter((g) => selecionados[g.id]).length,
    [grupos, selecionados],
  );
  const alcance = useMemo(
    () => grupos.filter((g) => selecionados[g.id]).reduce((s, g) => s + (g.participants_count || 0), 0),
    [grupos, selecionados],
  );

  function alternarTodos() {
    const todos = gruposFiltrados.every((g) => selecionados[g.id]);
    const novo = { ...selecionados };
    for (const g of gruposFiltrados) novo[g.id] = !todos;
    setSelecionados(novo);
  }

  const salvar = useMutation({
    mutationFn: async (enviar: boolean) => {
      if (!userId) throw new Error("Sessão expirada — entre novamente.");
      if (!nome.trim()) throw new Error("Dê um nome para a campanha.");
      if (!instancia) throw new Error("Escolha a instância que vai disparar.");
      const alvos = grupos.filter((g) => selecionados[g.id]);
      if (alvos.length === 0) throw new Error("Selecione ao menos um grupo.");
      if (!mensagem.trim() && midiaTipo === "nenhuma") throw new Error("Escreva a mensagem ou anexe uma mídia.");
      if (enviar && agendar && !quando) throw new Error("Escolha a data/hora do agendamento.");

      const status: CampaignStatus = enviar ? "agendada" : "rascunho";
      const scheduled_at = enviar ? (agendar ? new Date(quando).toISOString() : new Date().toISOString()) : null;

      const { data: camp, error: e1 } = await (supabase as any).from("pg_campaigns").insert({
        user_id: userId,
        account_id: instancia,
        name: nome.trim(),
        message: mensagem,
        media_url: midiaTipo === "nenhuma" ? null : (midiaUrl.trim() || null),
        media_type: midiaTipo === "nenhuma" ? null : midiaTipo,
        status,
        scheduled_at,
        interval_min: intMin,
        interval_max: intMax,
        total_targets: alvos.length,
      }).select("id").single();
      if (e1) throw e1;

      const rows = alvos.map((g) => ({
        campaign_id: camp.id, user_id: userId,
        group_id: g.id, group_jid: g.group_jid, group_name: g.name,
      }));
      const { error: e2 } = await (supabase as any).from("pg_campaign_targets").insert(rows);
      if (e2) throw e2;

      await logActivity({
        type: enviar ? "agendada" : "campanha_criada",
        title: enviar ? `Campanha "${nome.trim()}" agendada` : `Rascunho "${nome.trim()}" criado`,
        detail: `${alvos.length} grupos • alcance estimado ${alcance.toLocaleString("pt-BR")}`,
        campaign_id: camp.id,
      });
      return enviar;
    },
    onSuccess: (enviar) => {
      toast.success(enviar
        ? "Campanha agendada. O envio começa quando o motor Evolution for ativado (fase final)."
        : "Rascunho salvo.");
      onDone();
    },
    onError: (e: any) => toast.error(e?.message || "Não foi possível salvar."),
  });

  return (
    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Nova campanha</DialogTitle>
        <DialogDescription>Dispare a mesma mensagem para vários grupos, com intervalo anti-ban.</DialogDescription>
      </DialogHeader>

      <div className="space-y-5 py-2">
        <div className="space-y-1.5">
          <Label>Nome da campanha</Label>
          <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Promoção de setembro" />
        </div>

        <div className="space-y-1.5">
          <Label className="flex items-center gap-1.5"><Smartphone className="h-4 w-4" /> Instância</Label>
          <Select value={instancia} onValueChange={(v) => { setInstancia(v); setSelecionados({}); }}>
            <SelectTrigger><SelectValue placeholder="Escolha a conexão que vai disparar" /></SelectTrigger>
            <SelectContent>
              {instancias.map((i) => (
                <SelectItem key={i.id} value={i.id}>
                  {i.name} {i.display_phone_number ? `· ${i.display_phone_number}` : ""} {i.status !== "online" ? "(offline)" : ""}
                </SelectItem>
              ))}
              {instancias.length === 0 && <div className="px-2 py-2 text-xs text-muted-foreground">Nenhuma instância. Crie em Instâncias.</div>}
            </SelectContent>
          </Select>
        </div>

        {instancia && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-1.5"><Layers className="h-4 w-4" /> Grupos ({totalSelecionados} selecionados)</Label>
              {gruposFiltrados.length > 0 && (
                <button type="button" onClick={alternarTodos} className="text-xs text-primary hover:underline">
                  {gruposFiltrados.every((g) => selecionados[g.id]) ? "Limpar" : "Selecionar todos"}
                </button>
              )}
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar grupo…" className="pl-8" />
            </div>
            <div className="border border-border rounded-lg max-h-52 overflow-y-auto divide-y divide-border">
              {carregandoGrupos ? (
                <div className="p-4 text-center text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline mr-2" />Carregando grupos…</div>
              ) : gruposFiltrados.length === 0 ? (
                <div className="p-4 text-center text-sm text-muted-foreground">Nenhum grupo. Sincronize os grupos da instância primeiro.</div>
              ) : gruposFiltrados.map((g) => (
                <label key={g.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/30 cursor-pointer">
                  <Checkbox checked={!!selecionados[g.id]} onCheckedChange={(v) => setSelecionados((s) => ({ ...s, [g.id]: !!v }))} />
                  <span className="flex-1 text-sm truncate">{g.name}</span>
                  <span className="text-xs text-muted-foreground flex items-center gap-1 shrink-0"><Users2 className="h-3 w-3" />{g.participants_count}</span>
                </label>
              ))}
            </div>
            {totalSelecionados > 0 && (
              <p className="text-xs text-muted-foreground">Alcance estimado: <strong>{alcance.toLocaleString("pt-BR")}</strong> membros</p>
            )}
          </div>
        )}

        <div className="space-y-1.5">
          <Label>Mensagem</Label>
          <Textarea value={mensagem} onChange={(e) => setMensagem(e.target.value)} rows={4}
            placeholder="Escreva a mensagem que será enviada aos grupos…" />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5 col-span-1">
            <Label>Mídia</Label>
            <Select value={midiaTipo} onValueChange={setMidiaTipo}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="nenhuma">Nenhuma</SelectItem>
                <SelectItem value="image">Imagem</SelectItem>
                <SelectItem value="video">Vídeo</SelectItem>
                <SelectItem value="document">Documento</SelectItem>
                <SelectItem value="audio">Áudio</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {midiaTipo !== "nenhuma" && (
            <div className="space-y-1.5 col-span-2">
              <Label>URL da mídia</Label>
              <Input value={midiaUrl} onChange={(e) => setMidiaUrl(e.target.value)} placeholder="https://…" />
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Intervalo mín. (s)</Label>
            <Input type="number" min={1} value={intMin} onChange={(e) => setIntMin(Math.max(1, +e.target.value || 1))} />
          </div>
          <div className="space-y-1.5">
            <Label>Intervalo máx. (s)</Label>
            <Input type="number" min={1} value={intMax} onChange={(e) => setIntMax(Math.max(intMin, +e.target.value || intMin))} />
          </div>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border p-3">
          <div className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm">Agendar para depois</span>
          </div>
          <Switch checked={agendar} onCheckedChange={setAgendar} />
        </div>
        {agendar && (
          <Input type="datetime-local" value={quando} onChange={(e) => setQuando(e.target.value)} />
        )}

        <div className="flex items-start gap-2 rounded-lg bg-sky-500/5 border border-sky-500/20 p-3 text-xs text-sky-700 dark:text-sky-300">
          <Info className="h-4 w-4 shrink-0 mt-0.5" />
          <span>A campanha é criada e agendada agora. O <strong>envio real via Evolution</strong> é a última etapa do módulo — assim que ativado, as campanhas agendadas começam a disparar automaticamente.</span>
        </div>
      </div>

      <DialogFooter className="gap-2">
        <Button variant="outline" disabled={salvar.isPending} onClick={() => salvar.mutate(false)}>
          {salvar.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Save className="h-4 w-4 mr-1.5" />} Salvar rascunho
        </Button>
        <Button disabled={salvar.isPending} onClick={() => salvar.mutate(true)}>
          {salvar.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <CalendarClock className="h-4 w-4 mr-1.5" />} Agendar campanha
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
