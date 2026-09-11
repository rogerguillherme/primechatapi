import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Percent, RotateCcw, Megaphone, Plus, Trash2, Target, KeyRound, Check, RefreshCw, Loader2,
  Sparkles, Award, Flag, TrendingUp,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { functionErrorMessage } from "@/lib/functionError";
import { useMetrikData } from "@/hooks/use-metrik-data";
import { useMetrikPeriodo } from "@/hooks/use-metrik-periodo";
import { SeletorPeriodo } from "@/components/metrics/SeletorPeriodo";
import { format } from "date-fns";
import { useFavicon } from "@/hooks/use-favicon";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Card, TituloPagina, Vazio, moeda } from "@/components/metrics/ui";
import { baseConfigurada } from "../../supabase/functions/_shared/metrics-fees.mjs";
import { cn } from "@/lib/utils";

interface Tier {
  id: string;
  name: string;
  min_value: number;
  commission_pct: number;
  bonus_value: number;
  color: string;
}

/** Ponto de partida do plano: quatro faixas com comissão crescente. */
const ELOS_PADRAO = [
  { name: "Bronze", min_value: 0, commission_pct: 5, color: "#a16207" },
  { name: "Prata", min_value: 10000, commission_pct: 8, color: "#64748b" },
  { name: "Ouro", min_value: 30000, commission_pct: 10, color: "#ca8a04" },
  { name: "Diamante", min_value: 100000, commission_pct: 12, color: "#0891b2" },
];

const dia = (d: Date) => format(d, "yyyy-MM-dd");

/**
 * Configurações que mudam os números.
 *
 * O simulador não é enfeite: cada interruptor aqui altera quanto cada vendedor
 * recebe, e ver o efeito em cima de um exemplo fixo antes de salvar é o que
 * evita descobrir a mudança no dia do pagamento.
 */

/** Números do exemplo. Fixos de propósito: comparar entre visitas exige o mesmo caso. */
const EXEMPLO = { faturamento: 10000, reembolsos: 500, taxas: 800, ads: 1200 };

const MEIOS = [
  { valor: "", rotulo: "Qualquer meio" },
  { valor: "pix", rotulo: "Pix" },
  { valor: "cartao", rotulo: "Cartão de crédito" },
  { valor: "boleto", rotulo: "Boleto" },
];

