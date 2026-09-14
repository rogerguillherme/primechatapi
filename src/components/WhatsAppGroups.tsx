import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, UsersRound, Loader2, Copy, Check } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { EvolutionConnectCard } from "@/components/EvolutionConnectCard";

interface EvolutionAccount {
  id: string;
  name: string;
  phone_number_id: string;
  groups_synced_at: string | null;
}

interface WhatsAppGroup {
  id: string;
  group_jid: string;
  name: string;
  description: string | null;
  photo_url: string | null;
  participants_count: number;
  admins_count: number;
  invite_link: string | null;
  updated_at: string;
}

/**
 * Grupos WhatsApp sincronizados via Evolution API — primeira fatia portada
 * do Group Flow Hub pro Prime Chat. Reaproveita a conta Evolution já
 * conectada em Configuração; aqui só sincroniza e mostra o dashboard.
 */
export function WhatsAppGroups() {
  const qc = useQueryClient();
  const [contaId, setContaId] = useState<string>("");
  const [copiado, setCopiado] = useState<string | null>(null);

  const { data: accounts, isLoading: carregandoContas } = useQuery({
    queryKey: ["evolution-groups-accounts"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("evolution-groups", { body: { action: "accounts" } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return (data?.accounts ?? []) as EvolutionAccount[];
    },
  });

  const contaAtual = contaId || accounts?.[0]?.id || "";
  const contaSelecionada = accounts?.find((a) => a.id === contaAtual);

  const { data: groups, isLoading: carregandoGrupos } = useQuery({
    queryKey: ["whatsapp-groups", contaAtual],
    enabled: !!contaAtual,
    queryFn: async () => {
      // `as any`: whatsapp_groups é novo — os tipos do Supabase são gerados a
      // partir do banco e só conhecerão a tabela depois que a migration rodar.
      const { data, error } = await (supabase as any)
        .from("whatsapp_groups")
        .select("id, group_jid, name, description, photo_url, participants_count, admins_count, invite_link, updated_at")
        .eq("account_id", contaAtual)
        .order("participants_count", { ascending: false });
      if (error) throw error;
      return (data ?? []) as WhatsAppGroup[];
    },
  });

  const sincronizar = useMutation({
    mutationFn: async () => {
      if (!contaAtual) throw new Error("Selecione uma conta Evolution.");
      const { data, error } = await supabase.functions.invoke("evolution-groups", {
        body: { action: "sync", account_id: contaAtual },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data.count as number;
    },
    onSuccess: (count) => {
      toast.success(`${count} grupo(s) sincronizado(s).`);
      qc.invalidateQueries({ queryKey: ["whatsapp-groups", contaAtual] });
      qc.invalidateQueries({ queryKey: ["evolution-groups-accounts"] });
    },
    onError: (e: Error) => toast.error(e.message || "Erro ao sincronizar grupos"),
  });

  const copiarLink = async (link: string, id: string) => {
    try {
      await navigator.clipboard.writeText(link);
      setCopiado(id);
      toast.success("Link copiado.");
      setTimeout(() => setCopiado(null), 2000);
    } catch {
      toast.error("Não consegui copiar. Copie manualmente: " + link);
    }
  };

  if (!carregandoContas && (!accounts || accounts.length === 0)) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-display font-bold">Grupos</h1>
          <p className="text-muted-foreground text-sm">
            Nenhuma conta WhatsApp conectada ainda — conecte uma abaixo pra sincronizar grupos.
          </p>
        </div>
        <EvolutionConnectCard onConnected={() => qc.invalidateQueries({ queryKey: ["evolution-groups-accounts"] })} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-display font-bold">Grupos</h1>
        <p className="text-muted-foreground text-sm">
          Grupos do WhatsApp sincronizados da conta Evolution conectada.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              {accounts && accounts.length > 1 ? (
                <Select value={contaAtual} onValueChange={setContaId}>
                  <SelectTrigger className="h-9 w-56">
                    <SelectValue placeholder="Conta" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-sm font-medium">{accounts?.[0]?.name}</p>
              )}
              {contaSelecionada?.groups_synced_at && (
                <span className="text-xs text-muted-foreground">
                  última sincronização: {new Date(contaSelecionada.groups_synced_at).toLocaleString("pt-BR")}
                </span>
              )}
            </div>
            <Button size="sm" onClick={() => sincronizar.mutate()} disabled={sincronizar.isPending || !contaAtual} className="gap-2">
              {sincronizar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Sincronizar
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3 font-medium">Grupo</th>
                <th className="px-4 py-3 font-medium">Membros</th>
                <th className="px-4 py-3 font-medium">Admins</th>
                <th className="px-4 py-3 font-medium">Atualizado</th>
                <th className="px-4 py-3 font-medium">Convite</th>
              </tr>
            </thead>
            <tbody>
              {(groups ?? []).map((g) => (
                <tr key={g.id} className="border-b border-border/50 last:border-0">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {g.photo_url ? (
                        <img src={g.photo_url} alt="" className="h-8 w-8 rounded-full object-cover" />
                      ) : (
                        <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                          <UsersRound size={14} className="text-muted-foreground" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="font-medium truncate max-w-[240px]">{g.name}</p>
                        {g.description && (
                          <p className="text-xs text-muted-foreground truncate max-w-[240px]">{g.description}</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 tabular-nums">{g.participants_count}</td>
                  <td className="px-4 py-3 tabular-nums text-muted-foreground">{g.admins_count}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(g.updated_at).toLocaleDateString("pt-BR")}
                  </td>
                  <td className="px-4 py-3">
                    {g.invite_link ? (
                      <Button
                        size="sm" variant="ghost" className="h-7 gap-1.5 text-xs"
                        onClick={() => copiarLink(g.invite_link!, g.id)}
                      >
                        {copiado === g.id ? <Check size={12} /> : <Copy size={12} />}
                        {copiado === g.id ? "Copiado" : "Copiar"}
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!carregandoGrupos && (groups ?? []).length === 0 && (
          <div className="p-6 text-center text-sm text-muted-foreground">
            Nenhum grupo sincronizado ainda. Clique em "Sincronizar" acima.
          </div>
        )}
        {carregandoGrupos && (
          <div className="p-6 text-center text-sm text-muted-foreground">Carregando…</div>
        )}
      </Card>
    </div>
  );
}
