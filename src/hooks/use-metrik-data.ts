import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTeamContext, useTeamMembers } from "@/hooks/use-team";
import { taxaEfetiva } from "../../supabase/functions/_shared/metrics-fees.mjs";

/**
 * Fonte única dos números do Metrik.
 *
 * Dashboard e Ranking precisam exatamente das mesmas contas. Cada tela
 * calculando as suas produziria dois faturamentos para o mesmo mês — e o dia
 * em que divergirem por um centavo, ninguém confia em nenhuma das duas.
 *
 * Nada é gravado: tudo sai de `orders` na leitura. O vendedor de uma venda é o
 * atendente responsável pelo lead no CRM, que é como a operação já funciona.
 */

export interface Tier {
  id: string;
  name: string;
  min_value: number;
  commission_pct: number;
  color: string;
}

export interface Vendedor {
  userId: string | null;
  nome: string;
  faturamento: number;
  vendas: number;
  reembolsos: number;
  investimento: number;
  /** Faturamento menos o que voltou e o que foi gasto para trazer. */
  lucro: number;
  /** Acumulado de todos os tempos, para a barra de carreira. */
  acumulado: number;
  /** Quanto a plataforma reteve das vendas dele no período. */
  taxas: number;
  /** O que sobrou depois da taxa — o dinheiro que de fato entrou. */
  liquido: number;
}

const dia = (d: Date) => format(d, "yyyy-MM-dd");

