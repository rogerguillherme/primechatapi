import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MessageCircle, Phone, Send, Plug, Unplug, Loader2, CheckCircle2, XCircle, ExternalLink, Plus, RefreshCw, Building2, Shield, Zap, Globe } from "lucide-react";
import { toast } from "sonner";

const REDIRECT_URI = "https://primechatapi.lovable.app/auth/meta/callback";

/* ── helper badges ── */
function QualityBadge({ rating }: { rating?: string }) {
  if (!rating) return null;
  const colors: Record<string, string> = {
    GREEN: "bg-green-500/10 text-green-600 border-green-500/20",
    YELLOW: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20",
    RED: "bg-destructive/10 text-destructive border-destructive/20",
  };
  return (
    <Badge variant="outline" className={colors[rating] || ""}>
      {rating === "GREEN" ? "Alta" : rating === "YELLOW" ? "Média" : rating === "RED" ? "Baixa" : rating}
    </Badge>
  );
}

function StatusBadgeInline({ status }: { status?: string }) {
  if (!status) return null;
  const isConnected = status === "CONNECTED" || status === "connected";
  return (
    <Badge variant="outline" className={isConnected ? "bg-green-500/10 text-green-600 border-green-500/20" : "bg-muted text-muted-foreground"}>
      {isConnected ? <><CheckCircle2 className="h-3 w-3 mr-1" /> Conectado</> : status}
    </Badge>
  );
}

