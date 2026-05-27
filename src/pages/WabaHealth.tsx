import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Shield, CheckCircle2, AlertTriangle, ShieldAlert, Activity, MessageSquare, UserMinus, FlaskConical } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";


type Severity = "critical" | "warning" | "info";

interface Account {
  id: string;
  name: string | null;
  phone_number_id: string | null;
}

interface Snapshot {
  account_id: string;
  quality_rating: string | null;
  messaging_tier: string | null;
  messaging_limit: number | null;
  delivery_rate_24h: number | null;
  block_rate_24h: number | null;
  reputation_score: number | null;
  captured_at: string;
}

interface Event {
  id: string;
  account_id: string;
  event_title: string;
  event_message: string | null;
  severity: Severity;
  meta_error_code: string | null;
  created_at: string;
  resolved_at: string | null;
}

interface DeliveryStats {
  account_id: string;
  delivered: number;
  blocked: number;
  failed: number;
}

function statusColor(quality: string | null, hasCritical: boolean) {
  if (hasCritical) return { label: "Crítico", className: "bg-destructive text-destructive-foreground" };
  if (quality === "RED") return { label: "Vermelho", className: "bg-destructive text-destructive-foreground" };
  if (quality === "YELLOW") return { label: "Amarelo", className: "bg-warning text-warning-foreground" };
  if (quality === "GREEN") return { label: "Verde", className: "bg-revenue text-white" };
  return { label: "Desconhecido", className: "bg-muted text-muted-foreground" };
}

