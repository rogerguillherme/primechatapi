import { useMemo, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  History, Loader2, Layers, Send, AlertCircle, Clock, ChevronRight,
  Play, Pause, Trash2, X, ShieldAlert, Wrench,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import {
  STATUS_LABEL, STATUS_CLASSE, logActivity,
  type PgCampaign, type PgTarget, type CampaignStatus,
} from "@/lib/prime-group";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";

const FILTROS: { chave: "todas" | CampaignStatus; rotulo: string }[] = [
  { chave: "todas", rotulo: "Todas" },
  { chave: "agendada", rotulo: "Agendadas" },
  { chave: "enviando", rotulo: "Enviando" },
  { chave: "concluida", rotulo: "Concluídas" },
  { chave: "rascunho", rotulo: "Rascunhos" },
  { chave: "falhou", rotulo: "Falhou" },
];

/** Histórico de campanhas — lista tudo de pg_campaigns com filtro por status e
 *  detalhe por grupo (pg_campaign_targets) num painel lateral. */
export default function PrimeGroupHistory() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [filtro, setFiltro] = useState<"todas" | CampaignStatus>("todas");
  const [aberta, setAberta] = useState<PgCampaign | null>(null);

  const { data: campanhas = [], isLoading } = useQuery({
    queryKey: ["pg-campaigns"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("pg_campaigns").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PgCampaign[];
    },
  });

  const visiveis = useMemo(
    () => filtro === "todas" ? campanhas : campanhas.filter((c) => c.status === filtro),
    [campanhas, filtro],
  );

  const mudarStatus = useMutation({
    mutationFn: async ({ id, status, nome }: { id: string; status: CampaignStatus; nome: string }) => {
      const { error } = await (supabase as any).from("pg_campaigns").update({ status }).eq("id", id);
      if (error) throw error;
      await logActivity({ type: "info", title: `Campanha "${nome}" → ${STATUS_LABEL[status]}`, campaign_id: id });
      // "Agendar"/"Retomar" mandam pra 'agendada' — aciona o motor na hora em
      // vez de esperar o heartbeat de 1 min do cron.
      if (status === "agendada") {
        supabase.functions.invoke("pg-campaign-dispatch", { body: { campaign_id: id } }).catch(() => {});
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["pg-campaigns"] }); toast.success("Status atualizado."); },
    onError: (e: any) => toast.error(e?.message || "Erro ao atualizar."),
  });

  const excluir = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("pg_campaigns").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["pg-campaigns"] }); setAberta(null); toast.success("Campanha excluída."); },
    onError: (e: any) => toast.error(e?.message || "Erro ao excluir."),
  });

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold flex items-center gap-2">
          <History className="h-6 w-6 text-primary" /> Histórico
        </h1>
        <p className="text-sm text-muted-foreground">Todas as campanhas e seus resultados por grupo</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTROS.map((f) => (
          <button key={f.chave} onClick={() => setFiltro(f.chave)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
              filtro === f.chave ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"
            }`}>
            {f.rotulo}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando…
        </div>
      ) : visiveis.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground">
          <History className="h-10 w-10 mx-auto text-muted-foreground/40" />
          <p className="mt-3">Nenhuma campanha {filtro !== "todas" ? "nesse filtro" : "ainda"}.</p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="divide-y divide-border">
            {visiveis.map((c) => {
              const feitos = c.sent_count + c.error_count;
              const prog = c.total_targets > 0 ? Math.round((feitos / c.total_targets) * 100) : 0;
              return (
                <button key={c.id} onClick={() => setAberta(c)}
                  className="w-full flex items-center gap-4 px-5 py-4 hover:bg-muted/30 transition-colors text-left">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{c.name}</span>
                      <span className={`shrink-0 text-[10px] font-semibold uppercase px-2 py-0.5 rounded ${STATUS_CLASSE[c.status]}`}>
                        {STATUS_LABEL[c.status]}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Layers className="h-3.5 w-3.5" />{c.total_targets}</span>
                      <span className="flex items-center gap-1 text-emerald-600"><Send className="h-3.5 w-3.5" />{c.sent_count}</span>
                      {c.error_count > 0 && <span className="flex items-center gap-1 text-red-600"><AlertCircle className="h-3.5 w-3.5" />{c.error_count}</span>}
                      <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{new Date(c.created_at).toLocaleDateString("pt-BR")}</span>
                    </div>
                    {c.total_targets > 0 && <Progress value={prog} className="mt-2 h-1.5 max-w-xs" />}
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </button>
              );
            })}
          </div>
        </Card>
      )}

      <DetalheCampanha
        campanha={aberta}
        onClose={() => setAberta(null)}
        onMudarStatus={(status) => aberta && mudarStatus.mutate({ id: aberta.id, status, nome: aberta.name })}
        onExcluir={() => aberta && excluir.mutate(aberta.id)}
        onCorrigir={() => aberta && navigate(`/prime-group/campanha?corrigir=${aberta.id}`)}
        ocupado={mudarStatus.isPending || excluir.isPending}
      />
    </div>
  );
}

function DetalheCampanha({
  campanha, onClose, onMudarStatus, onExcluir, onCorrigir, ocupado,
}: {
  campanha: PgCampaign | null; onClose: () => void;
  onMudarStatus: (s: CampaignStatus) => void; onExcluir: () => void; onCorrigir: () => void; ocupado: boolean;
}) {
  const { data: alvos = [], isLoading } = useQuery({
    queryKey: ["pg-targets", campanha?.id],
    enabled: !!campanha,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("pg_campaign_targets").select("*").eq("campaign_id", campanha!.id).order("group_name");
      if (error) throw error;
      return (data ?? []) as PgTarget[];
    },
  });

  const foraDePadrao = alvos.filter((a) => a.check_status === "fora_padrao");

  return (
    <Sheet open={!!campanha} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        {campanha && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                {campanha.name}
                <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded ${STATUS_CLASSE[campanha.status]}`}>
                  {STATUS_LABEL[campanha.status]}
                </span>
              </SheetTitle>
              <SheetDescription>
                {campanha.total_targets} grupos • {campanha.sent_count} enviados • {campanha.error_count} erros
                {campanha.scheduled_at && ` • agendada p/ ${new Date(campanha.scheduled_at).toLocaleString("pt-BR")}`}
              </SheetDescription>
            </SheetHeader>

            {campanha.message && (
              <div className="mt-4 rounded-lg bg-muted/40 p-3 text-sm whitespace-pre-wrap">{campanha.message}</div>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              {(campanha.status === "agendada" || campanha.status === "pausada") && (
                <Button size="sm" variant="outline" disabled={ocupado} onClick={() => onMudarStatus("pausada")}>
                  <Pause className="h-3.5 w-3.5 mr-1" /> Pausar
                </Button>
              )}
              {campanha.status === "pausada" && (
                <Button size="sm" variant="outline" disabled={ocupado} onClick={() => onMudarStatus("agendada")}>
                  <Play className="h-3.5 w-3.5 mr-1" /> Retomar
                </Button>
              )}
              {campanha.status === "rascunho" && (
                <Button size="sm" disabled={ocupado} onClick={() => onMudarStatus("agendada")}>
                  <Play className="h-3.5 w-3.5 mr-1" /> Agendar
                </Button>
              )}
              {foraDePadrao.length > 0 && (
                <Button size="sm" variant="outline" className="text-amber-700 border-amber-300 hover:bg-amber-50" disabled={ocupado} onClick={onCorrigir}>
                  <Wrench className="h-3.5 w-3.5 mr-1" /> Corrigir {foraDePadrao.length} grupo(s)
                </Button>
              )}
              <Button size="sm" variant="ghost" className="text-red-600 hover:text-red-700" disabled={ocupado} onClick={onExcluir}>
                <Trash2 className="h-3.5 w-3.5 mr-1" /> Excluir
              </Button>
              <Button size="sm" variant="ghost" onClick={onClose}><X className="h-3.5 w-3.5 mr-1" /> Fechar</Button>
            </div>

            {foraDePadrao.length > 0 && (
              <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-500/5 border border-amber-500/20 p-3 text-xs text-amber-700 dark:text-amber-300">
                <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  A conferência pós-envio achou {foraDePadrao.length} grupo(s) fora de padrão mesmo com a Evolution
                  confirmando o envio. Veja o motivo passando o mouse no selo de cada grupo abaixo, ou clique em
                  "Corrigir" pra reabrir a campanha pré-preenchida só pra eles.
                </span>
              </div>
            )}

            <div className="mt-5">
              <h4 className="text-sm font-semibold mb-2">Grupos ({alvos.length})</h4>
              {isLoading ? (
                <div className="py-8 text-center text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline mr-2" />Carregando…</div>
              ) : (
                <div className="border border-border rounded-lg divide-y divide-border">
                  {alvos.map((a) => (
                    <div key={a.id} className="flex items-center justify-between gap-2 px-3 py-2.5 text-sm">
                      <span className="truncate flex-1">{a.group_name}</span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <CheckBadge status={a.check_status} detalhe={a.check_detail} />
                        <AlvoBadge status={a.status} erro={a.error} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function AlvoBadge({ status, erro }: { status: PgTarget["status"]; erro: string | null }) {
  const cfg = {
    pendente: { t: "Pendente", c: "bg-muted text-muted-foreground" },
    enviado: { t: "Enviado", c: "bg-emerald-500/10 text-emerald-600" },
    erro: { t: "Erro", c: "bg-red-500/10 text-red-600" },
  }[status];
  return <span title={erro || undefined} className={`shrink-0 text-[10px] font-semibold uppercase px-2 py-0.5 rounded ${cfg.c}`}>{cfg.t}</span>;
}

/** Resultado da conferência pós-envio (pg-campaign-audit) — só aparece depois
 *  que a campanha termina e a auditoria roda; "pendente" fica sem selo. */
function CheckBadge({ status, detalhe }: { status: PgTarget["check_status"]; detalhe: string | null }) {
  if (status === "pendente") return null;
  const cfg = {
    ok: { t: "Conferido", c: "bg-emerald-500/10 text-emerald-600" },
    fora_padrao: { t: "Fora de padrão", c: "bg-amber-500/10 text-amber-700" },
    erro_checagem: { t: "Não conferido", c: "bg-muted text-muted-foreground" },
  }[status];
  return <span title={detalhe || undefined} className={`shrink-0 text-[10px] font-semibold uppercase px-2 py-0.5 rounded ${cfg.c}`}>{cfg.t}</span>;
}
