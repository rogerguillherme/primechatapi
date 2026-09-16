import { useMemo, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import {
  Users2, Loader2, Search, Download, Ban, Shield, Layers,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { logActivity, type PgGroupLead } from "@/lib/prime-group";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

/** Leads do Prime Group — participantes extraídos dos grupos (pg_group_leads).
 *  Busca, filtro por grupo, exportar CSV e mandar pra blacklist. A extração em
 *  si (varredura dos grupos via Evolution) é a fase final; aqui gerimos o que
 *  já foi coletado. */
export default function PrimeGroupLeads() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [busca, setBusca] = useState("");
  const [grupo, setGrupo] = useState("todos");

  const { data: leads = [], isLoading } = useQuery({
    queryKey: ["pg-group-leads"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("pg_group_leads").select("*").order("created_at", { ascending: false }).limit(5000);
      if (error) throw error;
      return (data ?? []) as PgGroupLead[];
    },
  });

  const grupos = useMemo(() => {
    const set = new Map<string, string>();
    for (const l of leads) if (l.group_jid) set.set(l.group_jid, l.group_name || l.group_jid);
    return Array.from(set.entries());
  }, [leads]);

  const filtrados = useMemo(() => {
    const q = busca.toLowerCase();
    return leads.filter((l) =>
      (grupo === "todos" || l.group_jid === grupo) &&
      (!q || (l.name || "").toLowerCase().includes(q) || l.phone.includes(q)),
    );
  }, [leads, busca, grupo]);

  const paraBlacklist = useMutation({
    mutationFn: async (l: PgGroupLead) => {
      if (!user?.id) throw new Error("Sessão expirada.");
      const { error } = await (supabase as any).from("pg_blacklist")
        .upsert({ user_id: user.id, phone: l.phone, reason: "Adicionado pela tela de Leads" }, { onConflict: "user_id,phone" });
      if (error) throw error;
      await logActivity({ type: "info", title: `Número ${l.phone} entrou na blacklist` });
    },
    onSuccess: () => toast.success("Adicionado à blacklist."),
    onError: (e: any) => toast.error(e?.message || "Erro."),
  });

  function exportarCSV() {
    if (filtrados.length === 0) { toast.error("Nada para exportar."); return; }
    const linhas = [["Nome", "Telefone", "Grupo", "Admin"], ...filtrados.map((l) =>
      [l.name || "", l.phone, l.group_name || "", l.is_admin ? "sim" : "não"])];
    const csv = linhas.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `leads-prime-group-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
    toast.success(`${filtrados.length} leads exportados.`);
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-display font-bold flex items-center gap-2">
            <Users2 className="h-6 w-6 text-primary" /> Leads
          </h1>
          <p className="text-sm text-muted-foreground">Contatos extraídos dos seus grupos</p>
        </div>
        <Button variant="outline" onClick={exportarCSV} disabled={filtrados.length === 0}>
          <Download className="h-4 w-4 mr-1.5" /> Exportar CSV
        </Button>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome ou telefone…" className="pl-8" />
        </div>
        <Select value={grupo} onValueChange={setGrupo}>
          <SelectTrigger className="w-56"><Layers className="h-4 w-4 mr-1.5" /><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os grupos</SelectItem>
            {grupos.map(([jid, nome]) => <SelectItem key={jid} value={jid}>{nome}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <p className="text-sm text-muted-foreground">
        {isLoading ? "Carregando…" : `${filtrados.length.toLocaleString("pt-BR")} leads`}
      </p>

      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando…
        </div>
      ) : leads.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground">
          <Users2 className="h-10 w-10 mx-auto text-muted-foreground/40" />
          <p className="mt-3">Nenhum lead coletado ainda.</p>
          <p className="text-sm mt-1">A extração de participantes dos grupos entra junto com o motor Evolution (fase final).</p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="divide-y divide-border max-h-[60vh] overflow-y-auto">
            {filtrados.slice(0, 1000).map((l) => (
              <div key={l.id} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/30 transition-colors">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-semibold shrink-0">
                  {(l.name || l.phone).charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{l.name || "Sem nome"}</span>
                    {l.is_admin && <Shield className="h-3.5 w-3.5 text-amber-500" aria-label="Admin" />}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">{l.phone} · {l.group_name}</div>
                </div>
                <Button size="sm" variant="ghost" className="text-red-600 hover:text-red-700 shrink-0"
                  disabled={paraBlacklist.isPending} onClick={() => paraBlacklist.mutate(l)}>
                  <Ban className="h-3.5 w-3.5 mr-1" /> Blacklist
                </Button>
              </div>
            ))}
            {filtrados.length > 1000 && (
              <div className="px-5 py-3 text-center text-xs text-muted-foreground">
                Mostrando os primeiros 1.000. Use a busca/filtro ou exporte o CSV para o conjunto completo.
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