export function useMetrikData(inicio: Date, fim: Date) {
  const { user } = useAuth();
  const { data: team } = useTeamContext();
  const { data: membros = [] } = useTeamMembers();
  const ownerId = team?.ownerId ?? user?.id ?? null;
  const podeConfigurar =
    !team || team.accessLevel === "owner" || team.accessLevel === "manager";

  const chaveperiodo = `${dia(inicio)}_${dia(fim)}`;

  const configQ = useQuery({
    queryKey: ["metrics-settings", ownerId],
    enabled: !!ownerId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("metrics_settings")
        .select("platform_fee_pct, commission_pct, deduct_fees, deduct_refunds, deduct_ads, tier_base, applyfy_configured_at")
        .eq("owner_id", ownerId)
        .maybeSingle();
      if (error) throw error;
      return {
        taxaPct: Number(data?.platform_fee_pct) || 0,
        comissaoPct: data?.commission_pct != null ? Number(data.commission_pct) : 10,
        descontarTaxas: data?.deduct_fees !== false,
        descontarReembolsos: data?.deduct_refunds !== false,
        descontarAds: data?.deduct_ads === true,
        baseElo: (data?.tier_base as string) || "faturamento",
        applyfyConfiguradaEm: (data?.applyfy_configured_at as string) || null,
      };
    },
  });

  const taxasQ = useQuery({
    queryKey: ["metrics-platform-fees", ownerId],
    enabled: !!ownerId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("metrics_platform_fees")
        .select("id, platform, payment_method, percent, fixed")
        .eq("owner_id", ownerId);
      if (error) throw error;
      return data || [];
    },
  });

  const tiersQ = useQuery({
    queryKey: ["metrics-tiers", ownerId],
    enabled: !!ownerId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("metrics_tiers")
        .select("id, name, min_value, commission_pct, color")
        .eq("owner_id", ownerId)
        .order("min_value");
      if (error) throw error;
      return (data || []) as Tier[];
    },
  });

  const temporadaQ = useQuery({
    queryKey: ["metrics-season", ownerId, chaveperiodo],
    enabled: !!ownerId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("metrics_seasons")
        .select("name")
        .eq("owner_id", ownerId)
        .lte("starts_at", dia(fim))
        .gte("ends_at", dia(inicio))
        .order("starts_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data?.name as string) ?? null;
    },
  });

  const metaQ = useQuery({
    queryKey: ["metrics-goal", ownerId, chaveperiodo],
    enabled: !!ownerId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("metrics_goals")
        .select("target_value")
        .eq("owner_id", ownerId)
        .eq("scope", "coletiva")
        .lte("period_start", dia(fim))
        .gte("period_end", dia(inicio))
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data?.target_value != null ? Number(data.target_value) : null;
    },
  });

  const gastosQ = useQuery({
    queryKey: ["metrics-ad-spend", ownerId, chaveperiodo],
    enabled: !!ownerId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("metrics_ad_spend")
        .select("member_user_id, amount")
        .eq("owner_id", ownerId)
        .lte("period_start", dia(fim))
        .gte("period_end", dia(inicio));
      if (error) throw error;
      return data || [];
    },
  });

  // Vendas do período: aprovadas somam, devolvidas descontam. As duas na mesma
  // consulta porque separá-las custaria uma ida a mais ao banco para responder
  // à mesma pergunta.
  const vendasQ = useQuery({
    queryKey: ["metrik-orders", ownerId, chaveperiodo],
    enabled: !!ownerId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("orders")
        .select("amount, net_amount, status, created_at, platform, payment_method, leads!inner(assigned_to)")
        .in("status", ["approved", "refunded", "chargeback"])
        .gte("created_at", inicio.toISOString())
        .lte("created_at", fim.toISOString())
        .limit(5000);
      if (error) throw error;
      return data || [];
    },
  });

  // Acumulado histórico, para a barra de carreira. Consulta separada porque a
  // pergunta é outra — "quanto essa pessoa já trouxe desde sempre" — e a
  // resposta não muda quando se troca o período na tela.
  const historicoQ = useQuery({
    queryKey: ["metrik-historico", ownerId],
    enabled: !!ownerId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("orders")
        .select("amount, leads!inner(assigned_to)")
        .eq("status", "approved")
        .limit(20000);
      if (error) throw error;
      const m = new Map<string, number>();
      for (const o of data || []) {
        const dono = (o as any).leads?.assigned_to;
        if (!dono) continue;
        m.set(dono, (m.get(dono) || 0) + (Number((o as any).amount) || 0));
      }
      return m;
    },
    staleTime: 5 * 60_000,
  });

  const nomePor = useMemo(() => {
    const m = new Map<string, string>();
    for (const x of membros) m.set(x.member_user_id, x.display_name || x.email || "Vendedor");
    return m;
  }, [membros]);

  const gastoPor = useMemo(() => {
    const m = new Map<string, number>();
    let empresa = 0;
    for (const g of (gastosQ.data || []) as any[]) {
      const v = Number(g.amount) || 0;
      if (g.member_user_id) m.set(g.member_user_id, (m.get(g.member_user_id) || 0) + v);
      else empresa += v;
    }
    return { porVendedor: m, empresa };
  }, [gastosQ.data]);

  const vendedores: Vendedor[] = useMemo(() => {
    const acc = new Map<string, Vendedor>();
    const SEM = "__sem_atribuicao__";

    for (const o of (vendasQ.data || []) as any[]) {
      const dono = o.leads?.assigned_to ?? null;
      const chave = dono || SEM;
      const linha =
        acc.get(chave) ||
        ({
          userId: dono,
          nome: dono ? nomePor.get(dono) || "Vendedor" : "Sem atribuição",
          faturamento: 0,
          vendas: 0,
          reembolsos: 0,
          investimento: dono ? gastoPor.porVendedor.get(dono) || 0 : 0,
          lucro: 0,
          liquido: 0,
          acumulado: dono ? historicoQ.data?.get(dono) || 0 : 0,
          taxas: 0,
        } as Vendedor);

      const valor = Number(o.amount) || 0;
      if (o.status === "approved") {
        linha.faturamento += valor;
        linha.vendas += 1;
        // Venda a venda, porque a taxa tem parte fixa: aplicar o percentual
        // sobre o total do mês ignoraria os R$ 2,49 de cada pedido, e o erro
        // cresce com o número de vendas, não com o valor delas.
        // O líquido informado pela plataforma vence a regra configurada: ele é
        // exato e não depende de alguém ter cadastrado o percentual certo.
        linha.taxas += taxaEfetiva(
          valor, o.net_amount, taxasQ.data || [], o.platform, o.payment_method,
        ) as number;
      } else {
        // Devolvido e chargeback contam como dinheiro que voltou, não como
        // venda que nunca houve: some do lucro e fica visível.
        linha.reembolsos += valor;
      }
      acc.set(chave, linha);
    }

    for (const v of acc.values()) {
      v.liquido = Math.round((v.faturamento - v.reembolsos - v.taxas) * 100) / 100;
      v.lucro = v.liquido - v.investimento;
    }

    // Vendedor sem venda no período existe e precisa aparecer: sumir da lista
    // faria parecer que ele não está no time.
    for (const m of membros) {
      if (acc.has(m.member_user_id)) continue;
      acc.set(m.member_user_id, {
        userId: m.member_user_id,
        nome: m.display_name || m.email || "Vendedor",
        faturamento: 0,
        vendas: 0,
        reembolsos: 0,
        investimento: gastoPor.porVendedor.get(m.member_user_id) || 0,
        lucro: -(gastoPor.porVendedor.get(m.member_user_id) || 0),
        liquido: 0,
        acumulado: historicoQ.data?.get(m.member_user_id) || 0,
        taxas: 0,
      });
    }

    return [...acc.values()].sort((a, b) => b.faturamento - a.faturamento);
  }, [vendasQ.data, nomePor, gastoPor, historicoQ.data, membros, taxasQ.data]);

  // Série diária para o gráfico. Sai das MESMAS vendas já carregadas — buscar
  // de novo agrupado por dia daria uma segunda fonte para o mesmo número.
  const porDia = useMemo(() => {
    const m = new Map<string, { dia: string; faturamento: number; reembolsos: number }>();
    for (let d = new Date(inicio); d <= fim; d.setDate(d.getDate() + 1)) {
      const k = dia(d);
      m.set(k, { dia: format(d, "dd/MM"), faturamento: 0, reembolsos: 0 });
    }
    for (const o of (vendasQ.data || []) as any[]) {
      const k = dia(new Date(o.created_at));
      const linha = m.get(k);
      if (!linha) continue;
      const valor = Number(o.amount) || 0;
      if (o.status === "approved") linha.faturamento += valor;
      else linha.reembolsos += valor;
    }
    return [...m.values()];
  }, [vendasQ.data, inicio, fim]);

  const totais = useMemo(() => {
    const faturamento = vendedores.reduce((s, v) => s + v.faturamento, 0);
    const reembolsos = vendedores.reduce((s, v) => s + v.reembolsos, 0);
    const vendas = vendedores.reduce((s, v) => s + v.vendas, 0);
    const investimento =
      gastoPor.empresa + [...gastoPor.porVendedor.values()].reduce((s, v) => s + v, 0);
    // Soma das taxas reais de cada venda, não um percentual sobre o total.
    const taxa = Math.round(vendedores.reduce((s, v) => s + v.taxas, 0) * 100) / 100;
    return {
      faturamento,
      reembolsos,
      vendas,
      investimento,
      // A taxa da plataforma sai do lucro junto com o resto: ela é dinheiro
      // que nunca chegou na conta, não uma despesa opcional.
      taxa: taxa > 0 ? taxa : 0,
      // Líquido: o que entrou de verdade, depois de devolução e taxa. É o
      // número que bate com o extrato, e por isso o que se mostra.
      liquido: Math.round((faturamento - reembolsos - (taxa > 0 ? taxa : 0)) * 100) / 100,
      lucro: faturamento - reembolsos - (taxa > 0 ? taxa : 0) - investimento,
      ativos: vendedores.filter((v) => v.vendas > 0).length,
    };
  }, [vendedores, gastoPor, configQ.data]);

  return {
    ownerId,
    podeConfigurar,
    membros,
    tiers: tiersQ.data || [],
    config:
      configQ.data || {
        taxaPct: 0,
        comissaoPct: 10,
        descontarTaxas: true,
        descontarReembolsos: true,
        descontarAds: false,
        baseElo: "faturamento",
        applyfyConfiguradaEm: null,
      },
    regrasTaxa: taxasQ.data || [],
    temporada: temporadaQ.data ?? null,
    meta: metaQ.data ?? null,
    vendedores,
    totais,
    porDia,
    carregando: vendasQ.isLoading,
    erro: (vendasQ.error || tiersQ.error) as Error | null,
  };
}
