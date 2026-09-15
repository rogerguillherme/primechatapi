import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTeamContext } from "@/hooks/use-team";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { MessageCircle, Phone, Send, Plug, Unplug, Loader2, CheckCircle2, ExternalLink, Plus, RefreshCw, Building2, Shield, Zap, Globe, ChevronDown, ChevronUp, KeyRound, Check } from "lucide-react";
import { toast } from "sonner";

const REDIRECT_URI = "https://primechatapi.lovable.app/auth/meta/callback";

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

export default function MetaConnect() {
  const { session, user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isExchanging, setIsExchanging] = useState(false);
  const [testPhone, setTestPhone] = useState("");
  const [testMessage, setTestMessage] = useState("Teste de conexão OAuth WhatsApp");
  const [isSending, setIsSending] = useState(false);
  const [addingPhoneId, setAddingPhoneId] = useState<string | null>(null);
  const [expandedWaba, setExpandedWaba] = useState<string | null>(null);
  const [registeringPhoneId, setRegisteringPhoneId] = useState<string | null>(null);
  const [registrationPin, setRegistrationPin] = useState("123456");
  const [metaAppId, setMetaAppId] = useState("");
  const [metaAppSecret, setMetaAppSecret] = useState("");
  const [savingMetaApp, setSavingMetaApp] = useState(false);

  const { data: team } = useTeamContext();
  const podeConfigurarApp = !team || team.accessLevel === "owner" || team.accessLevel === "manager";

  const { data: appProprio, isLoading: isLoadingAppProprio } = useQuery({
    queryKey: ["meta-app-proprio"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("meta_apps")
        .select("app_id, configured_at")
        .maybeSingle();
      if (error) throw error;
      return data as { app_id: string; configured_at: string } | null;
    },
    enabled: !!session,
  });

  const handleSalvarMetaApp = async () => {
    if (!metaAppId.trim() || !metaAppSecret.trim()) {
      toast.error("Informe o App ID e o App Secret");
      return;
    }
    setSavingMetaApp(true);
    try {
      const { data, error } = await supabase.functions.invoke("meta-app-credentials", {
        body: { app_id: metaAppId.trim(), app_secret: metaAppSecret.trim() },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("App Meta salvo. Já pode conectar por ele.");
      setMetaAppId("");
      setMetaAppSecret("");
      queryClient.invalidateQueries({ queryKey: ["meta-app-proprio"] });
    } catch (err: any) {
      toast.error(err.message || "Erro ao salvar o app Meta");
    } finally {
      setSavingMetaApp(false);
    }
  };

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

  const { data: metaData, isLoading: isLoadingMeta, refetch: refetchMeta } = useQuery({
    queryKey: ["meta-wabas"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("meta-list-numbers");
      if (error) throw error;
      return data?.wabas || [];
    },
    enabled: !!activeConnection,
  });

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
    const oauthState = searchParams.get("state");
    if (code && !isExchanging && session) {
      setIsExchanging(true);
      const nextSearchParams = new URLSearchParams(searchParams);
      nextSearchParams.delete("code");
      nextSearchParams.delete("state");
      setSearchParams(nextSearchParams, { replace: true });

      (async () => {
        try {
          const { data, error } = await supabase.functions.invoke("meta-oauth-callback", {
            body: {
              code,
              redirect_uri: REDIRECT_URI,
              state: oauthState,
              app: localStorage.getItem("meta_oauth_app") || "prime",
            },
          });
          if (error) {
            const errorPayload =
              typeof (error as any)?.context?.json === "function"
                ? await (error as any).context.json().catch(() => null)
                : null;
            throw new Error(errorPayload?.error || error.message || "Erro ao conectar WhatsApp");
          }
          if (data?.error) throw new Error(data.error);
          toast.success("Conta Meta conectada! Agora selecione uma BM e número abaixo.");
          queryClient.invalidateQueries({ queryKey: ["meta-connections"] });
          queryClient.invalidateQueries({ queryKey: ["meta-wabas"] });
          localStorage.removeItem("meta_oauth_app");
        } catch (err: any) {
          console.error("OAuth callback error:", err);
          toast.error(err.message || "Erro ao conectar WhatsApp");
        } finally {
          setIsExchanging(false);
        }
      })();
    }
  }, [isExchanging, queryClient, searchParams, session, setSearchParams]);

  const handleConnect = async (app: "prime" | "crm" = "crm") => {
    try {
      // O mesmo app precisa autorizar e trocar o código, por isso a escolha
      // fica guardada até o retorno da Meta.
      localStorage.setItem("meta_oauth_app", app);
      const { data, error } = await supabase.functions.invoke("meta-oauth-url", {
        body: { redirect_uri: REDIRECT_URI, app },
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

  const handleAddNumber = async (waba: any, phone: any) => {
    if (!activeConnection || !user) {
      toast.error("Sessão expirada. Faça login novamente.");
      return;
    }

    setAddingPhoneId(phone.id);
    let inserted: any = null;
    try {
      const { data: existing } = await supabase
        .from("whatsapp_accounts")
        .select("id")
        .eq("phone_number_id", phone.id)
        .maybeSingle();

      if (existing) {
        const { error: updateErr } = await supabase.from("whatsapp_accounts").update({
          access_token: activeConnection.meta_access_token,
          app_id: (activeConnection as any).app_id ?? null,
          business_account_id: waba.id,
          name: phone.verified_name || phone.display_phone_number || "WhatsApp",
          display_phone_number: phone.display_phone_number || null,
        }).eq("id", existing.id);

        if (updateErr) throw updateErr;
        toast.success(`Token atualizado para o número ${phone.display_phone_number}`);
        inserted = existing;
      } else {
        const { data: existingAccounts } = await supabase
          .from("whatsapp_accounts")
          .select("id");

        const { data: insertedData, error } = await supabase.from("whatsapp_accounts").insert({
          user_id: user.id,
          name: phone.verified_name || phone.display_phone_number || "WhatsApp",
          phone_number_id: phone.id,
          display_phone_number: phone.display_phone_number || null,
          business_account_id: waba.id,
          access_token: activeConnection.meta_access_token,
          app_id: (activeConnection as any).app_id ?? null,
          is_default: !existingAccounts || existingAccounts.length === 0,
        }).select("id").single();

        if (error) {
          if ((error as any).code === "23505" || /duplicate key|unique constraint/i.test(error.message)) {
            toast.error("Este número já está vinculado a outra conta neste sistema.");
            return;
          }
          throw error;
        }
        inserted = insertedData;
        toast.success(`Número ${phone.display_phone_number} adicionado!`);
      }

      queryClient.invalidateQueries({ queryKey: ["whatsapp-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["meta-wabas"] });

      // Registro na Cloud API (obrigatorio para enviar e receber).
      // Sem PIN de 6 digitos valido a Meta rejeita (#133005) e sem registro o
      // envio volta #133010. O erro NAO pode ser engolido.
      if (!/^\d{6}$/.test(registrationPin)) {
        toast.warning(
          "Numero adicionado, mas ainda NAO registrado. Informe o PIN de 6 digitos da verificacao em duas etapas e clique em Registrar abaixo para habilitar envio e recebimento.",
        );
      } else {
        try {
          const { data: regData, error: regError } = await supabase.functions.invoke("whatsapp-register-phone", {
            body: { phone_number_id: phone.id, pin: registrationPin },
          });
          const regFail = regError?.message || (regData as any)?.error;
          if (regFail) {
            const code = (regData as any)?.error_code ? ` (codigo ${(regData as any).error_code})` : "";
            toast.error(
              `Falha ao registrar o numero${code}: ${regFail}. Confira o PIN de 6 digitos e registre novamente abaixo.`,
            );
          } else {
            toast.success("Numero registrado na API do WhatsApp!");
          }
        } catch (regErr: any) {
          toast.error(`Erro ao registrar o numero: ${regErr?.message || regErr}. Registre novamente abaixo com o PIN correto.`);
        }
      }
      // Subscribe webhook
      const { data: subData, error: subErr } = await supabase.functions.invoke(
        "whatsapp-subscribe-webhook",
        { body: { account_id: inserted?.id } },
      );
      
      const subFail = subErr?.message || (subData as any)?.error;
      if (subFail) {
        toast.error(`Falha ao configurar o webhook (recebimento): ${subFail}`);
      } else if (subData?.success) {
        toast.success("Webhook configurado com sucesso.");
      }

      try {
        await supabase.functions.invoke("whatsapp-sync-templates", { body: {} });
        queryClient.invalidateQueries({ queryKey: ["user-templates"] });
      } catch {}
    } catch (err: any) {
      toast.error(err.message || "Erro ao adicionar número");
    } finally {
      setAddingPhoneId(null);
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
            {isExchanging ? "Conectando conta Meta..." : "Carregando..."}
          </p>
        </div>
      </div>
    );
  }

  const registeredPhoneIds = new Set((registeredAccounts || []).map((a: any) => a.phone_number_id));

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-display font-bold">Conexão WhatsApp</h1>
        <p className="text-muted-foreground">
          Conecte sua conta Meta e escolha qual Business Manager e número configurar.
        </p>
      </div>

      {/* ── App Meta da conta ──
          O Prime tem só dois apps Meta fixos ("Prime" e "CRM"), e nenhum dos
          dois tem Advanced Access aprovado pra WABA de qualquer cliente — só
          as que o Roger cadastrou manualmente como tester em cada um. Com o
          app da própria conta, é o dono acessando a própria WABA: não
          depende de revisão nenhuma da Meta. */}
      {podeConfigurarApp && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-primary" />
              <h2 className="font-semibold">App Meta da conta</h2>
              {appProprio && (
                <span className="ml-auto flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
                  <Check className="h-3 w-3" /> Configurado
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Cadastre o App ID e o App Secret do seu próprio app em developers.facebook.com,
              com os produtos WhatsApp Business e Login do Facebook ativados. A conexão passa a
              usar esse app — funciona sem depender de revisão da Meta, porque é o app do dono
              acessando a própria WABA. O App Secret é gravado e{" "}
              <b>nunca é devolvido pra tela</b> — nem pra você. Pra trocar, cole os dois de novo.
            </p>

            {!isLoadingAppProprio && (
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <div className="space-y-1">
                  <Label htmlFor="meta-app-id" className="text-xs">App ID</Label>
                  <Input
                    id="meta-app-id"
                    value={metaAppId}
                    onChange={(e) => setMetaAppId(e.target.value)}
                    placeholder={appProprio ? appProprio.app_id : "Ex: 1234567890123456"}
                    className="h-9 w-56 font-mono text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="meta-app-secret" className="text-xs">App Secret</Label>
                  <Input
                    id="meta-app-secret"
                    type="password"
                    value={metaAppSecret}
                    onChange={(e) => setMetaAppSecret(e.target.value)}
                    placeholder="••••••••••••••••"
                    className="h-9 w-56 font-mono text-xs"
                  />
                </div>
                <Button size="sm" onClick={handleSalvarMetaApp} disabled={savingMetaApp}>
                  {savingMetaApp && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                  Salvar
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

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
                    ? "Conta Meta conectada. Selecione abaixo qual BM e número deseja usar."
                    : "Conecte seu WhatsApp Business via login do Facebook."}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {activeConnection ? (
                <>
                  <Badge className="bg-green-500/10 text-green-600 border-green-500/20">
                    <CheckCircle2 className="h-3 w-3 mr-1" /> Conectado
                  </Badge>
                  {appProprio ? (
                    <Button variant="outline" size="sm" onClick={() => handleConnect()} className="gap-2">
                      <RefreshCw className="h-4 w-4" /> Reconectar
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => handleConnect("crm")} className="gap-2">
                      <RefreshCw className="h-4 w-4" /> Reconectar pelo CRM
                    </Button>
                  )}
                  <Button variant="destructive" size="sm" onClick={() => handleDisconnect(activeConnection.id)}>
                    <Unplug className="h-4 w-4 mr-1" /> Desconectar
                  </Button>
                </>
              ) : appProprio ? (
                <Button onClick={() => handleConnect()} className="gap-2">
                  <Plug className="h-4 w-4" />
                  Conectar via Meta
                  <ExternalLink className="h-3 w-3" />
                </Button>
              ) : (
                <>
                  <Button onClick={() => handleConnect("crm")} className="gap-2">
                    <Plug className="h-4 w-4" />
                    Conectar pelo app CRM
                    <ExternalLink className="h-3 w-3" />
                  </Button>
                  <Button variant="outline" onClick={() => handleConnect("prime")} className="gap-2">
                    <Plug className="h-4 w-4" />
                    Conectar pelo app Prime
                    <ExternalLink className="h-3 w-3" />
                  </Button>
                </>
              )}
            </div>
          </div>

          {activeConnection && (
            <div className="mt-4">
              <p className="text-sm font-medium mb-2">Enviar teste</p>
              <div className="flex gap-2">
                <Input placeholder="Telefone (ex: 5511999998888)" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} className="max-w-[200px]" />
                <Input placeholder="Mensagem de teste" value={testMessage} onChange={(e) => setTestMessage(e.target.value)} className="flex-1" />
                <Button onClick={handleSendTest} disabled={isSending} size="default">
                  {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
                  Enviar
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── BMs & Numbers ── */}
      {activeConnection && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="h-5 w-5" />
                  Business Managers & Números
                </CardTitle>
                <CardDescription>
                  Visualize todas as BMs vinculadas à sua conta Meta e adicione os números que deseja usar.
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
              <div className="flex items-center gap-2 text-muted-foreground py-6 justify-center">
                <Loader2 className="h-5 w-5 animate-spin" />
                Buscando BMs e números da Meta...
              </div>
            ) : !metaData || metaData.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Building2 className="h-10 w-10 mx-auto mb-3 opacity-40" />
                <p className="font-medium">Nenhuma Business Manager encontrada</p>
                <p className="text-sm mt-1">Verifique se sua conta Meta tem acesso a uma conta WhatsApp Business.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {metaData.map((waba: any) => {
                  const isExpanded = expandedWaba === waba.id;
                  const phoneCount = waba.phone_numbers?.length || 0;
                  const registeredCount = waba.phone_numbers?.filter((p: any) => registeredPhoneIds.has(p.id)).length || 0;

                  return (
                    <div key={waba.id} className="rounded-lg border overflow-hidden">
                      {/* WABA Header */}
                      <button
                        onClick={() => setExpandedWaba(isExpanded ? null : waba.id)}
                        className="w-full flex items-center justify-between p-4 hover:bg-muted/50 transition-colors text-left"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                            <Building2 className="h-5 w-5 text-primary" />
                          </div>
                          <div>
                            <p className="font-semibold">{waba.name || waba.id}</p>
                            <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                              <span className="font-mono">ID: {waba.id}</span>
                              {waba.currency && <span>• {waba.currency}</span>}
                              {waba.account_review_status && <span>• {waba.account_review_status}</span>}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-right text-sm">
                            <span className="text-muted-foreground">{phoneCount} número{phoneCount !== 1 ? "s" : ""}</span>
                            {registeredCount > 0 && (
                              <span className="ml-2 text-green-600">{registeredCount} adicionado{registeredCount !== 1 ? "s" : ""}</span>
                            )}
                          </div>
                          {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                        </div>
                      </button>

                      {/* Phone Numbers */}
                      {isExpanded && (
                        <div className="border-t bg-muted/20">
                          {phoneCount === 0 ? (
                            <div className="p-4 text-sm text-muted-foreground text-center">
                              Nenhum número encontrado nesta BM.
                            </div>
                          ) : (
                            <div className="divide-y">
                              {waba.phone_numbers.map((phone: any) => {
                                const isRegistered = registeredPhoneIds.has(phone.id);
                                const isAddingThis = addingPhoneId === phone.id;

                                return (
                                  <div key={phone.id} className="p-4 flex items-start justify-between gap-4">
                                    <div className="flex items-start gap-3 flex-1 min-w-0">
                                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${isRegistered ? "bg-green-500/10" : "bg-muted"}`}>
                                        <Phone className={`h-4 w-4 ${isRegistered ? "text-green-500" : "text-muted-foreground"}`} />
                                      </div>
                                      <div className="min-w-0">
                                        <p className="font-medium text-sm">{phone.display_phone_number}</p>
                                        <p className="text-xs text-muted-foreground">{phone.verified_name || "Sem nome verificado"}</p>

                                        <div className="flex flex-wrap items-center gap-2 mt-2">
                                          <QualityBadge rating={phone.quality_rating} />
                                          <StatusBadgeInline status={phone.status} />
                                          {phone.messaging_limit_tier && (
                                            <Badge variant="outline" className="text-xs">
                                              <Zap className="h-3 w-3 mr-1" />
                                              Tier: {phone.messaging_limit_tier}
                                            </Badge>
                                          )}
                                          {phone.is_official_business_account && (
                                            <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/20 text-xs">
                                              <Shield className="h-3 w-3 mr-1" /> Oficial
                                            </Badge>
                                          )}
                                        </div>

                                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 mt-2 text-xs text-muted-foreground">
                                          <span>ID: <span className="font-mono">{phone.id}</span></span>
                                          {phone.platform_type && <span>Plataforma: {phone.platform_type}</span>}
                                          {phone.code_verification_status && <span>Verificação: {phone.code_verification_status}</span>}
                                        </div>
                                      </div>
                                    </div>

                                    <div className="shrink-0">
                                      {isRegistered ? (
                                        <Badge className="bg-green-500/10 text-green-600 border-green-500/20">
                                          <CheckCircle2 className="h-3 w-3 mr-1" /> Adicionado
                                        </Badge>
                                      ) : (
                                        <Button
                                          size="sm"
                                          onClick={() => handleAddNumber(waba, phone)}
                                          disabled={isAddingThis}
                                          className="gap-1"
                                        >
                                          {isAddingThis ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                                          Adicionar
                                        </Button>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
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
                <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                  <p className="text-xs font-medium">PIN de registro do WhatsApp (6 dígitos)</p>
                  <div className="flex items-center gap-2">
                    <Input
                      value={registrationPin}
                      onChange={(e) => setRegistrationPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      placeholder="Ex: 123456"
                      maxLength={6}
                      className="max-w-[180px]"
                    />
                    <p className="text-xs text-muted-foreground">
                      Use o PIN configurado no Gerenciador da Meta para tirar o status pendente.
                    </p>
                  </div>
                </div>

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
                          <span className="text-xs text-muted-foreground">WABA: {acc.business_account_id}</span>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={registeringPhoneId === acc.phone_number_id || registrationPin.length !== 6}
                          onClick={async () => {
                            setRegisteringPhoneId(acc.phone_number_id);
                            try {
                              const { data, error } = await supabase.functions.invoke("whatsapp-register-phone", {
                                body: { phone_number_id: acc.phone_number_id, pin: registrationPin },
                              });
                              if (error) throw error;
                              if (data?.error) {
                                toast.error(`Falha: ${data.error}`);
                              } else {
                                toast.success("Número validado e registrado na API do WhatsApp!");
                                queryClient.invalidateQueries({ queryKey: ["meta-wabas"] });
                              }
                            } catch (err: any) {
                              toast.error(err.message || "Erro ao registrar");
                            } finally {
                              setRegisteringPhoneId(null);
                            }
                          }}
                          className="gap-1"
                        >
                          {registeringPhoneId === acc.phone_number_id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Zap className="h-3 w-3" />
                          )}
                          Registrar na API
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
          </CardContent>
        </Card>
      )}

      {/* ── Concluir ──
          Fecha o ciclo: conectou a conta, escolheu as BMs/números que quer
          usar, agora volta pro app em vez de ficar preso nesta tela. */}
      {activeConnection && registeredAccounts && registeredAccounts.length > 0 && (
        <div className="flex justify-end">
          <Button size="lg" onClick={() => navigate("/")} className="gap-2">
            <CheckCircle2 className="h-4 w-4" />
            Concluir
          </Button>
        </div>
      )}
    </div>
  );
}
