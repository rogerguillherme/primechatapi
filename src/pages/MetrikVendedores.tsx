import { useMemo, useState } from "react";
import { startOfMonth, endOfMonth } from "date-fns";
import { Users, DollarSign, Target, Link2, Check } from "lucide-react";
import { toast } from "sonner";

import { useMetrikData } from "@/hooks/use-metrik-data";
import { useFavicon } from "@/hooks/use-favicon";
import { Button } from "@/components/ui/button";
import { Card, Kpi, TituloPagina, Vazio, moeda } from "@/components/metrics/ui";
import { eloAtual, roas } from "../../supabase/functions/_shared/metrics-engine.mjs";
import { cn } from "@/lib/utils";

/**
 * Vendedores: quem é do time, em que elo está e quanto custa cada venda dele.
 *
 * O link UTM é o que fecha a atribuição de tráfego pago por vendedor. Ele é
 * gerado aqui, com o id do vendedor em utm_content — o mesmo campo que o
 * webhook de venda pode ler depois para saber de quem foi.
 */
export default function MetrikVendedores() {
  useFavicon("/metrik-favicon.svg");

  const [mes] = useState(() => new Date());
  const inicio = useMemo(() => startOfMonth(mes), [mes]);
  const fim = useMemo(() => endOfMonth(mes), [mes]);
  const { vendedores, totais, tiers } = useMetrikData(inicio, fim);

  const [base, setBase] = useState("");
  const [copiado, setCopiado] = useState<string | null>(null);

  const comVendas = vendedores.filter((v) => v.userId);

  const copiarUtm = async (userId: string, nome: string) => {
    const raiz = base.trim() || "https://exemplo.com.br/oferta";
    const url = `${raiz}${raiz.includes("?") ? "&" : "?"}utm_source=vendedor&utm_medium=indicacao&utm_content=${userId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(userId);
      toast.success(`Link de ${nome} copiado.`);
      setTimeout(() => setCopiado(null), 2000);
    } catch {
      toast.error("Não consegui copiar. Copie manualmente: " + url);
    }
  };

  return (
    <div className="space-y-6">
      <TituloPagina titulo="Vendedores" sub="Quem está no time e o que cada um trouxe no período" />

      <div className="grid gap-4 sm:grid-cols-3">
        <Kpi rotulo="Vendedores" valor={String(comVendas.length)} nota={`${totais.ativos} com venda no período`} icone={Users} destaque />
        <Kpi rotulo="Total investido" valor={moeda(totais.investimento)} nota="soma do anúncio lançado" icone={DollarSign} />
        <Kpi
          rotulo="CPA médio"
          valor={totais.vendas > 0 && totais.investimento > 0 ? moeda(totais.investimento / totais.vendas) : "—"}
          nota={totais.investimento === 0 ? "sem investimento lançado" : "custo por venda"}
          icone={Target}
        />
      </div>

      {/* ── Links UTM ── */}
      <Card>
        <div className="flex items-center gap-2">
          <Link2 size={15} className="text-primary" />
          <h2 className="font-semibold">Links UTM por vendedor</h2>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Cole a URL da sua oferta e copie o link de cada vendedor. O id dele vai em
          <b> utm_content</b>, que é o que permite atribuir a venda a quem trouxe o clique.
        </p>
        <input
          value={base}
          onChange={(e) => setBase(e.target.value)}
          placeholder="https://sua-oferta.com.br/pagina"
          className="mt-3 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
      </Card>

      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3 font-medium">Nome</th>
                <th className="px-4 py-3 font-medium">Elo</th>
                <th className="px-4 py-3 font-medium">Vendas</th>
                <th className="px-4 py-3 font-medium">Faturamento</th>
                <th className="px-4 py-3 font-medium">Investimento</th>
                <th className="px-4 py-3 font-medium">CPA</th>
                <th className="px-4 py-3 font-medium">ROAS</th>
                <th className="px-4 py-3 font-medium">Link</th>
              </tr>
            </thead>
            <tbody>
              {comVendas.map((v) => {
                const elo = eloAtual(tiers, v.faturamento) as any;
                const ro = roas(v.faturamento, v.investimento) as number | null;
                // CPA sem venda é divisão por zero; sem investimento não existe
                // custo por aquisição. Nos dois casos a resposta é "—".
                const cpa = v.vendas > 0 && v.investimento > 0 ? v.investimento / v.vendas : null;
                return (
                  <tr key={v.userId!} className="border-b border-border/50 last:border-0">
                    <td className="px-4 py-3 font-medium">{v.nome}</td>
                    <td className="px-4 py-3">
                      {elo ? (
                        <span
                          className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase text-white"
                          style={{ backgroundColor: elo.color }}
                        >
                          {elo.name}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">sem elo</span>
                      )}
                    </td>
                    <td className="px-4 py-3 tabular-nums">{v.vendas}</td>
                    <td className="px-4 py-3 tabular-nums font-semibold">{moeda(v.faturamento)}</td>
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">{moeda(v.investimento)}</td>
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">{cpa === null ? "—" : moeda(cpa)}</td>
                    <td className="px-4 py-3 tabular-nums">{ro === null ? "—" : `${ro.toFixed(2)}x`}</td>
                    <td className="px-4 py-3">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => copiarUtm(v.userId!, v.nome)}
                        className="h-7 gap-1.5 text-xs"
                      >
                        {copiado === v.userId ? <Check size={12} /> : <Link2 size={12} />}
                        {copiado === v.userId ? "Copiado" : "Copiar"}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {comVendas.length === 0 && (
          <div className="p-6">
            <Vazio>
              Nenhum vendedor cadastrado. Convide a equipe em Configurações › Equipe no Prime
              Chat — o Metrik usa a mesma lista.
            </Vazio>
          </div>
        )}
      </Card>
    </div>
  );
}