export default function WabaHealthPage() {
  const { user } = useAuth();

  const { data: accounts = [] } = useQuery({
    queryKey: ["wa-accounts", user?.id],
    queryFn: async () => {
      if (!user) return [] as Account[];
      const { data } = await supabase
        .from("whatsapp_accounts")
        .select("id, name, phone_number_id")
        .eq("user_id", user.id);
      return (data || []) as Account[];
    },
    enabled: !!user,
  });

  const { data: snapshots = [] } = useQuery({
    queryKey: ["waba-snapshots", user?.id],
    queryFn: async () => {
      if (!user) return [] as Snapshot[];
      const { data } = await supabase
        .from("waba_health_snapshots")
        .select("*")
        .eq("user_id", user.id)
        .order("captured_at", { ascending: false })
        .limit(50);
      return (data || []) as Snapshot[];
    },
    enabled: !!user,
    refetchInterval: 60_000,
  });

  const { data: events = [] } = useQuery({
    queryKey: ["waba-events-page", user?.id],
    queryFn: async () => {
      if (!user) return [] as Event[];
      const { data } = await supabase
        .from("waba_health_events")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(20);
      return (data || []) as Event[];
    },
    enabled: !!user,
    refetchInterval: 30_000,
  });

  const { data: deliveryByAccount = [] } = useQuery({
    queryKey: ["waba-delivery-stats", user?.id],
    queryFn: async () => {
      if (!user) return [] as DeliveryStats[];
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from("message_logs")
        .select("account_id, status")
        .eq("user_id", user.id)
        .gte("created_at", since);
      const map = new Map<string, DeliveryStats>();
      for (const row of (data || []) as { account_id: string | null; status: string }[]) {
        const k = row.account_id || "unknown";
        const cur = map.get(k) || { account_id: k, delivered: 0, blocked: 0, failed: 0 };
        if (row.status === "delivered" || row.status === "read") cur.delivered++;
        else if (row.status === "blocked_by_meta") cur.blocked++;
        else if (row.status === "failed") cur.failed++;
        map.set(k, cur);
      }
      return Array.from(map.values());
    },
    enabled: !!user,
    refetchInterval: 60_000,
  });

  const { data: unsubscribeStats } = useQuery({
    queryKey: ["unsubscribe-stats", user?.id],
    queryFn: async () => {
      if (!user) return { total: 0, last24h: 0, recent: [] as Array<{ phone: string; keyword_matched: string | null; created_at: string }> };
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const [{ count: total }, { count: last24h }, { data: recent }] = await Promise.all([
        supabase.from("unsubscribe_logs").select("id", { count: "exact", head: true }).eq("user_id", user.id),
        supabase.from("unsubscribe_logs").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", since),
        supabase.from("unsubscribe_logs").select("phone, keyword_matched, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(5),
      ]);
      return {
        total: total || 0,
        last24h: last24h || 0,
        recent: (recent || []) as Array<{ phone: string; keyword_matched: string | null; created_at: string }>,
      };
    },
    enabled: !!user,
    refetchInterval: 60_000,
  });

  // Anti-Ban v2 — Shadow validation analytics
  const { data: shadow } = useQuery({
    queryKey: ["antiban-shadow", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const [{ data: logs }, { data: profiles }, { data: enforceRow }] = await Promise.all([
        supabase
          .from("audit_logs")
          .select("record_id, details, created_at")
          .eq("user_id", user.id)
          .eq("action", "antiban_v2_risk_check")
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(500),
        supabase
          .from("campaign_risk_profiles")
          .select("campaign_id, risk_level, block_rate, unsubscribe_rate, delivery_rate")
          .eq("user_id", user.id),
        supabase.from("app_settings").select("value").eq("key", "antiban_v2_enforce_mode").maybeSingle(),
      ]);

      const all = logs || [];
      const flagged = all.filter((l: any) => l.details?.flagged);
      const passed = all.filter((l: any) => !l.details?.flagged);

      const scores = flagged
        .map((l: any) => l.details?.spam_snapshot?.spam_score)
        .filter((s: any) => typeof s === "number");
      const avgScore = scores.length ? Math.round(scores.reduce((a: number, b: number) => a + b, 0) / scores.length) : 0;

      const profileMap = new Map<string, any>();
      for (const p of profiles || []) profileMap.set(p.campaign_id, p);

      // Compare flagged campaigns to real outcomes
      let truePositive = 0;
      let falsePositive = 0;
      let trueNegative = 0;
      let falseNegative = 0;
      let blockedSum = 0;
      let unsubSum = 0;
      let blockedSamples = 0;

      const seen = new Set<string>();
      for (const l of all) {
        const cid = l.record_id;
        if (!cid || seen.has(cid)) continue;
        seen.add(cid);
        const p = profileMap.get(cid);
        if (!p) continue;
        const realBad = p.risk_level === "high" || p.risk_level === "critical";
        const flag = (l as any).details?.flagged;
        if (flag && realBad) truePositive++;
        else if (flag && !realBad) falsePositive++;
        else if (!flag && realBad) falseNegative++;
        else trueNegative++;
        if (flag) {
          blockedSum += Number(p.block_rate || 0);
          unsubSum += Number(p.unsubscribe_rate || 0);
          blockedSamples++;
        }
      }

      const correlationBlock = blockedSamples ? +(blockedSum / blockedSamples).toFixed(2) : 0;
      const correlationUnsub = blockedSamples ? +(unsubSum / blockedSamples).toFixed(2) : 0;
      const fpRate = (truePositive + falsePositive) > 0
        ? Math.round((falsePositive / (truePositive + falsePositive)) * 100)
        : 0;

      // Top triggered rules
      const ruleCount: Record<string, number> = {};
      for (const l of flagged) {
        const rules = ((l as any).details?.triggered_rules || []) as string[];
        for (const r of rules) ruleCount[r] = (ruleCount[r] || 0) + 1;
      }
      const topRules = Object.entries(ruleCount).sort((a, b) => b[1] - a[1]).slice(0, 5);

      return {
        mode: enforceRow?.value || "shadow",
        total: all.length,
        flagged: flagged.length,
        passed: passed.length,
        avgScore,
        truePositive,
        falsePositive,
        trueNegative,
        falseNegative,
        fpRate,
        correlationBlock,
        correlationUnsub,
        topRules,
        recent: flagged.slice(0, 5),
      };
    },
    enabled: !!user,
    refetchInterval: 60_000,
  });



  const latestSnapshotByAccount = new Map<string, Snapshot>();
  for (const s of snapshots) {
    if (!latestSnapshotByAccount.has(s.account_id)) latestSnapshotByAccount.set(s.account_id, s);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold flex items-center gap-2">
          <Shield className="text-primary" size={24} /> Saúde da WABA
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Monitoramento em tempo real da qualidade, entrega e reputação das suas contas WhatsApp.
        </p>
      </div>

      {accounts.length === 0 && (
        <Card className="p-8 text-center text-muted-foreground">
          Nenhuma conta WhatsApp conectada.
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {accounts.map((acc) => {
          const snap = latestSnapshotByAccount.get(acc.id);
          const stats = deliveryByAccount.find((d) => d.account_id === acc.id) ||
            { delivered: 0, blocked: 0, failed: 0 } as DeliveryStats;
          const totalAttempts = stats.delivered + stats.blocked + stats.failed;
          const deliveryRate = totalAttempts ? Math.round((stats.delivered / totalAttempts) * 100) : null;
          const blockRate = totalAttempts ? Math.round((stats.blocked / totalAttempts) * 100) : 0;
          const hasCritical = events.some(
            (e) => e.account_id === acc.id && e.severity === "critical" && !e.resolved_at,
          );
          const color = statusColor(snap?.quality_rating || null, hasCritical);

          return (
            <Card key={acc.id} className="p-5 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold leading-tight">{acc.name || "Conta sem nome"}</p>
                  <p className="text-xs text-muted-foreground">{acc.phone_number_id || "—"}</p>
                </div>
                <span className={cn("text-[11px] font-bold px-2 py-1 rounded", color.className)}>
                  {color.label}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-md bg-muted/40 p-2">
                  <p className="text-[10px] uppercase text-muted-foreground">Qualidade</p>
                  <p className="text-sm font-semibold mt-1">{snap?.quality_rating || "—"}</p>
                </div>
                <div className="rounded-md bg-muted/40 p-2">
                  <p className="text-[10px] uppercase text-muted-foreground">Tier</p>
                  <p className="text-sm font-semibold mt-1">{snap?.messaging_tier || "—"}</p>
                </div>
                <div className="rounded-md bg-muted/40 p-2">
                  <p className="text-[10px] uppercase text-muted-foreground">Limite</p>
                  <p className="text-sm font-semibold mt-1">{snap?.messaging_limit?.toLocaleString("pt-BR") || "—"}</p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-md border p-2">
                  <p className="text-[10px] uppercase text-muted-foreground">Entrega 24h</p>
                  <p className={cn("text-sm font-semibold mt-1", deliveryRate != null && deliveryRate < 70 && "text-destructive")}>
                    {deliveryRate != null ? `${deliveryRate}%` : "—"}
                  </p>
                </div>
                <div className="rounded-md border p-2">
                  <p className="text-[10px] uppercase text-muted-foreground">Bloqueio 24h</p>
                  <p className={cn("text-sm font-semibold mt-1", blockRate > 5 && "text-destructive")}>
                    {totalAttempts ? `${blockRate}%` : "—"}
                  </p>
                </div>
                <div className="rounded-md border p-2">
                  <p className="text-[10px] uppercase text-muted-foreground">Mensagens</p>
                  <p className="text-sm font-semibold mt-1">{totalAttempts.toLocaleString("pt-BR")}</p>
                </div>
              </div>

              {hasCritical && (
                <div className="rounded-md bg-destructive/10 border border-destructive/30 p-3 text-xs">
                  <p className="font-semibold flex items-center gap-1 text-destructive">
                    <ShieldAlert size={14} /> Proteção automática ativa
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    Pausamos campanhas e fluxos desta conta. Acesse o Meta Business Suite → Account Quality
                    → Solicitar revisão.
                  </p>
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <Card className="p-5">
        <h2 className="font-semibold flex items-center gap-2 mb-3">
          <Activity size={16} /> Histórico de eventos
        </h2>
        {events.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
            <CheckCircle2 size={16} className="text-revenue" /> Nenhum evento registrado. Tudo operando bem.
          </div>
        ) : (
          <ul className="space-y-2">
            {events.map((e) => (
              <li
                key={e.id}
                className={cn(
                  "rounded-md border p-3 text-sm flex items-start gap-3",
                  e.severity === "critical" && "border-destructive/30 bg-destructive/5",
                  e.severity === "warning" && "border-warning/40 bg-warning/5",
                )}
              >
                {e.severity === "critical" ? (
                  <ShieldAlert size={16} className="text-destructive mt-0.5" />
                ) : (
                  <AlertTriangle size={16} className="text-warning mt-0.5" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-medium">{e.event_title}</p>
                  {e.event_message && (
                    <p className="text-xs text-muted-foreground mt-0.5">{e.event_message}</p>
                  )}
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {formatDistanceToNow(new Date(e.created_at), { addSuffix: true, locale: ptBR })}
                    {e.meta_error_code && ` · código Meta ${e.meta_error_code}`}
                    {e.resolved_at && " · resolvido"}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <h2 className="font-semibold flex items-center gap-2">
            <UserMinus size={16} /> Descadastros automáticos
          </h2>
          <div className="flex gap-3 text-xs">
            <div className="text-right">
              <p className="text-muted-foreground">24h</p>
              <p className="font-semibold text-base">{unsubscribeStats?.last24h ?? 0}</p>
            </div>
            <div className="text-right">
              <p className="text-muted-foreground">Total</p>
              <p className="font-semibold text-base">{unsubscribeStats?.total ?? 0}</p>
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Detectamos palavras como <i>sair</i>, <i>parar</i>, <i>cancelar</i>, <i>descadastrar</i> nas respostas e removemos
          o contato automaticamente das campanhas e fluxos.
        </p>
        {(!unsubscribeStats || unsubscribeStats.recent.length === 0) ? (
          <div className="text-xs text-muted-foreground italic">Nenhum descadastro registrado ainda.</div>
        ) : (
          <ul className="space-y-1.5 text-xs">
            {unsubscribeStats.recent.map((r, i) => (
              <li key={i} className="flex items-center justify-between border-b border-border/40 pb-1.5 last:border-0">
                <span className="font-mono">{r.phone}</span>
                <span className="text-muted-foreground">
                  "{r.keyword_matched}" · {formatDistanceToNow(new Date(r.created_at), { addSuffix: true, locale: ptBR })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>


      <Card className="p-5 bg-primary/5 border-primary/20">
        <h2 className="font-semibold flex items-center gap-2 mb-2">
          <MessageSquare size={16} /> Recomendações
        </h2>
        <ul className="text-sm text-muted-foreground space-y-1 list-disc pl-5">
          <li>Mantenha respostas rápidas — taxa de resposta alta melhora a qualidade da WABA.</li>
          <li>Evite enviar mensagens iguais para muitos números em pouco tempo.</li>
          <li>Use templates da categoria <b>UTILITY</b> sempre que possível.</li>
          <li>Em caso de bloqueio, abra o Meta Business Suite → Account Quality → Solicitar revisão.</li>
          <li>Ative o modo de aquecimento (warmup) para números novos.</li>
        </ul>
      </Card>
    </div>
  );
}
