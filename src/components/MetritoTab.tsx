import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Megaphone, DollarSign, Users, Target, AlertCircle } from "lucide-react";
import { format, subDays } from "date-fns";
import { ptBR } from "date-fns/locale";

type PeriodFilter = "7d" | "14d" | "30d";

const PERIOD_DAYS: Record<PeriodFilter, number> = { "7d": 7, "14d": 14, "30d": 30 };

type Source = "meta_ads" | "google_ads" | "tiktok_ads";

// Nomes de campo do Metrito. Se o projeto do Roger usar outros, dá para
// descobrir os disponíveis com { action: "fields" } na mesma edge function.
const FIELDS = ["spend", "leads", "date"];

interface DayRow {
  date: string;
  spend: number;
  leads: number;
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
}

/** O Metrito devolve as chaves com prefixo do cubo (ex: "meta_ads.spend"). */
function pick(row: Record<string, unknown>, name: string): unknown {
  if (row[name] != null) return row[name];
  const key = Object.keys(row).find((k) => k.split(".").pop() === name);
  return key ? row[key] : undefined;
}

export function MetritoTab() {
  const { user } = useAuth();
  const [period, setPeriod] = useState<PeriodFilter>("7d");
  const [source, setSource] = useState<Source>("meta_ads");

  const { start, end } = useMemo(() => {
    const now = new Date();
    return {
      start: format(subDays(now, PERIOD_DAYS[period]), "yyyy-MM-dd"),
      end: format(now, "yyyy-MM-dd"),
    };
  }, [period]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["metrito-metrics", user?.id, period, source],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("metrito-metrics", {
        body: {
          action: "query",
          fields: FIELDS,
          source,
          time: { start, end, granularity: "day" },
          order: { date: "asc" },
          limit: 500,
        },
      });
      if (error) throw error;
      return data as { data?: Record<string, unknown>[]; currency?: string; error?: string; configured?: boolean };
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000, // dados do Metrito sincronizam a cada 5-30min
  });

  const rows: DayRow[] = useMemo(() => {
    return (data?.data || [])
      .map((r) => ({
        date: String(pick(r, "date") ?? "").slice(0, 10),
        spend: num(pick(r, "spend")),
        leads: num(pick(r, "leads")),
      }))
      .filter((r) => r.date);
  }, [data]);

  const totals = useMemo(() => {
    const spend = rows.reduce((s, r) => s + r.spend, 0);
    const leads = rows.reduce((s, r) => s + r.leads, 0);
    return { spend, leads, cpl: leads > 0 ? spend / leads : 0 };
  }, [rows]);

  const currency = data?.currency || "BRL";
  const money = (v: number) =>
    v.toLocaleString("pt-BR", { style: "currency", currency, maximumFractionDigits: 2 });

  const notConfigured = data?.configured === false;
  const maxSpend = Math.max(...rows.map((r) => r.spend), 1);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Megaphone size={20} />
            Tráfego Pago
          </h2>
          <p className="text-sm text-muted-foreground">
            Investimento e custo por lead, direto do Metrito
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={source} onValueChange={(v) => setSource(v as Source)}>
            <SelectTrigger className="w-32 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="meta_ads">Meta Ads</SelectItem>
              <SelectItem value="google_ads">Google Ads</SelectItem>
              <SelectItem value="tiktok_ads">TikTok Ads</SelectItem>
            </SelectContent>
          </Select>
          <Select value={period} onValueChange={(v) => setPeriod(v as PeriodFilter)}>
            <SelectTrigger className="w-36 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Últimos 7 dias</SelectItem>
              <SelectItem value="14d">Últimos 14 dias</SelectItem>
              <SelectItem value="30d">Últimos 30 dias</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {notConfigured && (
        <Card className="border-warning/40 bg-warning/5">
          <CardContent className="py-4 flex items-start gap-3">
            <AlertCircle size={18} className="text-warning mt-0.5 shrink-0" />
            <div className="text-sm">
              <p className="font-medium">Metrito ainda não configurado</p>
              <p className="text-muted-foreground">
                Cadastre os secrets <code className="text-xs">METRITO_API_KEY</code> e{" "}
                <code className="text-xs">METRITO_PROJECT_ID</code> para liberar esta aba.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {error && !notConfigured && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="py-4 flex items-start gap-3">
            <AlertCircle size={18} className="text-destructive mt-0.5 shrink-0" />
            <p className="text-sm">Não foi possível carregar as métricas do Metrito.</p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <DollarSign size={16} className="text-blue-500" />
              </div>
              Investimento
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{isLoading ? "—" : money(totals.spend)}</p>
            <p className="text-xs text-muted-foreground mt-1">{rows.length} dias com dados</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-purple-500/10 flex items-center justify-center">
                <Users size={16} className="text-purple-500" />
              </div>
              Leads
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {isLoading ? "—" : totals.leads.toLocaleString("pt-BR")}
            </p>
            <p className="text-xs text-muted-foreground mt-1">no período selecionado</p>
          </CardContent>
        </Card>

        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <Target size={16} className="text-primary" />
              </div>
              CPL médio
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{isLoading ? "—" : money(totals.cpl)}</p>
            <p className="text-xs text-muted-foreground mt-1">investimento ÷ leads</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Por dia</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Carregando…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Sem dados para o período.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground border-b">
                    <th className="text-left font-medium py-2">Dia</th>
                    <th className="text-right font-medium py-2">Investimento</th>
                    <th className="text-right font-medium py-2">Leads</th>
                    <th className="text-right font-medium py-2">CPL</th>
                    <th className="w-32" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.date} className="border-b last:border-0">
                      <td className="py-2 whitespace-nowrap">
                        {format(new Date(r.date + "T00:00:00"), "dd MMM", { locale: ptBR })}
                      </td>
                      <td className="py-2 text-right tabular-nums">{money(r.spend)}</td>
                      <td className="py-2 text-right tabular-nums">
                        {r.leads.toLocaleString("pt-BR")}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {r.leads > 0 ? money(r.spend / r.leads) : "—"}
                      </td>
                      <td className="py-2 pl-3">
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full"
                            style={{ width: `${Math.round((r.spend / maxSpend) * 100)}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
