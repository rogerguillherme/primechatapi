import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Plus, Trash2, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Configuração do Métrik: elos, meta do período e gasto de anúncio.
 *
 * Sem esta tela o módulo dependia de alguém escrever SQL para ligar a
 * gamificação — o que na prática significa que ela não liga. As regras de elo e
 * comissão são o que o plano manda deixar parametrizável desde o início, e
 * parametrizável só vale se der para mexer sem abrir o banco.
 */

interface Tier {
  id: string;
  name: string;
  min_value: number;
  commission_pct: number;
  color: string;
}

interface Props {
  ownerId: string;
  tiers: Tier[];
  inicio: Date;
  fim: Date;
  metaAtual: number | null;
  membros: { member_user_id: string; display_name: string; email: string }[];
  taxaAtual?: number;
  pctAtual?: number;
}

/** Ponto de partida do plano: quatro faixas com comissão crescente. */
const ELOS_PADRAO = [
  { name: "Bronze", min_value: 0, commission_pct: 5, color: "#a16207" },
  { name: "Prata", min_value: 10000, commission_pct: 8, color: "#64748b" },
  { name: "Ouro", min_value: 30000, commission_pct: 10, color: "#ca8a04" },
  { name: "Diamante", min_value: 100000, commission_pct: 12, color: "#0891b2" },
];

const dia = (d: Date) => format(d, "yyyy-MM-dd");