export default function MetrikConfiguracoes() {
  useFavicon("/metrik-favicon.svg");
  const qc = useQueryClient();
  const { inicio, fim } = useMetrikPeriodo();
  const { ownerId, config, regrasTaxa, podeConfigurar, tiers, membros, meta } = useMetrikData(inicio, fim);

  const [nova, setNova] = useState({ platform: "", payment_method: "", percent: "", fixed: "" });
  const [chaves, setChaves] = useState({ publica: "", secreta: "" });
  const [pctPadrao, setPctPadrao] = useState("");
  const [novoElo, setNovoElo] = useState({ name: "", min_value: "", commission_pct: "", bonus_value: "" });
  const [metaValor, setMetaValor] = useState(meta != null ? String(meta) : "");
  const [gasto, setGasto] = useState("");
  const [gastoDe, setGastoDe] = useState("__empresa__");

  const salvarCredencial = useMutation({
    mutationFn: async () => {
      if (!chaves.publica.trim() || !chaves.secreta.trim()) {
        throw new Error("Informe as duas chaves");
      }
      // A gravação vai por função, não direto na tabela: o navegador entrega o
      // valor e quem escreve é o servidor, depois de conferir quem pediu. Isso
      // evita dar privilégio de escrita numa tabela de segredo ao cliente.
      const { data, error } = await supabase.functions.invoke("metrik-credentials", {
        body: {
          platform: "applyfy",
          public_key: chaves.publica.trim(),
          secret_key: chaves.secreta.trim(),
        },
      });
      if (error) throw new Error(await functionErrorMessage(error, "Não consegui salvar as chaves"));
      if ((data as any)?.error) throw new Error((data as any).error);
    },
    onSuccess: () => {
      setChaves({ publica: "", secreta: "" });
      toast.success("Credenciais salvas.");
      qc.invalidateQueries({ queryKey: ["metrics-settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sincronizar = useMutation({
    mutationFn: async () => {
      // Sem período: a ApplyFy não tem listagem por data. A função reconfere
      // as vendas que já estão aqui como pendentes, uma a uma.
      const { data, error } = await supabase.functions.invoke("applyfy-sync", { body: {} });
      if (error) throw new Error(await functionErrorMessage(error, "Falha na sincronização"));
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as any;
    },
    onSuccess: (d) => {
      toast.success(
        d.conferidas === 0
          ? "Nenhuma venda pendente para reconferir."
          : `${d.atualizadas} de ${d.conferidas} venda(s) mudaram de status.`,
      );
      // Toda tela do Métrik lê das mesmas consultas; sem invalidar, os números
      // continuariam os de antes da conciliação.
      for (const k of ["metrik-orders", "metrik-vendas", "metrik-historico", "metrik-historico-ciclos"]) {
        qc.invalidateQueries({ queryKey: [k] });
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const salvarFlag = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => {
      const { error } = await (supabase as any)
        .from("metrics_settings")
        .upsert({ owner_id: ownerId, ...patch, updated_at: new Date().toISOString() }, { onConflict: "owner_id" });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["metrics-settings"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const salvarComissaoPadrao = useMutation({
    mutationFn: async () => {
      const p = Number(pctPadrao.replace(",", "."));
      if (!Number.isFinite(p) || p < 0 || p > 100) throw new Error("Percentual deve ficar entre 0 e 100");
      const { error } = await (supabase as any)
        .from("metrics_settings")
        .upsert({ owner_id: ownerId, commission_pct: p, updated_at: new Date().toISOString() }, { onConflict: "owner_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Comissão padrão salva.");
      qc.invalidateQueries({ queryKey: ["metrics-settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const recarregarElos = () => qc.invalidateQueries({ queryKey: ["metrics-tiers"] });

  const criarElosPadrao = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).from("metrics_tiers").insert(
        ELOS_PADRAO.map((e, i) => ({ ...e, owner_id: ownerId, position: i })),
      );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Elos padrão criados. Ajuste os valores como preferir.");
      recarregarElos();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const salvarElo = useMutation({
    mutationFn: async (t: Partial<Tier> & { id?: string }) => {
      if (t.id) {
        const { error } = await (supabase as any)
          .from("metrics_tiers")
          .update({
            name: t.name,
            min_value: t.min_value,
            commission_pct: t.commission_pct,
            bonus_value: t.bonus_value,
            color: t.color,
          })
          .eq("id", t.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any).from("metrics_tiers").insert({
          owner_id: ownerId,
          name: t.name,
          min_value: t.min_value,
          commission_pct: t.commission_pct,
          bonus_value: t.bonus_value || 0,
          color: t.color || "#64748b",
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      setNovoElo({ name: "", min_value: "", commission_pct: "", bonus_value: "" });
      recarregarElos();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removerElo = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("metrics_tiers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: recarregarElos,
    onError: (e: Error) => toast.error(e.message),
  });

  const salvarMeta = useMutation({
    mutationFn: async () => {
      const valor = Number(metaValor.replace(",", "."));
      if (!Number.isFinite(valor) || valor < 0) throw new Error("Informe um valor válido");
      // Uma meta coletiva por período: apagar antes evita duas metas
      // concorrentes para o mesmo mês, que fariam a barra mudar conforme a
      // ordem em que o banco devolvesse as linhas.
      await (supabase as any)
        .from("metrics_goals")
        .delete()
        .eq("owner_id", ownerId)
        .eq("scope", "coletiva")
        .eq("period_start", dia(inicio));
      const { error } = await (supabase as any).from("metrics_goals").insert({
        owner_id: ownerId,
        scope: "coletiva",
        period_start: dia(inicio),
        period_end: dia(fim),
        target_value: valor,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Meta do período salva.");
      qc.invalidateQueries({ queryKey: ["metrics-goal"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const salvarGasto = useMutation({
    mutationFn: async () => {
      const valor = Number(gasto.replace(",", "."));
      if (!Number.isFinite(valor) || valor < 0) throw new Error("Informe um valor válido");
      const membro = gastoDe === "__empresa__" ? null : gastoDe;
      // Substitui o lançamento do mesmo alvo no mesmo período em vez de somar
      // um segundo: dois valores para o mesmo mês fariam o ROAS depender de
      // quantas vezes alguém clicou em Lançar.
      let anterior = (supabase as any)
        .from("metrics_ad_spend")
        .delete()
        .eq("owner_id", ownerId)
        .eq("period_start", dia(inicio));
      anterior = membro
        ? anterior.eq("member_user_id", membro)
        : anterior.is("member_user_id", null);
      await anterior;
      const { error } = await (supabase as any).from("metrics_ad_spend").insert({
        owner_id: ownerId,
        member_user_id: membro,
        period_start: dia(inicio),
        period_end: dia(fim),
        amount: valor,
        source: "manual",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setGasto("");
      toast.success("Investimento lançado.");
      qc.invalidateQueries({ queryKey: ["metrics-ad-spend"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  useEffect(() => {
    setMetaValor(meta != null ? String(meta) : "");
  }, [meta]);

  const salvarTaxa = useMutation({
    mutationFn: async () => {
      if (!nova.platform.trim()) throw new Error("Informe a plataforma");
      const pct = Number(nova.percent.replace(",", ".")) || 0;
      const fix = Number(nova.fixed.replace(",", ".")) || 0;
      if (pct < 0 || pct > 100) throw new Error("Percentual deve ficar entre 0 e 100");
      const { error } = await (supabase as any).from("metrics_platform_fees").upsert(
        {
          owner_id: ownerId,
          platform: nova.platform.trim().toLowerCase(),
          payment_method: nova.payment_method || null,
          percent: pct,
          fixed: fix,
        },
        { onConflict: "owner_id,platform,payment_method" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      setNova({ platform: "", payment_method: "", percent: "", fixed: "" });
      toast.success("Taxa salva.");
      qc.invalidateQueries({ queryKey: ["metrics-platform-fees"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removerTaxa = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("metrics_platform_fees").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["metrics-platform-fees"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const baseSimulada = useMemo(
    () =>
      baseConfigurada(EXEMPLO, {
        descontarTaxas: config.descontarTaxas,
        descontarReembolsos: config.descontarReembolsos,
        descontarAds: config.descontarAds,
      }) as number,
    [config],
  );

  const INTERRUPTORES = [
    {
      chave: "deduct_fees",
      ativo: config.descontarTaxas,
      titulo: "Taxas da plataforma",
      sub: "Descontar o que o checkout retém",
      icone: Percent,
    },
    {
      chave: "deduct_refunds",
      ativo: config.descontarReembolsos,
      titulo: "Reembolsos",
      sub: "Subtrair vendas estornadas",
      icone: RotateCcw,
    },
    {
      chave: "deduct_ads",
      ativo: config.descontarAds,
      titulo: "Custos de anúncio",
      sub: "Deduzir investimento em tráfego",
      icone: Megaphone,
    },
  ];

  return (
    <div className="space-y-6">
      <TituloPagina titulo="Configurações" sub="Elos, meta, investimento, taxas e base de cálculo" />

      {!podeConfigurar && (
        <Card className="border-amber-500/40">
          <p className="text-sm text-amber-500">Só dono e gerente alteram estas configurações.</p>
        </Card>
      )}

      <SeletorPeriodo />

      {/* ── Elos ── */}
      <Card>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Award size={15} className="text-primary" />
            <h2 className="font-semibold">Elos e comissão</h2>
          </div>
          {podeConfigurar && tiers.length === 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => criarElosPadrao.mutate()}
              disabled={criarElosPadrao.isPending}
              className="gap-1.5 text-xs"
            >
              {criarElosPadrao.isPending ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Sparkles size={13} />
              )}
              Criar elos padrão
            </Button>
          )}
        </div>

        <div className="mt-3 space-y-2">
          {tiers.map((t) => (
            <div key={t.id} className="flex items-center gap-2">
              <input
                type="color"
                value={t.color}
                disabled={!podeConfigurar}
                onChange={(e) => salvarElo.mutate({ ...t, color: e.target.value })}
                className="h-8 w-8 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0.5"
                aria-label={`Cor do elo ${t.name}`}
              />
              <Input
                defaultValue={t.name}
                disabled={!podeConfigurar}
                onBlur={(e) =>
                  e.target.value !== t.name && salvarElo.mutate({ ...t, name: e.target.value })
                }
                className="h-8 flex-1 text-sm"
                aria-label="Nome do elo"
              />
              <Input
                defaultValue={t.min_value}
                disabled={!podeConfigurar}
                onBlur={(e) => salvarElo.mutate({ ...t, min_value: Number(e.target.value) || 0 })}
                className="h-8 w-24 text-sm tabular-nums"
                aria-label="Faturamento mínimo"
                title="Faturamento a partir do qual o vendedor entra neste elo"
              />
              <Input
                defaultValue={t.commission_pct}
                disabled={!podeConfigurar}
                onBlur={(e) => salvarElo.mutate({ ...t, commission_pct: Number(e.target.value) || 0 })}
                className="h-8 w-14 text-sm tabular-nums"
                aria-label="Percentual de comissão"
                title="% de comissão neste elo"
              />
              <Input
                defaultValue={t.bonus_value}
                disabled={!podeConfigurar}
                onBlur={(e) => salvarElo.mutate({ ...t, bonus_value: Number(e.target.value) || 0 })}
                className="h-8 w-20 text-sm tabular-nums"
                aria-label="Bônus fixo do elo"
                title="Valor fixo somado à comissão ao alcançar este elo"
              />
              {podeConfigurar && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removerElo.mutate(t.id)}
                  className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                  aria-label={`Remover elo ${t.name}`}
                >
                  <Trash2 size={14} />
                </Button>
              )}
            </div>
          ))}
        </div>

        {podeConfigurar && (
          <div className="mt-2.5 flex items-center gap-2 border-t border-border pt-2.5">
            <Input
              placeholder="Novo elo"
              value={novoElo.name}
              onChange={(e) => setNovoElo({ ...novoElo, name: e.target.value })}
              className="h-8 flex-1 text-sm"
            />
            <Input
              placeholder="A partir de"
              value={novoElo.min_value}
              onChange={(e) => setNovoElo({ ...novoElo, min_value: e.target.value })}
              className="h-8 w-24 text-sm tabular-nums"
            />
            <Input
              placeholder="%"
              value={novoElo.commission_pct}
              onChange={(e) => setNovoElo({ ...novoElo, commission_pct: e.target.value })}
              className="h-8 w-14 text-sm tabular-nums"
            />
            <Input
              placeholder="Bônus R$"
              value={novoElo.bonus_value}
              onChange={(e) => setNovoElo({ ...novoElo, bonus_value: e.target.value })}
              className="h-8 w-20 text-sm tabular-nums"
            />
            <Button
              size="icon"
              variant="outline"
              className="h-8 w-8 shrink-0"
              disabled={!novoElo.name.trim() || salvarElo.isPending}
              onClick={() =>
                salvarElo.mutate({
                  name: novoElo.name.trim(),
                  min_value: Number(novoElo.min_value) || 0,
                  commission_pct: Number(novoElo.commission_pct) || 0,
                  bonus_value: Number(novoElo.bonus_value) || 0,
                })
              }
              aria-label="Adicionar elo"
            >
              <Plus size={14} />
            </Button>
          </div>
        )}
        <p className="mt-3 text-[11px] text-muted-foreground">
          Colunas: cor, nome, faturamento a partir do qual o elo vale, % de comissão, e bônus
          fixo somado à comissão ao alcançar o elo. As mudanças salvam ao sair do campo.
        </p>
      </Card>

      {/* ── Base de cálculo ── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="font-semibold">Base de cálculo da comissão</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            O que sai do faturamento bruto antes de calcular a comissão do vendedor.
          </p>

          <div className="mt-4 space-y-2">
            {INTERRUPTORES.map((t) => (
              <button
                key={t.chave}
                disabled={!podeConfigurar || salvarFlag.isPending}
                onClick={() => salvarFlag.mutate({ [t.chave]: !t.ativo })}
                className={cn(
                  "metrik-card w-full rounded-lg px-4 py-3 flex items-center gap-3 text-left transition-opacity",
                  !t.ativo && "opacity-60",
                )}
              >
                <div className={cn("rounded-lg p-2", t.ativo ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")}>
                  <t.icone size={15} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{t.titulo}</p>
                  <p className="text-xs text-muted-foreground">{t.sub}</p>
                </div>
                <span
                  className={cn(
                    "ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
                    t.ativo ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
                  )}
                >
                  {t.ativo ? "Ativo" : "Inativo"}
                </span>
              </button>
            ))}
          </div>

          <p className="mt-3 text-[11px] text-muted-foreground">
            Anúncio vem desligado de propósito: o vendedor não escolhe quanto se gasta em
            tráfego, e descontar isso da comissão dele transfere um risco que não é dele.
          </p>

          {podeConfigurar && (
            <div className="mt-4 flex items-end gap-2 border-t border-border pt-3">
              <div className="space-y-1">
                <Label htmlFor="pct" className="text-xs">Comissão padrão (%)</Label>
                <p className="text-[11px] text-muted-foreground">Vale para quem ainda não alcançou elo.</p>
                <Input
                  id="pct"
                  value={pctPadrao}
                  onChange={(e) => setPctPadrao(e.target.value)}
                  placeholder={String(config.comissaoPct ?? 10)}
                  className="h-9 w-28 tabular-nums"
                />
              </div>
              <Button
                size="sm"
                onClick={() => salvarComissaoPadrao.mutate()}
                disabled={salvarComissaoPadrao.isPending}
              >
                Salvar
              </Button>
            </div>
          )}
        </Card>

        {/* ── Simulador ── */}
        <Card destaque>
          <div className="flex items-center gap-2">
            <Target size={15} className="text-primary" />
            <h2 className="font-semibold">Simulador</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Um mês de exemplo, com os interruptores ao lado aplicados.
          </p>

          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Faturamento bruto</dt>
              <dd className="tabular-nums font-medium">{moeda(EXEMPLO.faturamento)}</dd>
            </div>
            {config.descontarTaxas && (
              <div className="flex justify-between text-destructive">
                <dt>Taxas da plataforma</dt>
                <dd className="tabular-nums">−{moeda(EXEMPLO.taxas)}</dd>
              </div>
            )}
            {config.descontarReembolsos && (
              <div className="flex justify-between text-destructive">
                <dt>Reembolsos</dt>
                <dd className="tabular-nums">−{moeda(EXEMPLO.reembolsos)}</dd>
              </div>
            )}
            {config.descontarAds && (
              <div className="flex justify-between text-destructive">
                <dt>Custos de anúncio</dt>
                <dd className="tabular-nums">−{moeda(EXEMPLO.ads)}</dd>
              </div>
            )}
          </dl>

          <div className="metrik-card mt-4 rounded-lg px-4 py-3 flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider">Base final</span>
            <span className="text-xl font-bold tabular-nums text-primary">{moeda(baseSimulada)}</span>
          </div>

          <p className="mt-3 text-[11px] text-muted-foreground">
            Comissão de {config.comissaoPct}% sobre essa base:{" "}
            <b className="text-foreground">{moeda(Math.round(baseSimulada * config.comissaoPct) / 100)}</b>
          </p>
        </Card>
      </div>

      {/* ── Meta e investimento do período ── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="flex items-center gap-2">
            <Flag size={15} className="text-primary" />
            <h2 className="font-semibold">Meta coletiva do período</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {format(inicio, "dd/MM")} a {format(fim, "dd/MM")} — mude o período acima para
            definir a meta de outro mês.
          </p>
          {podeConfigurar ? (
            <div className="mt-3 flex gap-2">
              <Input
                value={metaValor}
                onChange={(e) => setMetaValor(e.target.value)}
                placeholder="Ex: 150000"
                className="h-9 tabular-nums"
              />
              <Button onClick={() => salvarMeta.mutate()} disabled={salvarMeta.isPending}>
                Salvar
              </Button>
            </div>
          ) : (
            <p className="mt-3 text-sm">{meta != null ? moeda(meta) : "Nenhuma meta definida"}</p>
          )}
        </Card>

        <Card>
          <div className="flex items-center gap-2">
            <TrendingUp size={15} className="text-primary" />
            <h2 className="font-semibold">Investimento em anúncio do período</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Só o gasto atribuído a um vendedor entra no ROAS dele. O da empresa fica no total,
            sem ser rateado.
          </p>
          {podeConfigurar && (
            <div className="mt-3 flex gap-2">
              <Select value={gastoDe} onValueChange={setGastoDe}>
                <SelectTrigger className="h-9 w-[42%]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__empresa__">Empresa (sem vendedor)</SelectItem>
                  {membros.map((m) => (
                    <SelectItem key={m.member_user_id} value={m.member_user_id}>
                      {m.display_name || m.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={gasto}
                onChange={(e) => setGasto(e.target.value)}
                placeholder="Ex: 4500"
                className="h-9 flex-1 tabular-nums"
              />
              <Button onClick={() => salvarGasto.mutate()} disabled={salvarGasto.isPending}>
                Lançar
              </Button>
            </div>
          )}
        </Card>
      </div>

      {/* ── Credenciais de API ── */}
      <Card>
        <div className="flex items-center gap-2">
          <KeyRound size={15} className="text-primary" />
          <h2 className="font-semibold">Credenciais da ApplyFy</h2>
          {config.applyfyConfiguradaEm && (
            <span className="ml-auto flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
              <Check size={11} /> Configurada
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Usadas para conferir as vendas por API, além do webhook. As chaves são gravadas e
          <b> nunca devolvidas para a tela</b> — nem para você. Para trocar, cole as duas de
          novo. Guardar e depois mostrar seria o mesmo que não proteger.
        </p>

        {config.applyfyConfiguradaEm && podeConfigurar && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => sincronizar.mutate()}
              disabled={sincronizar.isPending}
            >
              {sincronizar.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <RefreshCw size={14} />
              )}
              Reconferir vendas pendentes
            </Button>
            <span className="text-[11px] text-muted-foreground">
              Pergunta à ApplyFy o status das vendas que estão pendentes aqui. Quem traz venda
              nova é o webhook — a API só consulta uma transação por vez.
            </span>
          </div>
        )}

        {podeConfigurar && (
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <Input
              value={chaves.publica}
              onChange={(e) => setChaves({ ...chaves, publica: e.target.value })}
              placeholder="Chave pública (Client ID)"
              className="h-9 w-64 font-mono text-xs"
            />
            <Input
              type="password"
              value={chaves.secreta}
              onChange={(e) => setChaves({ ...chaves, secreta: e.target.value })}
              placeholder="Chave privada (Client Secret)"
              className="h-9 w-64 font-mono text-xs"
            />
            <Button size="sm" onClick={() => salvarCredencial.mutate()} disabled={salvarCredencial.isPending}>
              Salvar chaves
            </Button>
          </div>
        )}
      </Card>

      {/* ── Taxas por plataforma ── */}
      <Card className="p-0 overflow-hidden">
        <div className="border-b border-border px-5 py-4">
          <h2 className="font-semibold">Taxas de plataforma</h2>
          <p className="text-xs text-muted-foreground">
            Percentual e valor fixo cobrados por venda. A parte fixa importa mais do que
            parece: em um pedido de R$ 20, R$ 2,49 é 12%, não 3%.
          </p>
        </div>

        <div className="divide-y divide-border/50">
          {(regrasTaxa as any[]).map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-5 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium capitalize">
                  {r.platform}
                  {r.payment_method ? ` — ${MEIOS.find((m) => m.valor === r.payment_method)?.rotulo || r.payment_method}` : ""}
                </p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {Number(r.percent)}%{Number(r.fixed) > 0 ? ` + ${moeda(Number(r.fixed))}` : ""}
                </p>
              </div>
              {podeConfigurar && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removerTaxa.mutate(r.id)}
                  className="ml-auto h-8 w-8 text-muted-foreground hover:text-destructive"
                  aria-label={`Remover taxa ${r.platform}`}
                >
                  <Trash2 size={14} />
                </Button>
              )}
            </div>
          ))}
        </div>

        {(regrasTaxa as any[]).length === 0 && (
          <div className="px-5 py-4">
            <Vazio>
              Nenhuma taxa cadastrada — enquanto isso a comissão sai sobre o bruto, maior que
              o devido.
            </Vazio>
          </div>
        )}

        {podeConfigurar && (
          <div className="border-t border-border px-5 py-4 flex flex-wrap items-end gap-2">
            <Input
              value={nova.platform}
              onChange={(e) => setNova({ ...nova, platform: e.target.value })}
              placeholder="Plataforma"
              className="h-9 w-40"
            />
            <select
              value={nova.payment_method}
              onChange={(e) => setNova({ ...nova, payment_method: e.target.value })}
              className="h-9 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            >
              {MEIOS.map((m) => (
                <option key={m.valor} value={m.valor}>{m.rotulo}</option>
              ))}
            </select>
            <Input
              value={nova.percent}
              onChange={(e) => setNova({ ...nova, percent: e.target.value })}
              placeholder="%"
              className="h-9 w-20 tabular-nums"
            />
            <Input
              value={nova.fixed}
              onChange={(e) => setNova({ ...nova, fixed: e.target.value })}
              placeholder="Fixo R$"
              className="h-9 w-28 tabular-nums"
            />
            <Button size="sm" className="gap-1.5" onClick={() => salvarTaxa.mutate()} disabled={salvarTaxa.isPending}>
              <Plus size={14} /> Adicionar
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
