import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Upload, FileSpreadsheet, Loader2, AlertTriangle, Check } from "lucide-react";
import {
  autoDetectMapping, planImport, parseRow, chunk,
  normalizePhoneBR, FIELD_LABEL, REQUIRED_FIELDS,
  type ColumnMapping, type FieldKey, type ImportPlan, type ParsedOrder,
} from "@/lib/salesImport";

const NONE = "__none__";
const FIELDS = Object.keys(FIELD_LABEL) as FieldKey[];

/**
 * Importa as vendas do mês a partir da planilha exportada pela plataforma.
 *
 * Funciona com qualquer origem (Hubla, Applyfy, Kiwify, Hotmart, Perfect Pay)
 * porque não depende de API: o que varia entre elas é o cabeçalho, e isso o
 * mapeamento de colunas resolve.
 *
 * Reimportar o mesmo mês é seguro — a chave é `orders.external_order_id`, e
 * pedido já existente é atualizado em vez de duplicado. É o engano mais
 * provável de todos, então tinha que ser inofensivo.
 */
export function SalesImporter() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [fileName, setFileName] = useState("");
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [busy, setBusy] = useState<null | "lendo" | "conferindo" | "gravando">(null);

  const reset = () => {
    setFileName(""); setColumns([]); setRows([]); setMapping({}); setPlan(null);
  };

  const handleFile = async (file: File) => {
    setBusy("lendo");
    setPlan(null);
    try {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();

      // CSV precisa ser decodificado por nós. O leitor de planilha assume
      // CP1252 quando recebe bytes, e o relatório vem em UTF-8: "Valor
      // líquido" chegava como "Valor lÃ­quido" e a detecção não reconhecia a
      // coluna — o líquido caía em "Valor" e o faturamento entrava já
      // descontado, sem taxa nenhuma registrada. Some sem erro na tela.
      //
      // XLSX é binário e continua indo como bytes; só o texto é decodificado.
      const ehTexto = /\.(csv|txt|tsv)$/i.test(file.name);
      let wb;
      if (ehTexto) {
        let texto: string;
        try {
          // fatal: arquivo que não for UTF-8 lança em vez de virar lixo.
          texto = new TextDecoder("utf-8", { fatal: true }).decode(buf);
        } catch {
          // Planilha antiga exportada em Windows-1252 ainda é comum.
          texto = new TextDecoder("windows-1252").decode(buf);
        }
        wb = XLSX.read(texto.replace(/^﻿/, ""), { type: "string" });
      } else {
        wb = XLSX.read(buf, { type: "array" });
      }
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const parsed = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

      if (!parsed.length) {
        toast.error("A planilha está vazia");
        return;
      }
      const cols = Object.keys(parsed[0]);
      setFileName(file.name);
      setColumns(cols);
      setRows(parsed);
      setMapping(autoDetectMapping(cols));
    } catch (e: any) {
      console.error("[importação] falha ao ler planilha:", e);
      toast.error("Não consegui ler esse arquivo. Exporte em .xlsx ou .csv.");
    } finally {
      setBusy(null);
    }
  };

  const missingRequired = REQUIRED_FIELDS.filter((f) => !mapping[f]);

  const buildPlan = async () => {
    if (!user) return;
    setBusy("conferindo");
    try {
      const results = rows.map((row, i) => parseRow(row, mapping, i + 2));
      const ids = results.filter((r) => r.ok).map((r) => (r as any).order.externalOrderId as string);

      // Quais já existem. Em lotes: `.in()` com a planilha inteira estoura.
      const existing = new Set<string>();
      for (const part of chunk(ids, 200)) {
        const { data, error } = await supabase
          .from("orders")
          .select("external_order_id")
          .in("external_order_id", part);
        if (error) throw error;
        for (const o of data || []) existing.add(o.external_order_id);
      }

      setPlan(planImport(results, existing));
    } catch (e: any) {
      console.error("[importação] falha ao conferir:", e);
      toast.error(e.message || "Erro ao conferir a planilha");
    } finally {
      setBusy(null);
    }
  };

  const commit = async () => {
    if (!plan || !user) return;
    setBusy("gravando");
    try {
      const all = [...plan.create, ...plan.update];

      // 1. Lead por telefone normalizado — mesma regra do webhook, para não
      //    criar um comprador novo para quem já conversa no WhatsApp.
      const phones = [...new Set(all.map((o) => normalizePhoneBR(o.phone)).filter(Boolean))];
      const leadIdByPhone = new Map<string, string>();
      for (const part of chunk(phones, 200)) {
        const { data, error } = await supabase
          .from("leads")
          .select("id, phone")
          .in("phone", part)
          .eq("user_id", user.id);
        if (error) throw error;
        for (const l of data || []) leadIdByPhone.set(l.phone, l.id);
      }

      const novos = all
        .filter((o) => !leadIdByPhone.has(normalizePhoneBR(o.phone)))
        .reduce((acc, o) => {
          const phone = normalizePhoneBR(o.phone);
          if (!acc.has(phone)) acc.set(phone, { user_id: user.id, name: o.name || phone, phone, origin: "importacao" });
          return acc;
        }, new Map<string, any>());

      for (const part of chunk([...novos.values()], 200)) {
        const { data, error } = await supabase.from("leads").insert(part).select("id, phone");
        if (error) throw error;
        for (const l of data || []) leadIdByPhone.set(l.phone, l.id);
      }

      // 2. Produto pelo nome do checkout, quando já cadastrado. Sem match o
      //    pedido entra sem produto — melhor que inventar cadastro.
      const productNames = [...new Set(all.map((o) => o.productName).filter(Boolean) as string[])];
      const productIdByName = new Map<string, string>();
      for (const part of chunk(productNames, 200)) {
        const { data } = await supabase
          .from("products")
          .select("id, checkout_name")
          .in("checkout_name", part);
        for (const p of data || []) productIdByName.set(p.checkout_name, p.id);
      }

      // 3. Upsert por external_order_id — reimportar atualiza, não duplica.
      const toRow = (o: ParsedOrder) => ({
        user_id: user.id,
        lead_id: leadIdByPhone.get(normalizePhoneBR(o.phone))!,
        product_id: o.productName ? productIdByName.get(o.productName) ?? null : null,
        external_order_id: o.externalOrderId,
        amount: o.amount,
        // O líquido informado pela planilha dá a taxa exata da venda. Sem ele,
        // o cálculo cai na regra percentual configurada — que erra muito em
        // venda parcelada, justamente onde a taxa é maior.
        net_amount: o.netAmount,
        status: o.status,
        payment_method: o.paymentMethod,
        ...(o.createdAt ? { created_at: o.createdAt } : {}),
      });

      let gravados = 0;
      for (const part of chunk(all, 200)) {
        const { error } = await supabase
          .from("orders")
          .upsert(part.map(toRow), { onConflict: "external_order_id" });
        if (error) throw error;
        gravados += part.length;
      }

      const comLiquido = all.filter((o) => o.netAmount != null).length;
      toast.success(
        `${gravados} pedidos importados` +
          (comLiquido ? `, ${comLiquido} com taxa real da plataforma` : ""),
      );
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["abandoned-carts"] });
      // As telas do Métrik leem por outras chaves; sem isto os números
      // continuariam os de antes da importação.
      for (const k of ["metrik-orders", "metrik-vendas", "metrik-historico", "metrik-historico-ciclos"]) {
        queryClient.invalidateQueries({ queryKey: [k] });
      }
      reset();
    } catch (e: any) {
      console.error("[importação] falha ao gravar:", e);
      toast.error(e.message || "Erro ao gravar os pedidos");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Importar vendas"
        description="Suba a planilha exportada da sua plataforma. Reimportar o mesmo período é seguro: pedido já registrado é atualizado, não duplicado."
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <FileSpreadsheet size={16} /> Planilha
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-center gap-3 border border-dashed border-border rounded-lg p-4 cursor-pointer hover:bg-muted/40 transition-colors">
            <Upload size={18} className="text-muted-foreground shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{fileName || "Escolher arquivo .xlsx ou .csv"}</p>
              <p className="text-xs text-muted-foreground">
                {rows.length ? `${rows.length.toLocaleString("pt-BR")} linhas lidas` : "Exporte as vendas do período na plataforma"}
              </p>
            </div>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
                e.target.value = "";
              }}
            />
          </label>
          {busy === "lendo" && (
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Loader2 size={13} className="animate-spin" /> Lendo a planilha...
            </p>
          )}
        </CardContent>
      </Card>

      {columns.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Colunas</CardTitle>
            <p className="text-[11px] text-muted-foreground">
              Preenchi o que reconheci pelo cabeçalho. Confira os dois obrigatórios.
            </p>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {FIELDS.map((field) => (
              <div key={field} className="space-y-1.5">
                <Label className="text-xs">{FIELD_LABEL[field]}</Label>
                <Select
                  value={mapping[field] ?? NONE}
                  onValueChange={(v) => {
                    setPlan(null);
                    setMapping((m) => ({ ...m, [field]: v === NONE ? undefined : v }));
                  }}
                >
                  <SelectTrigger className="h-9"><SelectValue placeholder="Não usar" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Não usar</SelectItem>
                    {columns.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}

            <div className="sm:col-span-2 flex items-center gap-3 pt-1">
              <Button onClick={buildPlan} disabled={!!busy || missingRequired.length > 0} className="gap-1.5">
                {busy === "conferindo" && <Loader2 size={15} className="animate-spin" />}
                Conferir antes de gravar
              </Button>
              {missingRequired.length > 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-500">
                  Falta indicar: {missingRequired.map((f) => FIELD_LABEL[f].replace(" *", "")).join(" e ")}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {plan && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Pré-visualização</CardTitle>
            <p className="text-[11px] text-muted-foreground">Nada foi gravado ainda.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                ["Novos", plan.create.length, "text-emerald-600 dark:text-emerald-400"],
                ["Atualizam", plan.update.length, "text-sky-600 dark:text-sky-400"],
                ["Recusados", plan.errors.length, "text-destructive"],
                ["Repetidos no arquivo", plan.duplicatesInFile, "text-muted-foreground"],
              ].map(([label, n, cls]) => (
                <div key={label as string} className="rounded-lg border border-border p-3">
                  <p className={`text-2xl font-bold tabular-nums ${cls}`}>{n as number}</p>
                  <p className="text-[11px] text-muted-foreground">{label as string}</p>
                </div>
              ))}
            </div>

            {plan.errors.length > 0 && (
              <div className="rounded-lg border border-border overflow-hidden">
                <div className="px-3 py-2 bg-muted/40 text-xs font-medium flex items-center gap-1.5">
                  <AlertTriangle size={13} className="text-destructive" /> Linhas que não entram
                </div>
                <div className="max-h-52 overflow-y-auto divide-y divide-border">
                  {plan.errors.slice(0, 100).map((e, i) => (
                    <div key={i} className="px-3 py-1.5 text-xs flex gap-3">
                      <span className="text-muted-foreground tabular-nums shrink-0">linha {e.rowNumber}</span>
                      <span className="flex-1">{e.reason}</span>
                      {e.hint && <span className="text-muted-foreground truncate max-w-[10rem]">{e.hint}</span>}
                    </div>
                  ))}
                  {plan.errors.length > 100 && (
                    <p className="px-3 py-1.5 text-xs text-muted-foreground">
                      e mais {plan.errors.length - 100}...
                    </p>
                  )}
                </div>
              </div>
            )}

            <div className="flex items-center gap-3">
              <Button
                onClick={commit}
                disabled={!!busy || plan.create.length + plan.update.length === 0}
                className="gap-1.5"
              >
                {busy === "gravando" ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                Gravar {plan.create.length + plan.update.length} pedidos
              </Button>
              <Button variant="ghost" onClick={reset} disabled={!!busy}>Cancelar</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
