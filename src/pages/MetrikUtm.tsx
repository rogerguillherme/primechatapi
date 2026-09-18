import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link2, DollarSign, ShoppingBag, Target } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useTeamContext } from "@/hooks/use-team";
import { useMetrikPeriodo } from "@/hooks/use-metrik-periodo";
import { SeletorPeriodo } from "@/components/metrics/SeletorPeriodo";
import { useFavicon } from "@/hooks/use-favicon";
import { Card, Kpi, Barra, TituloPagina, Vazio, moeda } from "@/components/metrics/ui";
import { APPLYFY_ACCOUNT_ID } from "@/lib/applyfy";

interface ApplyfySale {
  id: string;
  status: string;
  amount_cents: number;
  product_name: string | null;
  client_name: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_content: string | null;
  utm_term: string | null;
  created_at: string;
}

/** Agrupa vendas pagas por uma UTM e devolve ordenado por faturamento. */
function agrupar(vendas: ApplyfySale[], campo: "utm_source" | "utm_medium") {
  const mapa = new Map<string, { vendas: number; faturamento: number }>();
  for (const v of vendas) {
    const chave = v[campo] || "sem origem";
    const atual = mapa.get(chave) || { vendas: 0, faturamento: 0 };
    atual.vendas += 1;
    atual.faturamento += v.amount_cents;
    mapa.set(chave, atual);
  }
  return Array.from(mapa.entries())
    .map(([nome, dados]) => ({ nome, ...dados }))
    .sort((a, b) => b.faturamento - a.faturamento);
}

/**
 * Vendas por UTM: de onde e de quem veio cada venda paga via ApplyFy.
 *
 * utm_source = canal, utm_medium = vendedor, utm_content/utm_term = lead
 * (formato lead_<telefone> / <telefone>) — o mesmo esquema montado no botão
 * de link de checkout do chat. Sem venda nenhuma até o webhook da ApplyFy
 * ser configurado em Configurações › Checkout ApplyFy.
 */
export default function MetrikUtm() {
  useFavicon("/metrik-favicon.svg");

  const { data: team } = useTeamContext();
  const ownerId = team?.ownerId;
  const { inicio, fim } = useMetrikPeriodo();

  const { data: vendas = [], isLoading } = useQuery({
    queryKey: ["applyfy-sales", ownerId, inicio.toISOString(), fim.toISOString()],
    enabled: !!ownerId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("applyfy_sales")
        .select("id, status, amount_cents, product_name, client_name, utm_source, utm_medium, utm_content, utm_term, created_at")
        .gte("created_at", inicio.toISOString())
        .lte("created_at", fim.toISOString())
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as ApplyfySale[];
    },
  });

  const pagas = useMemo(() => vendas.filter((v) => v.status === "COMPLETED"), [vendas]);
  const faturamento = useMemo(() => pagas.reduce((s, v) => s + v.amount_cents, 0), [pagas]);
  const ticketMedio = pagas.length > 0 ? faturamento / pagas.length : 0;

  const porCanal = useMemo(() => agrupar(pagas, "utm_source"), [pagas]);
  const porVendedor = useMemo(() => agrupar(pagas, "utm_medium"), [pagas]);
  const maiorCanal = porCanal[0]?.faturamento || 1;
  const maiorVendedor = porVendedor[0]?.faturamento || 1;

  // Recurso ainda não é geral do Prime Chat — só a conta do Estevao usa.
  if (ownerId && ownerId !== APPLYFY_ACCOUNT_ID) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground">
        <p>Esse painel ainda não está disponível pra essa conta.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <TituloPagina titulo="Vendas por UTM" sub="De onde e de quem veio cada venda paga via ApplyFy" />

      <SeletorPeriodo />

      <div className="grid gap-4 sm:grid-cols-3">
        <Kpi rotulo="Vendas pagas" valor={String(pagas.length)} nota={`${vendas.length} recebidas no período`} icone={ShoppingBag} destaque />
        <Kpi rotulo="Faturamento" valor={moeda(faturamento / 100)} icone={DollarSign} />
        <Kpi rotulo="Ticket médio" valor={pagas.length > 0 ? moeda(ticketMedio / 100) : "—"} icone={Target} />
      </div>

      {isLoading ? (
        <Card><p className="text-sm text-muted-foreground py-6 text-center">Carregando…</p></Card>
      ) : vendas.length === 0 ? (
        <Card className="p-8">
          <Vazio>
            Nenhuma venda registrada nesse período. Confirme se o webhook da ApplyFy está configurado em
            Configurações › Checkout ApplyFy (Prime Chat) — sem ele, nenhuma venda chega aqui.
          </Vazio>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <div className="flex items-center gap-2 mb-3">
              <Link2 size={15} className="text-primary" />
              <h2 className="font-semibold">Por canal (utm_source)</h2>
            </div>
            <div className="space-y-3">
              {porCanal.map((c) => (
                <div key={c.nome}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="font-medium capitalize">{c.nome}</span>
                    <span className="text-muted-foreground tabular-nums">{c.vendas} vendas · {moeda(c.faturamento / 100)}</span>
                  </div>
                  <Barra valor={c.faturamento / maiorCanal} alta />
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <div className="flex items-center gap-2 mb-3">
              <Link2 size={15} className="text-primary" />
              <h2 className="font-semibold">Por vendedor (utm_medium)</h2>
            </div>
            <div className="space-y-3">
              {porVendedor.map((v) => (
                <div key={v.nome}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="font-medium capitalize">{v.nome}</span>
                    <span className="text-muted-foreground tabular-nums">{v.vendas} vendas · {moeda(v.faturamento / 100)}</span>
                  </div>
                  <Barra valor={v.faturamento / maiorVendedor} alta />
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {vendas.length > 0 && (
        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Data</th>
                  <th className="px-4 py-3 font-medium">Cliente</th>
                  <th className="px-4 py-3 font-medium">Produto</th>
                  <th className="px-4 py-3 font-medium">Canal</th>
                  <th className="px-4 py-3 font-medium">Vendedor</th>
                  <th className="px-4 py-3 font-medium">Lead</th>
                  <th className="px-4 py-3 font-medium">Valor</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {vendas.slice(0, 200).map((v) => (
                  <tr key={v.id} className="border-b border-border/50 last:border-0">
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                      {new Date(v.created_at).toLocaleDateString("pt-BR")}
                    </td>
                    <td className="px-4 py-3">{v.client_name || "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{v.product_name || "—"}</td>
                    <td className="px-4 py-3 capitalize">{v.utm_source || "—"}</td>
                    <td className="px-4 py-3 capitalize">{v.utm_medium || "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{v.utm_content || v.utm_term || "—"}</td>
                    <td className="px-4 py-3 tabular-nums font-semibold">{moeda(v.amount_cents / 100)}</td>
                    <td className="px-4 py-3">
                      <span className={
                        v.status === "COMPLETED"
                          ? "text-emerald-600"
                          : v.status === "REFUNDED" || v.status === "CHARGEBACK"
                            ? "text-red-600"
                            : "text-muted-foreground"
                      }>
                        {v.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
