import { useEffect, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import {
  Settings, Loader2, Save, ShieldAlert, Ban, Plus, Trash2, Timer,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { type PgSettings } from "@/lib/prime-group";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface Blacklisted { id: string; phone: string; reason: string | null; created_at: string; }

const PADRAO: PgSettings = { default_interval_min: 8, default_interval_max: 25, anti_ban: true, daily_limit: 500 };

/** Configurações do módulo — padrões de intervalo/anti-ban/limite (pg_settings)
 *  e gestão da blacklist (pg_blacklist). */
export default function PrimeGroupSettings() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [form, setForm] = useState<PgSettings>(PADRAO);
  const [novoTel, setNovoTel] = useState("");

  const { data: settings, isLoading } = useQuery({
    queryKey: ["pg-settings"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("pg_settings").select("*").maybeSingle();
      if (error) throw error;
      return (data ?? null) as PgSettings | null;
    },
  });
  useEffect(() => { if (settings) setForm({ ...PADRAO, ...settings }); }, [settings]);

  const salvar = useMutation({
    mutationFn: async () => {
      if (!user?.id) throw new Error("Sessão expirada.");
      if (form.default_interval_min > form.default_interval_max)
        throw new Error("O intervalo mínimo não pode ser maior que o máximo.");
      const { error } = await (supabase as any).from("pg_settings").upsert({
        user_id: user.id,
        default_interval_min: form.default_interval_min,
        default_interval_max: form.default_interval_max,
        anti_ban: form.anti_ban,
        daily_limit: form.daily_limit,
      }, { onConflict: "user_id" });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["pg-settings"] }); toast.success("Configurações salvas."); },
    onError: (e: any) => toast.error(e?.message || "Erro ao salvar."),
  });

  const { data: blacklist = [] } = useQuery({
    queryKey: ["pg-blacklist"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("pg_blacklist").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Blacklisted[];
    },
  });

  const addBlacklist = useMutation({
    mutationFn: async () => {
      if (!user?.id) throw new Error("Sessão expirada.");
      const tel = novoTel.replace(/\D/g, "");
      if (tel.length < 8) throw new Error("Telefone inválido.");
      const { error } = await (supabase as any).from("pg_blacklist")
        .upsert({ user_id: user.id, phone: tel, reason: "Manual" }, { onConflict: "user_id,phone" });
      if (error) throw error;
    },
    onSuccess: () => { setNovoTel(""); qc.invalidateQueries({ queryKey: ["pg-blacklist"] }); toast.success("Adicionado."); },
    onError: (e: any) => toast.error(e?.message || "Erro."),
  });

  const removerBlacklist = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("pg_blacklist").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["pg-blacklist"] }); toast.success("Removido."); },
    onError: (e: any) => toast.error(e?.message || "Erro."),
  });

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-display font-bold flex items-center gap-2">
          <Settings className="h-6 w-6 text-primary" /> Configurações
        </h1>
        <p className="text-sm text-muted-foreground">Padrões de envio e proteção anti-ban do Prime Group</p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando…
        </div>
      ) : (
        <>
          <Card className="p-6 space-y-5">
            <h2 className="font-semibold flex items-center gap-2"><Timer className="h-4 w-4 text-primary" /> Envio</h2>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Intervalo mínimo (s)</Label>
                <Input type="number" min={1} value={form.default_interval_min}
                  onChange={(e) => setForm((f) => ({ ...f, default_interval_min: Math.max(1, +e.target.value || 1) }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Intervalo máximo (s)</Label>
                <Input type="number" min={1} value={form.default_interval_max}
                  onChange={(e) => setForm((f) => ({ ...f, default_interval_max: Math.max(1, +e.target.value || 1) }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Limite diário de envios (por instância)</Label>
              <Input type="number" min={1} value={form.daily_limit}
                onChange={(e) => setForm((f) => ({ ...f, daily_limit: Math.max(1, +e.target.value || 1) }))} />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-emerald-600" />
                <div>
                  <p className="text-sm font-medium">Proteção anti-ban</p>
                  <p className="text-xs text-muted-foreground">Intervalos aleatórios e limites por número para reduzir risco de bloqueio.</p>
                </div>
              </div>
              <Switch checked={form.anti_ban} onCheckedChange={(v) => setForm((f) => ({ ...f, anti_ban: v }))} />
            </div>
            <div>
              <Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>
                {salvar.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Save className="h-4 w-4 mr-1.5" />} Salvar
              </Button>
            </div>
          </Card>

          <Card className="p-6 space-y-4">
            <h2 className="font-semibold flex items-center gap-2"><Ban className="h-4 w-4 text-red-500" /> Blacklist ({blacklist.length})</h2>
            <p className="text-xs text-muted-foreground">Números aqui nunca recebem disparos, em nenhuma campanha.</p>
            <div className="flex gap-2">
              <Input value={novoTel} onChange={(e) => setNovoTel(e.target.value)} placeholder="Telefone (só números, com DDD)"
                onKeyDown={(e) => e.key === "Enter" && addBlacklist.mutate()} />
              <Button variant="outline" onClick={() => addBlacklist.mutate()} disabled={addBlacklist.isPending}>
                <Plus className="h-4 w-4 mr-1" /> Adicionar
              </Button>
            </div>
            {blacklist.length > 0 && (
              <div className="border border-border rounded-lg divide-y divide-border max-h-64 overflow-y-auto">
                {blacklist.map((b) => (
                  <div key={b.id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span>{b.phone} {b.reason && <span className="text-xs text-muted-foreground">· {b.reason}</span>}</span>
                    <button onClick={() => removerBlacklist.mutate(b.id)} className="text-muted-foreground hover:text-red-600">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