function NameStatusBadge({ status }: { status?: string }) {
  if (!status) return null;
  const map: Record<string, { label: string; cls: string }> = {
    APPROVED: { label: "Aprovado", cls: "bg-green-500/10 text-green-600 border-green-500/20" },
    DECLINED: { label: "Recusado", cls: "bg-destructive/10 text-destructive border-destructive/20" },
    PENDING_REVIEW: { label: "Em análise", cls: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20" },
    AVAILABLE_WITHOUT_REVIEW: { label: "Disponível", cls: "bg-green-500/10 text-green-600 border-green-500/20" },
  };
  const info = map[status] || { label: status, cls: "" };
  return <Badge variant="outline" className={info.cls}>{info.label}</Badge>;
}

export default function MetaConnect() {
  const { session, user } = useAuth();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isExchanging, setIsExchanging] = useState(false);
  const [testPhone, setTestPhone] = useState("");
  const [testMessage, setTestMessage] = useState("Teste de conexão OAuth WhatsApp");
  const [isSending, setIsSending] = useState(false);
  const [selectedWabaId, setSelectedWabaId] = useState<string>("");
  const [selectedPhoneId, setSelectedPhoneId] = useState<string>("");
  const [isAdding, setIsAdding] = useState(false);

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
    enabled: !!session,
  });
  const activeConnection = connections?.find((c: any) => c.status === "connected");

  // Fetch WABAs & numbers from Meta API
  const { data: metaData, isLoading: isLoadingMeta, refetch: refetchMeta } = useQuery({
    queryKey: ["meta-wabas"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("meta-list-numbers");
      if (error) throw error;
      return data?.wabas || [];
    },
    enabled: !!activeConnection,
  });

  // Fetch registered accounts
  const { data: registeredAccounts } = useQuery({
    queryKey: ["whatsapp-accounts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("whatsapp_accounts")
        .select("*")
        .order("is_default", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!session,
  });

  // Handle OAuth callback
  useEffect(() => {
    const code = searchParams.get("code");
    if (code && !isExchanging && session) {
      setIsExchanging(true);
      const nextSearchParams = new URLSearchParams(searchParams);
      nextSearchParams.delete("code");
      setSearchParams(nextSearchParams, { replace: true });

      (async () => {
        try {
          const { data, error } = await supabase.functions.invoke("meta-oauth-callback", {
            body: { code, redirect_uri: REDIRECT_URI },
          });
          if (error) {
            const errorPayload =
              typeof (error as any)?.context?.json === "function"
                ? await (error as any).context.json().catch(() => null)
                : null;
            throw new Error(errorPayload?.error || error.message || "Erro ao conectar WhatsApp");
          }
          if (data?.error) throw new Error(data.error);
          toast.success(`WhatsApp conectado! Número: ${data.phone_number}`);
          queryClient.invalidateQueries({ queryKey: ["meta-connections"] });
          queryClient.invalidateQueries({ queryKey: ["whatsapp-accounts"] });
          queryClient.invalidateQueries({ queryKey: ["meta-wabas"] });

          try {
            await supabase.functions.invoke("whatsapp-sync-templates", { body: {} });
            toast.success("Templates sincronizados automaticamente!");
            queryClient.invalidateQueries({ queryKey: ["user-templates"] });
          } catch {
            console.warn("Auto template sync failed");
          }
        } catch (err: any) {
          console.error("OAuth callback error:", err);
          toast.error(err.message || "Erro ao conectar WhatsApp");
        } finally {
          setIsExchanging(false);
        }
      })();
    }
  }, [isExchanging, queryClient, searchParams, session, setSearchParams]);

  const handleConnect = async () => {
    try {
      const { data, error } = await supabase.functions.invoke("meta-oauth-url", {
        body: { redirect_uri: REDIRECT_URI },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (data?.oauth_url) window.location.href = data.oauth_url;
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

  const handleAddNumber = async () => {
    if (!selectedWabaId || !selectedPhoneId) {
      toast.error("Selecione uma BM e um número");
      return;
    }
    const waba = metaData?.find((w: any) => w.id === selectedWabaId);
    const phone = waba?.phone_numbers?.find((p: any) => p.id === selectedPhoneId);
    if (!phone || !activeConnection) return;

    setIsAdding(true);
    try {
      // Check if already registered
      const { data: existing } = await supabase
        .from("whatsapp_accounts")
        .select("id")
        .eq("phone_number_id", phone.id)
        .maybeSingle();

      if (existing) {
        toast.info("Este número já está registrado");
        setIsAdding(false);
        return;
      }

      const { data: existingAccounts } = await supabase
        .from("whatsapp_accounts")
        .select("id");

      const { error } = await supabase.from("whatsapp_accounts").insert({
        name: phone.verified_name || phone.display_phone_number || "WhatsApp",
        phone_number_id: phone.id,
        business_account_id: selectedWabaId,
        access_token: activeConnection.meta_access_token,
        is_default: !existingAccounts || existingAccounts.length === 0,
      });

      if (error) throw error;
      toast.success(`Número ${phone.display_phone_number} adicionado!`);
      queryClient.invalidateQueries({ queryKey: ["whatsapp-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["meta-wabas"] });
      setSelectedPhoneId("");
    } catch (err: any) {
      toast.error(err.message || "Erro ao adicionar número");
    } finally {
      setIsAdding(false);
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

  const selectedWaba = metaData?.find((w: any) => w.id === selectedWabaId);
  const selectedPhone = selectedWaba?.phone_numbers?.find((p: any) => p.id === selectedPhoneId);

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-display font-bold">Conexão WhatsApp</h1>
        <p className="text-muted-foreground">
          Conecte sua conta WhatsApp Business via Meta para enviar mensagens.
        </p>
      </div>

      {/* ── OAuth Connection Card ── */}
      <Card className="border-primary/20 bg-gradient-to-r from-primary/5 to-transparent">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${activeConnection ? "bg-green-500/10" : "bg-muted"}`}>
                <MessageCircle className={`h-5 w-5 ${activeConnection ? "text-green-500" : "text-muted-foreground"}`} />
              </div>
              <div>
                <h2 className="text-lg font-semibold">Conexão via OAuth</h2>
                <p className="text-sm text-muted-foreground">
                  {activeConnection
                    ? "Conecte seu WhatsApp em 1 clique via login do Facebook. Não requer configuração manual."
                    : "Conecte seu WhatsApp Business para gerenciar números e enviar mensagens."}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {activeConnection ? (
                <>
                  <Badge className="bg-green-500/10 text-green-600 border-green-500/20">
                    <CheckCircle2 className="h-3 w-3 mr-1" /> Conectado
                  </Badge>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleDisconnect(activeConnection.id)}
                  >
                    <Unplug className="h-4 w-4 mr-1" />
                    Desconectar WhatsApp
                  </Button>
                </>
              ) : (
                <Button onClick={handleConnect} className="gap-2">
                  <Plug className="h-4 w-4" />
                  Conectar WhatsApp
                  <ExternalLink className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>

          {/* Connection info row */}
          {activeConnection && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
              <div className="rounded-lg border bg-card p-3">
                <p className="text-xs text-muted-foreground mb-1">Número conectado</p>
                <p className="font-medium">{activeConnection.phone_number}</p>
              </div>
              <div className="rounded-lg border bg-card p-3">
                <p className="text-xs text-muted-foreground mb-1">Phone Number ID</p>
                <p className="font-medium font-mono text-sm">{activeConnection.phone_number_id}</p>
              </div>
              <div className="rounded-lg border bg-card p-3">
                <p className="text-xs text-muted-foreground mb-1">WABA ID</p>
                <p className="font-medium font-mono text-sm">{activeConnection.waba_id}</p>
              </div>
            </div>
          )}

          {/* Test message inline */}
          {activeConnection && (
            <div className="mt-4">
              <p className="text-sm font-medium mb-2">Enviar teste</p>
              <div className="flex gap-2">
                <Input
                  placeholder="Telefone (ex: 1199999888)"
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                  className="max-w-[180px]"
                />
                <Input
                  placeholder="Mensagem de teste"
                  value={testMessage}
                  onChange={(e) => setTestMessage(e.target.value)}
                  className="flex-1"
                />
                <Button onClick={handleSendTest} disabled={isSending} size="default">
                  {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
                  Enviar
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── BM & Number Explorer ── */}
      {activeConnection && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="h-5 w-5" />
                  Números disponíveis na Meta
                </CardTitle>
                <CardDescription>
                  Selecione uma Business Manager e um número para adicionar ao sistema.
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => refetchMeta()} disabled={isLoadingMeta}>
                <RefreshCw className={`h-4 w-4 mr-1 ${isLoadingMeta ? "animate-spin" : ""}`} />
                Atualizar
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoadingMeta ? (
              <div className="flex items-center gap-2 text-muted-foreground py-4">
                <Loader2 className="h-4 w-4 animate-spin" />
                Buscando dados da Meta...
              </div>
            ) : !metaData || metaData.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">
                Nenhuma Business Manager encontrada. Verifique se sua conta tem acesso a uma WABA.
              </p>
            ) : (
              <>
                {/* BM selector */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Business Manager (WABA)</Label>
                    <Select value={selectedWabaId} onValueChange={(v) => { setSelectedWabaId(v); setSelectedPhoneId(""); }}>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione uma BM" />
                      </SelectTrigger>
                      <SelectContent>
                        {metaData.map((waba: any) => (
                          <SelectItem key={waba.id} value={waba.id}>
                            {waba.name} ({waba.id})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Number selector */}
                  <div className="space-y-2">
                    <Label>Número de telefone</Label>
                    <Select
                      value={selectedPhoneId}
                      onValueChange={setSelectedPhoneId}
                      disabled={!selectedWabaId}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={selectedWabaId ? "Selecione um número" : "Selecione uma BM primeiro"} />
                      </SelectTrigger>
                      <SelectContent>
                        {selectedWaba?.phone_numbers?.map((phone: any) => (
                          <SelectItem key={phone.id} value={phone.id}>
                            {phone.display_phone_number} — {phone.verified_name || "Sem nome"}{phone.is_registered ? " ✅" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* WABA details */}
                {selectedWaba && (
                  <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                    <h4 className="text-sm font-semibold flex items-center gap-2">
                      <Building2 className="h-4 w-4" />
                      Detalhes da BM: {selectedWaba.name}
                    </h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                      <div>
                        <p className="text-muted-foreground text-xs">WABA ID</p>
                        <p className="font-mono">{selectedWaba.id}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">Moeda</p>
                        <p>{selectedWaba.currency || "—"}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">Status de revisão</p>
                        <p>{selectedWaba.account_review_status || "—"}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">Namespace</p>
                        <p className="font-mono text-xs break-all">{selectedWaba.message_template_namespace || "—"}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Selected phone details */}
                {selectedPhone && (
                  <div className="rounded-lg border p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-semibold flex items-center gap-2">
                        <Phone className="h-4 w-4" />
                        {selectedPhone.display_phone_number}
                      </h4>
                      <div className="flex items-center gap-2">
                        <QualityBadge rating={selectedPhone.quality_rating} />
                        <StatusBadgeInline status={selectedPhone.status} />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                      <div>
                        <p className="text-muted-foreground text-xs">Nome verificado</p>
                        <p className="font-medium">{selectedPhone.verified_name || "—"}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">Status do nome</p>
                        <NameStatusBadge status={selectedPhone.name_status} />
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">Phone Number ID</p>
                        <p className="font-mono text-xs">{selectedPhone.id}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">Plataforma</p>
                        <p>{selectedPhone.platform_type || "—"}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">Limite de mensagens</p>
                        <p className="flex items-center gap-1">
                          <Zap className="h-3 w-3 text-muted-foreground" />
                          {selectedPhone.messaging_limit_tier || "—"}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">Throughput</p>
                        <p>{selectedPhone.throughput?.level || "—"}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">Verificação de código</p>
                        <p>{selectedPhone.code_verification_status || "—"}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">Conta oficial</p>
                        <p className="flex items-center gap-1">
                          {selectedPhone.is_official_business_account ? (
                            <><Shield className="h-3 w-3 text-green-500" /> Sim</>
                          ) : (
                            "Não"
                          )}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">Último onboarding</p>
                        <p>{selectedPhone.last_onboarded_time ? new Date(selectedPhone.last_onboarded_time).toLocaleDateString("pt-BR") : "—"}</p>
                      </div>
                    </div>

                    {/* Add button */}
                    <div className="pt-2">
                      {selectedPhone.is_registered ? (
                        <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20">
                          <CheckCircle2 className="h-3 w-3 mr-1" /> Já adicionado ao sistema
                        </Badge>
                      ) : (
                        <Button onClick={handleAddNumber} disabled={isAdding} className="gap-2">
                          {isAdding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                          Adicionar este número
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Registered Accounts ── */}
      {registeredAccounts && registeredAccounts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Globe className="h-5 w-5" />
              Números registrados no sistema
            </CardTitle>
            <CardDescription>
              Números adicionados e disponíveis para disparos e chat.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {registeredAccounts.map((acc: any) => (
                <div key={acc.id} className="flex items-center justify-between py-3 px-4 rounded-lg border">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                      <Phone className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">{acc.name}</p>
                      <p className="text-xs text-muted-foreground font-mono">{acc.phone_number_id}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {acc.is_default && (
                      <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 text-xs">
                        Padrão
                      </Badge>
                    )}
                    {acc.business_account_id && (
                      <span className="text-xs text-muted-foreground">
                        WABA: {acc.business_account_id}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
