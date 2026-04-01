import { useState, useEffect } from "react";
import { useSearchParams, Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { MessageCircle, Phone, Send, Plug, Unplug, Loader2, CheckCircle2, XCircle, ExternalLink } from "lucide-react";
import { toast } from "sonner";

const REDIRECT_URI = `${window.location.origin}/connect`;

export default function MetaConnect() {
  const { session, user } = useAuth();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isExchanging, setIsExchanging] = useState(false);
  const [testPhone, setTestPhone] = useState("");
  const [testMessage, setTestMessage] = useState("Olá! Esta é uma mensagem de teste do Prime Chat. 🚀");
  const [isSending, setIsSending] = useState(false);

  // Check if user is admin
  const { data: isAdmin, isLoading: isAdminLoading } = useQuery({
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

  // Fetch user connections
  const { data: connections, isLoading } = useQuery({
    queryKey: ["meta-connections"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meta_connections")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!session && isAdmin === true,
  });

  // Redirect non-admins (after all hooks)
  if (!isAdminLoading && !isAdmin) {
    return <Navigate to="/" replace />;
  }

  const activeConnection = connections?.find((c: any) => c.status === "connected");

  // Handle OAuth callback
  useEffect(() => {
    const code = searchParams.get("code");
    if (code && !isExchanging) {
      setIsExchanging(true);
      searchParams.delete("code");
      setSearchParams(searchParams, { replace: true });

      (async () => {
        try {
          const { data, error } = await supabase.functions.invoke("meta-oauth-callback", {
            body: { code, redirect_uri: REDIRECT_URI },
          });
          if (error) throw error;
          if (data?.error) throw new Error(data.error);

          toast.success(`WhatsApp conectado! Número: ${data.phone_number}`);
          queryClient.invalidateQueries({ queryKey: ["meta-connections"] });
        } catch (err: any) {
          console.error("OAuth callback error:", err);
          toast.error(err.message || "Erro ao conectar WhatsApp");
        } finally {
          setIsExchanging(false);
        }
      })();
    }
  }, [searchParams]);

  const handleConnect = async () => {
    try {
      const { data, error } = await supabase.functions.invoke("meta-oauth-url", {
        body: { redirect_uri: REDIRECT_URI },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (data?.oauth_url) {
        window.location.href = data.oauth_url;
      }
    } catch (err: any) {
      toast.error(err.message || "Erro ao gerar URL de conexão");
    }
  };

  const handleDisconnect = async (connectionId: string) => {
    const { error } = await supabase
      .from("meta_connections")
      .update({ status: "disconnected" })
      .eq("id", connectionId);

    if (error) {
      toast.error("Erro ao desconectar");
    } else {
      toast.success("WhatsApp desconectado");
      queryClient.invalidateQueries({ queryKey: ["meta-connections"] });
    }
  };

  const handleSendTest = async () => {
    if (!testPhone.trim() || !testMessage.trim()) {
      toast.error("Preencha o número e a mensagem");
      return;
    }
    setIsSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("meta-send-test", {
        body: { to: testPhone, message: testMessage },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("Mensagem enviada com sucesso!");
    } catch (err: any) {
      toast.error(err.message || "Erro ao enviar mensagem");
    } finally {
      setIsSending(false);
    }
  };

  if (isLoading || isExchanging) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center space-y-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
          <p className="text-muted-foreground">
            {isExchanging ? "Conectando WhatsApp..." : "Carregando..."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div>
        <h1 className="text-2xl font-display font-bold">Conexão WhatsApp</h1>
        <p className="text-muted-foreground">
          Conecte sua conta WhatsApp Business via Meta para enviar mensagens.
        </p>
      </div>

      {/* Status Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${activeConnection ? "bg-green-500/10" : "bg-muted"}`}>
                <MessageCircle className={`h-5 w-5 ${activeConnection ? "text-green-500" : "text-muted-foreground"}`} />
              </div>
              <div>
                <CardTitle className="text-lg">Status WhatsApp</CardTitle>
                <CardDescription>
                  {activeConnection
                    ? `Conectado ao número ${activeConnection.phone_number}`
                    : "Nenhuma conexão ativa"}
                </CardDescription>
              </div>
            </div>
            <Badge variant={activeConnection ? "default" : "secondary"} className={activeConnection ? "bg-green-500/10 text-green-600 border-green-500/20" : ""}>
              {activeConnection ? (
                <><CheckCircle2 className="h-3 w-3 mr-1" /> Conectado</>
              ) : (
                <><XCircle className="h-3 w-3 mr-1" /> Desconectado</>
              )}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {activeConnection ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <Phone className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{activeConnection.phone_number}</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>WABA ID: {activeConnection.waba_id}</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => handleDisconnect(activeConnection.id)}
              >
                <Unplug className="h-4 w-4 mr-2" />
                Desconectar
              </Button>
            </div>
          ) : (
            <Button onClick={handleConnect} className="gap-2">
              <Plug className="h-4 w-4" />
              Conectar WhatsApp
              <ExternalLink className="h-3 w-3" />
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Test Message Card */}
      {activeConnection && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Enviar Mensagem de Teste</CardTitle>
            <CardDescription>
              Teste sua conexão enviando uma mensagem via WhatsApp Cloud API.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="test-phone">Número do destinatário</Label>
              <Input
                id="test-phone"
                placeholder="5511999999999"
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Formato: código do país + DDD + número (sem espaços ou símbolos)
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="test-message">Mensagem</Label>
              <Input
                id="test-message"
                placeholder="Digite sua mensagem..."
                value={testMessage}
                onChange={(e) => setTestMessage(e.target.value)}
              />
            </div>
            <Button onClick={handleSendTest} disabled={isSending} className="gap-2">
              {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Enviar Teste
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Connection History */}
      {connections && connections.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Histórico de Conexões</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {connections.map((conn: any) => (
                <div key={conn.id} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div className="text-sm">
                    <span className="font-medium">{conn.phone_number}</span>
                    <span className="text-muted-foreground ml-2">
                      {new Date(conn.created_at).toLocaleDateString("pt-BR")}
                    </span>
                  </div>
                  <Badge variant={conn.status === "connected" ? "default" : "secondary"} className="text-xs">
                    {conn.status}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