export function MetrikSettings({ ownerId, tiers, inicio, fim, metaAtual, membros, taxaAtual, pctAtual }: Props) {
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [meta, setMeta] = useState(metaAtual != null ? String(metaAtual) : "");
  const [gasto, setGasto] = useState("");
  const [gastoDe, setGastoDe] = useState("__empresa__");
  const [novo, setNovo] = useState({ name: "", min_value: "", commission_pct: "" });
  const [taxa, setTaxa] = useState("");
  const [pctPadrao, setPctPadrao] = useState("");

  const salvarConfig = useMutation({
    mutationFn: async () => {
      const t = taxa.trim() === "" ? null : Number(taxa.replace(",", "."));
      const p = pctPadrao.trim() === "" ? null : Number(pctPadrao.replace(",", "."));
      if (t !== null && (!Number.isFinite(t) || t < 0 || t > 100)) throw new Error("Taxa deve ficar entre 0 e 100");
      if (p !== null && (!Number.isFinite(p) || p < 0 || p > 100)) throw new Error("Percentual deve ficar entre 0 e 100");

      const payload: Record<string, unknown> = { owner_id: ownerId, updated_at: new Date().toISOString() };
      if (t !== null) payload.platform_fee_pct = t;
      if (p !== null) payload.commission_pct = p;

      const { error } = await (supabase as any)
        .from("metrics_settings")
        .upsert(payload, { onConflict: "owner_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Configuração salva.");
      qc.invalidateQueries({ queryKey: ["metrics-settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const recarregar = () => {
    qc.invalidateQueries({ queryKey: ["metrics-tiers"] });
    qc.invalidateQueries({ queryKey: ["metrics-goal"] });
    qc.invalidateQueries({ queryKey: ["metrics-ad-spend"] });
  };

  const criarPadrao = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).from("metrics_tiers").insert(
        ELOS_PADRAO.map((e, i) => ({ ...e, owner_id: ownerId, position: i })),
      );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Elos padrão criados. Ajuste os valores como preferir.");
      recarregar();
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
          color: t.color || "#64748b",
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      setNovo({ name: "", min_value: "", commission_pct: "" });
      recarregar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removerElo = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("metrics_tiers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: recarregar,
    onError: (e: Error) => toast.error(e.message),
  });

  const salvarMeta = useMutation({
    mutationFn: async () => {
      const valor = Number(meta.replace(",", "."));
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
      recarregar();
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
      recarregar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Configurar
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Configurar Métrik</DialogTitle>
          <DialogDescription>
            Elos, meta e investimento do período de{" "}
            {format(inicio, "dd/MM")} a {format(fim, "dd/MM")}.
          </DialogDescription>
        </DialogHeader>

        {/* ── Elos ── */}
        <section className="space-y-2.5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Elos e comissão</h3>
            {tiers.length === 0 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => criarPadrao.mutate()}
                disabled={criarPadrao.isPending}
                className="gap-1.5 text-xs"
              >
                {criarPadrao.isPending ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Sparkles size={13} />
                )}
                Criar elos padrão
              </Button>
            )}
          </div>

          {tiers.map((t) => (
            <div key={t.id} className="flex items-center gap-2">
              <input
                type="color"
                value={t.color}
                onChange={(e) => salvarElo.mutate({ ...t, color: e.target.value })}
                className="h-8 w-8 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0.5"
                aria-label={`Cor do elo ${t.name}`}
              />
              <Input
                defaultValue={t.name}
                onBlur={(e) =>
                  e.target.value !== t.name && salvarElo.mutate({ ...t, name: e.target.value })
                }
                className="h-8 flex-1 text-sm"
                aria-label="Nome do elo"
              />
              <Input
                defaultValue={t.min_value}
                onBlur={(e) =>
                  salvarElo.mutate({ ...t, min_value: Number(e.target.value) || 0 })
                }
                className="h-8 w-24 text-sm tabular-nums"
                aria-label="Faturamento mínimo"
                title="Faturamento a partir do qual o vendedor entra neste elo"
              />
              <Input
                defaultValue={t.commission_pct}
                onBlur={(e) =>
                  salvarElo.mutate({ ...t, commission_pct: Number(e.target.value) || 0 })
                }
                className="h-8 w-14 text-sm tabular-nums"
                aria-label="Percentual de comissão"
                title="% de comissão neste elo"
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => removerElo.mutate(t.id)}
                className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                aria-label={`Remover elo ${t.name}`}
              >
                <Trash2 size={14} />
              </Button>
            </div>
          ))}

          <div className="flex items-center gap-2 border-t border-border pt-2.5">
            <Input
              placeholder="Novo elo"
              value={novo.name}
              onChange={(e) => setNovo({ ...novo, name: e.target.value })}
              className="h-8 flex-1 text-sm"
            />
            <Input
              placeholder="A partir de"
              value={novo.min_value}
              onChange={(e) => setNovo({ ...novo, min_value: e.target.value })}
              className="h-8 w-24 text-sm tabular-nums"
            />
            <Input
              placeholder="%"
              value={novo.commission_pct}
              onChange={(e) => setNovo({ ...novo, commission_pct: e.target.value })}
              className="h-8 w-14 text-sm tabular-nums"
            />
            <Button
              size="icon"
              variant="outline"
              className="h-8 w-8 shrink-0"
              disabled={!novo.name.trim() || salvarElo.isPending}
              onClick={() =>
                salvarElo.mutate({
                  name: novo.name.trim(),
                  min_value: Number(novo.min_value) || 0,
                  commission_pct: Number(novo.commission_pct) || 0,
                })
              }
              aria-label="Adicionar elo"
            >
              <Plus size={14} />
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Colunas: cor, nome, faturamento a partir do qual o elo vale, e % de comissão.
            As mudanças salvam ao sair do campo.
          </p>
        </section>

        {/* ── Taxas e comissão ── */}
        <section className="space-y-2 border-t border-border pt-4">
          <h3 className="text-sm font-semibold">Taxa da plataforma e comissão padrão</h3>
          <p className="text-[11px] text-muted-foreground">
            A taxa é descontada antes de comissionar: o checkout retém a parte dele antes de
            o dinheiro chegar, e comissionar sobre o bruto paga o vendedor por dinheiro que
            a empresa não recebeu. O percentual padrão vale para quem ainda não alcançou elo.
          </p>
          <div className="flex flex-wrap gap-2">
            <div className="space-y-1">
              <Label htmlFor="taxa" className="text-xs">Taxa da plataforma (%)</Label>
              <Input
                id="taxa"
                value={taxa}
                onChange={(e) => setTaxa(e.target.value)}
                placeholder={String(taxaAtual ?? 0)}
                className="h-9 w-32 tabular-nums"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pct" className="text-xs">Comissão padrão (%)</Label>
              <Input
                id="pct"
                value={pctPadrao}
                onChange={(e) => setPctPadrao(e.target.value)}
                placeholder={String(pctAtual ?? 10)}
                className="h-9 w-32 tabular-nums"
              />
            </div>
            <Button className="self-end" onClick={() => salvarConfig.mutate()} disabled={salvarConfig.isPending}>
              Salvar
            </Button>
          </div>
        </section>

        {/* ── Meta ── */}
        <section className="space-y-2 border-t border-border pt-4">
          <Label htmlFor="meta" className="text-sm font-semibold">
            Meta coletiva do período
          </Label>
          <div className="flex gap-2">
            <Input
              id="meta"
              value={meta}
              onChange={(e) => setMeta(e.target.value)}
              placeholder="Ex: 150000"
              className="h-9 tabular-nums"
            />
            <Button onClick={() => salvarMeta.mutate()} disabled={salvarMeta.isPending}>
              Salvar
            </Button>
          </div>
        </section>

        {/* ── Investimento ── */}
        <section className="space-y-2 border-t border-border pt-4">
          <Label htmlFor="gasto" className="text-sm font-semibold">
            Investimento em anúncio do período
          </Label>
          <div className="flex gap-2">
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
              id="gasto"
              value={gasto}
              onChange={(e) => setGasto(e.target.value)}
              placeholder="Ex: 4500"
              className="h-9 flex-1 tabular-nums"
            />
            <Button onClick={() => salvarGasto.mutate()} disabled={salvarGasto.isPending}>
              Lançar
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Só o gasto atribuído a um vendedor entra no ROAS dele. O da empresa fica no
            total, sem ser rateado — ROAS emprestado não se sustenta numa conversa.
          </p>
        </section>
      </DialogContent>
    </Dialog>
  );
}
