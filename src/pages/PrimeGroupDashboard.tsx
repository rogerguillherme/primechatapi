import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Smartphone, Layers, UsersRound, ArrowRight } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";

interface Instancia {
  id: string;
  name: string;
  status: string | null;
  display_phone_number: string | null;
}

/**
 * Dashboard do Prime Group — números reais (instâncias, grupos, membros) e a
 * lista de instâncias. "Disparos"/"Fluxos" (como no produto original) só
 * fazem sentido quando Campanhas existir — fica pra essa fase, não aqui.
 */
export default function PrimeGroupDashboard() {
  const navigate = useNavigate();

  const { data: instancias = [] } = useQuery({
    queryKey: ["prime-group-instances"],
    queryFn: async () => {
      // `as any`: status/profile_picture são colunas novas em whatsapp_accounts,
      // ainda não refletidas nos tipos gerados.
      const { data, error } = await (supabase as any)
        .from("whatsapp_accounts")
        .select("id, name, status, display_phone_number")
        .eq("provider", "evolution")
        .order("name");
      if (error) throw error;
      return (data ?? []) as Instancia[];
    },
  });

  const { data: grupos = [] } = useQuery({
    queryKey: ["prime-group-groups-stats"],
    queryFn: async () => {
      // `as any`: whatsapp_groups é nova — os tipos do Supabase são gerados a
      // partir do banco e só a conhecerão depois que a migration rodar.
      const { data, error } = await (supabase as any).from("whatsapp_groups").select("participants_count");
      if (error) throw error;
      return (data ?? []) as { participants_count: number }[];
    },
  });

  const totalMembros = useMemo(
    () => grupos.reduce((s, g) => s + (g.participants_count || 0), 0),
    [grupos],
  );

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Visão geral do Prime Group</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard icon={Smartphone} label="Instâncias" value={instancias.length} onClick={() => navigate("/prime-group/instancias")} />
        <StatCard icon={Layers} label="Grupos" value={grupos.length} />
        <StatCard icon={UsersRound} label="Membros totais" value={totalMembros} />
      </div>

      <Card className="overflow-hidden">
        <div className="border-b border-border px-6 py-4">
          <h2 className="font-semibold">Instâncias</h2>
        </div>
        <div className="divide-y divide-border">
          {instancias.map((i) => (
            <button
              key={i.id}
              onClick={() => navigate("/prime-group/instancias")}
              className="w-full flex items-center justify-between px-6 py-4 hover:bg-muted/30 transition-colors text-left"
            >
              <div>
                <div className="font-medium">{i.name}</div>
                <div className="text-xs text-muted-foreground">{i.display_phone_number || "Não conectado"}</div>
              </div>
              <div className="flex items-center gap-3">
                <StatusBadge status={i.status} />
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </div>
            </button>
          ))}
          {instancias.length === 0 && (
            <div className="px-6 py-12 text-center text-sm text-muted-foreground">
              Nenhuma instância ainda.{" "}
              <button onClick={() => navigate("/prime-group/instancias")} className="text-primary hover:underline">
                Criar a primeira
              </button>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, onClick }: { icon: typeof Smartphone; label: string; value: number; onClick?: () => void }) {
  const conteudo = (
    <Card className={`p-5 ${onClick ? "hover:shadow-elevated transition-shadow cursor-pointer" : ""}`}>
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm text-muted-foreground">{label}</div>
          <div className="text-3xl font-bold mt-2 tabular-nums">{value.toLocaleString("pt-BR")}</div>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </Card>
  );
  return onClick ? <div onClick={onClick}>{conteudo}</div> : conteudo;
}

function StatusBadge({ status }: { status: string | null }) {
  const cfg = {
    online: { texto: "Online", classe: "bg-emerald-500/10 text-emerald-600" },
    connecting: { texto: "Conectando", classe: "bg-amber-500/10 text-amber-600" },
    offline: { texto: "Offline", classe: "bg-muted text-muted-foreground" },
  }[status || "offline"] ?? { texto: "Offline", classe: "bg-muted text-muted-foreground" };
  return <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded ${cfg.classe}`}>{cfg.texto}</span>;
}
