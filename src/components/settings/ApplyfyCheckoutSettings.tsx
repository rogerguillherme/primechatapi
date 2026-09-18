import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTeamContext } from "@/hooks/use-team";
import { CollapsibleSettingsCard } from "@/components/settings/CollapsibleSettingsCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2, Plus, Trash2, ShoppingCart, Check, Copy } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const WEBHOOK_URL = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/applyfy-webhook`;

interface ApplyfyProduct {
  id: string;
  name: string;
  external_id: string;
  price_cents: number;
  active: boolean;
}

const EMPTY_PRODUCT = { name: "", external_id: "", price_reais: "" };

/** Credenciais e catálogo de produtos da ApplyFy — a base pra gerar link de
 *  checkout com UTM automática (utm_source=canal, utm_medium=vendedor,
 *  utm_content/utm_term=lead) direto no botão do chat. */
export function ApplyfyCheckoutSettings() {
  const { user } = useAuth();
  const { data: team } = useTeamContext();
  const { toast } = useToast();
  const qc = useQueryClient();
  const ownerId = team?.ownerId ?? user?.id;

  const [publicKey, setPublicKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [webhookToken, setWebhookToken] = useState("");
  const [savingCreds, setSavingCreds] = useState(false);
  const [novoProduto, setNovoProduto] = useState(EMPTY_PRODUCT);
  const [criando, setCriando] = useState(false);

  const { data: creds, isLoading: carregandoCreds } = useQuery({
    queryKey: ["applyfy-credentials", ownerId],
    enabled: !!ownerId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("applyfy_credentials" as any).select("public_key, webhook_token, updated_at").maybeSingle();
      if (error) throw error;
      return data as { public_key: string; webhook_token: string | null; updated_at: string } | null;
    },
  });

  const { data: produtos = [], isLoading: carregandoProdutos } = useQuery({
    queryKey: ["applyfy-products", ownerId],
    enabled: !!ownerId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("applyfy_products" as any).select("*").order("name");
      if (error) throw error;
      return (data || []) as unknown as ApplyfyProduct[];
    },
  });

  const salvarCreds = useMutation({
    mutationFn: async () => {
      if (!ownerId) throw new Error("Sessão expirada");
      const temChaves = publicKey.trim() && secretKey.trim();
      const temToken = webhookToken.trim();
      if (!temChaves && !temToken) {
        throw new Error("Informe a Chave Pública + Chave Privada, ou o Token do webhook");
      }
      const payload: Record<string, string> = { user_id: ownerId };
      if (publicKey.trim()) payload.public_key = publicKey.trim();
      if (secretKey.trim()) payload.secret_key = secretKey.trim();
      if (webhookToken.trim()) payload.webhook_token = webhookToken.trim();
      const { error } = await supabase.from("applyfy_credentials" as any).upsert(payload, { onConflict: "user_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Credenciais da ApplyFy salvas" });
      setPublicKey(""); setSecretKey(""); setWebhookToken("");
      qc.invalidateQueries({ queryKey: ["applyfy-credentials", ownerId] });
    },
    onError: (e: any) => toast({ title: "Erro ao salvar", description: e.message, variant: "destructive" }),
  });

  const salvarProduto = useMutation({
    mutationFn: async () => {
      if (!ownerId) throw new Error("Sessão expirada");
      if (!novoProduto.name.trim() || !novoProduto.external_id.trim()) {
        throw new Error("Informe o nome e o ID externo (externalId) do produto na ApplyFy");
      }
      const price = Math.round((parseFloat(novoProduto.price_reais.replace(",", ".")) || 0) * 100);
      const { error } = await supabase.from("applyfy_products" as any).insert({
        user_id: ownerId,
        name: novoProduto.name.trim(),
        external_id: novoProduto.external_id.trim(),
        price_cents: price,
      });
      if (error) {
        if (error.code === "23505") throw new Error("Já existe um produto com esse ID externo");
        throw error;
      }
    },
    onSuccess: () => {
      toast({ title: "Produto adicionado" });
      setNovoProduto(EMPTY_PRODUCT);
      setCriando(false);
      qc.invalidateQueries({ queryKey: ["applyfy-products", ownerId] });
    },
    onError: (e: any) => toast({ title: "Erro ao salvar produto", description: e.message, variant: "destructive" }),
  });

  const alternarAtivo = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase.from("applyfy_products" as any).update({ active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["applyfy-products", ownerId] }),
  });

  const excluirProduto = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("applyfy_products" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Produto removido" });
      qc.invalidateQueries({ queryKey: ["applyfy-products", ownerId] });
    },
  });

  return (
    <CollapsibleSettingsCard
      cardClassName="glass-card"
      icon={<ShoppingCart size={18} className="text-primary" />}
      title="Checkout ApplyFy"
      description="Credenciais e produtos usados pelo botão de link de checkout no chat, com UTM automática por vendedor e lead."
    >
      <div className="space-y-5">
        <div className="rounded-lg border border-border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Credenciais da conta</Label>
            {creds && (
              <span className="flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
                <Check className="h-3 w-3" /> Configurado
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Pegue as duas chaves no painel da ApplyFy (Chave Pública / Chave Privada). A chave privada
            fica salva e não volta pra tela — pra trocar, cole as duas de novo.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Chave Pública</Label>
              <Input
                value={publicKey}
                onChange={(e) => setPublicKey(e.target.value)}
                placeholder={creds?.public_key || "estevaosz0602_..."}
                className="h-9 w-64 font-mono text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Chave Privada</Label>
              <Input
                type="password"
                value={secretKey}
                onChange={(e) => setSecretKey(e.target.value)}
                placeholder="••••••••••••••••"
                className="h-9 w-64 font-mono text-xs"
              />
            </div>
            <Button size="sm" onClick={() => salvarCreds.mutate()} disabled={salvarCreds.isPending}>
              {salvarCreds.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
              Salvar
            </Button>
          </div>
        </div>

        <div className="rounded-lg border border-border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Webhook de vendas</Label>
            {creds?.webhook_token && (
              <span className="flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
                <Check className="h-3 w-3" /> Configurado
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            No painel da ApplyFy, vá em <b>Configurações → Webhooks → Criar</b>, cole a URL abaixo como
            "URL alvo do disparo", marque os eventos de transação (criada/paga/estornada) e cole aqui o
            token que ela gerar. Sem isso as vendas não aparecem no dashboard por UTM.
          </p>
          <div className="flex items-center gap-1.5">
            <code className="flex-1 min-w-0 truncate rounded bg-muted px-2 py-1.5 text-xs">{WEBHOOK_URL}</code>
            <Button
              size="icon" variant="ghost" className="h-8 w-8 shrink-0"
              onClick={() => { navigator.clipboard.writeText(WEBHOOK_URL); toast({ title: "URL copiada" }); }}
            >
              <Copy size={14} />
            </Button>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Token do webhook</Label>
              <Input
                value={webhookToken}
                onChange={(e) => setWebhookToken(e.target.value)}
                placeholder={creds?.webhook_token ? "•••••••••••••••• (já salvo)" : "Cole o token gerado pela ApplyFy"}
                className="h-9 w-72 font-mono text-xs"
              />
            </div>
            <Button size="sm" onClick={() => salvarCreds.mutate()} disabled={salvarCreds.isPending || !webhookToken.trim()}>
              {salvarCreds.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
              Salvar token
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Produtos</Label>
            {!criando && (
              <Button size="sm" variant="outline" onClick={() => setCriando(true)} className="gap-1.5">
                <Plus size={14} /> Novo produto
              </Button>
            )}
          </div>

          {criando && (
            <div className="rounded-lg border border-border p-3 space-y-3 bg-card/50">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label className="text-xs">Nome</Label>
                  <Input value={novoProduto.name} onChange={(e) => setNovoProduto((p) => ({ ...p, name: e.target.value }))} placeholder="Ex.: Curso X" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">ID externo (externalId)</Label>
                  <Input value={novoProduto.external_id} onChange={(e) => setNovoProduto((p) => ({ ...p, external_id: e.target.value }))} placeholder="Ex.: curso-x" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Preço (R$)</Label>
                  <Input value={novoProduto.price_reais} onChange={(e) => setNovoProduto((p) => ({ ...p, price_reais: e.target.value }))} placeholder="297,00" />
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => salvarProduto.mutate()} disabled={salvarProduto.isPending}>
                  {salvarProduto.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
                  Salvar produto
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setCriando(false); setNovoProduto(EMPTY_PRODUCT); }}>Cancelar</Button>
              </div>
            </div>
          )}

          {carregandoProdutos ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
              <Loader2 size={15} className="animate-spin" /> Carregando…
            </div>
          ) : produtos.length === 0 ? (
            <p className="text-sm text-muted-foreground py-1">Nenhum produto cadastrado ainda.</p>
          ) : (
            <div className="space-y-1.5">
              {produtos.map((p) => (
                <div key={p.id} className="flex items-center gap-3 rounded-lg border border-border p-2.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{p.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {p.external_id} · R$ {(p.price_cents / 100).toFixed(2).replace(".", ",")}
                    </p>
                  </div>
                  <Switch checked={p.active} onCheckedChange={(active) => alternarAtivo.mutate({ id: p.id, active })} />
                  <Button size="icon" variant="ghost" onClick={() => excluirProduto.mutate(p.id)} className="text-muted-foreground hover:text-destructive">
                    <Trash2 size={16} />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </CollapsibleSettingsCard>
  );
}
