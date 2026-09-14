import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus, Smartphone, RefreshCw, Loader2, QrCode, Power, Pencil, Trash2, UsersRound,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  invokeEvolutionInstance, resolveQrToDataUrl, normalizePairingCode,
} from "@/lib/evolution-connect";

interface Instancia {
  id: string;
  name: string;
  status: string | null;
  display_phone_number: string | null;
  profile_picture: string | null;
  groups_synced_at: string | null;
}

type QrState = {
  accountId: string | null;
  name: string;
  qr: string | null;
  code: string | null;
  loading: boolean;
  error: string | null;
};

/**
 * Instâncias do Prime Group — múltiplas conexões Evolution (uma linha em
 * whatsapp_accounts cada), com QR, status, renomear, excluir e sincronizar
 * grupos por instância. Aquecimento (warmup) fica pra uma fase própria.
 */
export default function PrimeGroupInstances() {
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [nome, setNome] = useState("");
  const [servidor, setServidor] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [creating, setCreating] = useState(false);
  const [qrState, setQrState] = useState<QrState | null>(null);
  const pollRef = useRef<number | null>(null);

  const { data: instancias = [], isLoading } = useQuery({
    queryKey: ["prime-group-instances"],
    queryFn: async () => {
      // `as any`: status/profile_picture são colunas novas em whatsapp_accounts,
      // ainda não refletidas nos tipos gerados.
      const { data, error } = await (supabase as any)
        .from("whatsapp_accounts")
        .select("id, name, status, display_phone_number, profile_picture, groups_synced_at")
        .eq("provider", "evolution")
        .order("name");
      if (error) throw error;
      return (data ?? []) as Instancia[];
    },
  });

  const { data: groupCounts = {} } = useQuery({
    queryKey: ["prime-group-instance-group-counts"],
    queryFn: async () => {
      // `as any`: whatsapp_groups é nova — os tipos do Supabase são gerados a
      // partir do banco e só a conhecerão depois que a migration rodar.
      const { data, error } = await (supabase as any).from("whatsapp_groups").select("account_id");
      if (error) throw error;
      const counts: Record<string, number> = {};
      for (const g of (data ?? []) as { account_id: string }[]) {
        counts[g.account_id] = (counts[g.account_id] || 0) + 1;
      }
      return counts;
    },
  });

  const stopPolling = () => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };
  useEffect(() => stopPolling, []);

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["prime-group-instances"] });
    qc.invalidateQueries({ queryKey: ["prime-group-instance-group-counts"] });
  };

  const startPolling = (accountId: string) => {
    stopPolling();
    pollRef.current = window.setInterval(async () => {
      try {
        const status = await invokeEvolutionInstance({ action: "status", account_id: accountId }, 1);
        if (String(status?.state) === "open") {
          stopPolling();
          toast.success("WhatsApp conectado com sucesso! 🎉");
          refreshAll();
          setTimeout(() => setQrState(null), 1200);
        }
      } catch {
        // Erro transitório de status não interrompe o polling.
      }
    }, 3000) as unknown as number;
  };

  const handleCreate = async () => {
    if (!nome.trim()) {
      toast.error("Informe o nome da instância.");
      return;
    }
    setCreating(true);
    try {
      const data = await invokeEvolutionInstance({
        action: "create_and_connect",
        name: nome.trim(),
        serverUrl: servidor.trim() || undefined,
        apiKey: apiKey.trim() || undefined,
        is_default: instancias.length === 0,
      });
      toast.success(data?.already_existed ? "Instância já existia — gerando QR…" : "Instância criada! Escaneie o QR.");
      setCreateOpen(false);
      setNome("");
      setServidor("");
      setApiKey("");
      refreshAll();
      await openQr(data.account_id, nome.trim(), data);
    } catch (e: any) {
      toast.error(`Erro: ${e.message}`);
    } finally {
      setCreating(false);
    }
  };

  async function openQr(accountId: string, name: string, prefetched?: any) {
    setQrState({ accountId, name, qr: null, code: null, loading: true, error: null });
    try {
      const data = prefetched ?? (await invokeEvolutionInstance({ action: "connect", account_id: accountId }));
      const qr = data?.qr_code ? await resolveQrToDataUrl(String(data.qr_code)) : null;
      setQrState({ accountId, name, qr, code: normalizePairingCode(data?.pairing_code), loading: false, error: null });
      startPolling(accountId);
    } catch (e: any) {
      setQrState({ accountId, name, qr: null, code: null, loading: false, error: e?.message ?? "Falha ao gerar QR" });
    }
  }

  const logoutMutation = useMutation({
    mutationFn: (id: string) => invokeEvolutionInstance({ action: "logout", account_id: id }),
    onSuccess: () => { refreshAll(); toast.success("Instância desconectada."); },
    onError: (e: any) => toast.error(e.message),
  });

  const syncMutation = useMutation({
    mutationFn: async (accountId: string) => {
      const { data, error } = await supabase.functions.invoke("evolution-groups", { body: { action: "sync", account_id: accountId } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data.count as number;
    },
    onSuccess: (count) => { refreshAll(); toast.success(`${count} grupo(s) sincronizado(s).`); },
    onError: (e: any) => toast.error(e.message || "Erro ao sincronizar grupos"),
  });

  const renameMutation = useMutation({
    mutationFn: async (v: { id: string; name: string }) => {
      const { error } = await supabase.from("whatsapp_accounts").update({ name: v.name }).eq("id", v.id);
      if (error) throw error;
    },
    onSuccess: () => { refreshAll(); toast.success("Nome atualizado."); },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("whatsapp_accounts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { refreshAll(); toast.success("Instância excluída."); },
    onError: (e: any) => toast.error(e.message),
  });

  function promptRename(inst: Instancia) {
    const next = window.prompt("Novo nome da instância", inst.name)?.trim();
    if (!next || next === inst.name) return;
    renameMutation.mutate({ id: inst.id, name: next });
  }

  function promptDelete(inst: Instancia) {
    if (confirm(`Excluir "${inst.name}"? Isso apaga também os grupos sincronizados dela. Não pode ser desfeito.`)) {
      deleteMutation.mutate(inst.id);
    }
  }

  const refreshStatus = useMutation({
    mutationFn: (id: string) => invokeEvolutionInstance({ action: "status", account_id: id }, 1),
    onSuccess: refreshAll,
  });

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold">Instâncias</h1>
          <p className="text-sm text-muted-foreground">Conecte e gerencie suas conexões WhatsApp</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2"><Plus size={16} /> Nova instância</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Nova instância</DialogTitle>
              <DialogDescription>
                Nome da conexão e, se necessário, servidor/API key da Evolution (deixe em branco se a
                conta já tiver os secrets padrão configurados no backend).
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Nome</Label>
                <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Atendimento principal" autoFocus />
              </div>
              <div className="space-y-1.5">
                <Label>Servidor Evolution (URL)</Label>
                <Input value={servidor} onChange={(e) => setServidor(e.target.value)} placeholder="https://sua-evolution.com" />
              </div>
              <div className="space-y-1.5">
                <Label>API Key</Label>
                <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="••••••••" />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={handleCreate} disabled={creating} className="gap-2">
                {creating && <Loader2 size={14} className="animate-spin" />}
                Criar e gerar QR
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : instancias.length === 0 ? (
        <Card className="p-12 text-center">
          <Smartphone className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <h3 className="font-semibold">Nenhuma instância ainda</h3>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {instancias.map((inst) => (
            <InstanceCard
              key={inst.id}
              inst={inst}
              groupCount={groupCounts[inst.id] || 0}
              onConnect={() => openQr(inst.id, inst.name)}
              onSync={() => syncMutation.mutate(inst.id)}
              onLogout={() => { if (confirm(`Desconectar ${inst.name}?`)) logoutMutation.mutate(inst.id); }}
              onRefreshStatus={() => refreshStatus.mutate(inst.id)}
              onRename={() => promptRename(inst)}
              onDelete={() => promptDelete(inst)}
              syncing={syncMutation.isPending && syncMutation.variables === inst.id}
              loggingOut={logoutMutation.isPending && logoutMutation.variables === inst.id}
              refreshingStatus={refreshStatus.isPending && refreshStatus.variables === inst.id}
            />
          ))}
        </div>
      )}

      <Dialog open={!!qrState} onOpenChange={(o) => { if (!o) { stopPolling(); setQrState(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Conectar {qrState?.name}</DialogTitle>
            <DialogDescription>
              Abra o WhatsApp no celular → Configurações → Aparelhos conectados → Conectar aparelho.
            </DialogDescription>
          </DialogHeader>
          {qrState && (
            <div className="flex flex-col items-center gap-3 py-4">
              {qrState.loading ? (
                <div className="h-56 w-56 flex items-center justify-center text-muted-foreground">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : qrState.error ? (
                <div className="text-sm text-destructive text-center max-w-xs">{qrState.error}</div>
              ) : qrState.qr ? (
                <img src={qrState.qr} alt="QR Code" className="h-56 w-56 rounded-lg border border-border" />
              ) : (
                <div className="text-sm text-muted-foreground">Sem QR disponível.</div>
              )}
              {qrState.code && (
                <p className="text-[11px] text-muted-foreground text-center">
                  Ou use o código de pareamento: <span className="font-mono font-bold">{qrState.code}</span>
                </p>
              )}
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <QrCode size={13} /> Aguardando confirmação…
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { stopPolling(); setQrState(null); }}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InstanceCard({
  inst, groupCount, onConnect, onSync, onLogout, onRefreshStatus, onRename, onDelete,
  syncing, loggingOut, refreshingStatus,
}: {
  inst: Instancia;
  groupCount: number;
  onConnect: () => void;
  onSync: () => void;
  onLogout: () => void;
  onRefreshStatus: () => void;
  onRename: () => void;
  onDelete: () => void;
  syncing: boolean;
  loggingOut: boolean;
  refreshingStatus: boolean;
}) {
  const isOnline = inst.status === "online";
  return (
    <Card className="p-5 hover:shadow-elevated transition-shadow">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {inst.profile_picture ? (
            <img src={inst.profile_picture} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover border border-border" />
          ) : (
            <div className="h-11 w-11 shrink-0 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold">
              <UsersRound size={18} />
            </div>
          )}
          <div className="min-w-0">
            <div className="font-semibold truncate">{inst.name}</div>
            <div className="text-xs text-muted-foreground truncate">{inst.display_phone_number || "Sem número"}</div>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onRename} title="Renomear">
            <Pencil size={14} />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={onDelete} title="Excluir">
            <Trash2 size={14} />
          </Button>
          <StatusBadge status={inst.status} onClick={onRefreshStatus} loading={refreshingStatus} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mt-4 text-sm">
        <Stat label="Grupos" value={groupCount} />
        <Stat label="Última sync" value={inst.groups_synced_at ? new Date(inst.groups_synced_at).toLocaleDateString("pt-BR") : "—"} />
      </div>

      <div className="mt-4 flex gap-2 flex-wrap">
        {isOnline ? (
          <>
            <Button size="sm" variant="outline" className="flex-1" onClick={onSync} disabled={syncing}>
              <RefreshCw size={14} className={syncing ? "animate-spin" : ""} /> Sincronizar
            </Button>
            <Button size="sm" variant="outline" onClick={onLogout} disabled={loggingOut} title="Desconectar">
              {loggingOut ? <Loader2 size={14} className="animate-spin" /> : <Power size={14} />}
            </Button>
          </>
        ) : (
          <Button size="sm" className="flex-1 gap-1.5" onClick={onConnect}>
            <QrCode size={14} /> Conectar
          </Button>
        )}
      </div>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-muted/50 px-3 py-2">
      <div className="text-[11px] uppercase text-muted-foreground tracking-wide">{label}</div>
      <div className="font-medium tabular-nums">{value}</div>
    </div>
  );
}

function StatusBadge({ status, onClick, loading }: { status: string | null; onClick: () => void; loading: boolean }) {
  const cfg = {
    online: { texto: "Online", classe: "bg-emerald-500/10 text-emerald-600" },
    connecting: { texto: "Conectando", classe: "bg-amber-500/10 text-amber-600" },
    offline: { texto: "Offline", classe: "bg-muted text-muted-foreground" },
  }[status || "offline"] ?? { texto: "Offline", classe: "bg-muted text-muted-foreground" };
  return (
    <button
      onClick={onClick}
      title="Atualizar status"
      className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded flex items-center gap-1 ${cfg.classe}`}
    >
      {loading ? <Loader2 size={10} className="animate-spin" /> : null}
      {cfg.texto}
    </button>
  );
}
