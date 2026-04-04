import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Instagram, Plug, Unplug, Loader2, CheckCircle2, ExternalLink } from "lucide-react";
import { toast } from "sonner";

const REDIRECT_URI = "https://primechatapi.lovable.app/auth/instagram/callback";

interface InstagramConnection {
  id: string;
  user_id: string;
  instagram_user_id: string;
  instagram_username: string | null;
  page_id: string | null;
  page_name: string | null;
  access_token: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export function InstagramSettings() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [isConnecting, setIsConnecting] = useState(false);

  const { data: isAdmin } = useQuery({
    queryKey: ["user-role", user?.id],
    queryFn: async () => {
      if (!user) return false;
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .maybeSingle();
      return !!data;
    },
    enabled: !!user,
  });

  const { data: connections, isLoading } = useQuery({
    queryKey: ["instagram-connections"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("instagram_connections" as any)
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as InstagramConnection[];
    },
    enabled: !!user && isAdmin === true,
  });

  const activeConnection = connections?.find((c) => c.status === "connected");

  const handleConnect = async () => {
    setIsConnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke("instagram-oauth-url", {
        body: { redirect_uri: REDIRECT_URI },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (data?.oauth_url) window.location.href = data.oauth_url;
    } catch (err: any) {
      toast.error(err.message || "Erro ao gerar URL de conexão");
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async (id: string) => {
    const { error } = await (supabase.from("instagram_connections" as any) as any)
      .update({ status: "disconnected" })
      .eq("id", id);
    if (error) {
      toast.error("Erro ao desconectar");
    } else {
      toast.success("Instagram desconectado");
      queryClient.invalidateQueries({ queryKey: ["instagram-connections"] });
    }
  };

  if (!isAdmin) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Apenas administradores podem configurar a conexão do Instagram.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      <div>
        <h2 className="text-xl font-bold">Configuração do Instagram</h2>
        <p className="text-sm text-muted-foreground">
          Conecte sua conta Instagram Business via Meta OAuth
        </p>
      </div>

      <Card className="border-purple-500/20 bg-gradient-to-r from-purple-500/5 via-pink-500/5 to-transparent">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                activeConnection ? "bg-gradient-to-br from-purple-500/20 to-pink-500/20" : "bg-muted"
              }`}>
                <Instagram className={`h-5 w-5 ${activeConnection ? "text-purple-500" : "text-muted-foreground"}`} />
              </div>
              <div>
                <h3 className="text-lg font-semibold">Conexão Instagram via OAuth</h3>
                <p className="text-sm text-muted-foreground">
                  Conecte sua conta Instagram Business para gerenciar DMs, métricas e automações.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {activeConnection ? (
                <>
                  <Badge className="bg-green-500/10 text-green-600 border-green-500/20">
                    <CheckCircle2 className="h-3 w-3 mr-1" /> Conectado
                  </Badge>
                  <Button variant="destructive" size="sm" onClick={() => handleDisconnect(activeConnection.id)}>
                    <Unplug className="h-4 w-4 mr-1" /> Desconectar
                  </Button>
                </>
              ) : (
                <Button
                  onClick={handleConnect}
                  disabled={isConnecting}
                  className="gap-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
                >
                  {isConnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
                  Conectar Instagram
                  <ExternalLink className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>

          {activeConnection && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
              <div className="rounded-lg border bg-card p-3">
                <p className="text-xs text-muted-foreground mb-1">Conta</p>
                <p className="font-medium">{activeConnection.instagram_username || "—"}</p>
              </div>
              <div className="rounded-lg border bg-card p-3">
                <p className="text-xs text-muted-foreground mb-1">Instagram ID</p>
                <p className="font-medium font-mono text-sm">{activeConnection.instagram_user_id || "—"}</p>
              </div>
              <div className="rounded-lg border bg-card p-3">
                <p className="text-xs text-muted-foreground mb-1">Página vinculada</p>
                <p className="font-medium">{activeConnection.page_name || "—"}</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Requisitos para conexão</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-sm space-y-2 text-muted-foreground">
            <p>• Conta Instagram deve ser <strong>Business</strong> ou <strong>Creator</strong></p>
            <p>• A conta deve estar vinculada a uma <strong>Página do Facebook</strong></p>
            <p>• Você deve ter permissão de <strong>administrador</strong> na página</p>
            <p>• O app Meta deve ter os escopos: <code className="text-xs bg-muted px-1 py-0.5 rounded">instagram_basic</code>, <code className="text-xs bg-muted px-1 py-0.5 rounded">instagram_manage_messages</code>, <code className="text-xs bg-muted px-1 py-0.5 rounded">pages_show_list</code></p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
