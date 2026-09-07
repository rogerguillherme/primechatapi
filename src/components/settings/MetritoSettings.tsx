import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { CollapsibleSettingsCard } from "@/components/settings/CollapsibleSettingsCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { BarChart3, Loader2 } from "lucide-react";

interface MetritoRow {
  api_key: string | null;
  project_id: string | null;
  generic_key: string | null;
}

interface CapiRow {
  pixel_id: string | null;
  access_token: string | null;
  test_event_code: string | null;
}

const EMPTY = { api_key: "", project_id: "", generic_key: "" };
const CAPI_EMPTY = { pixel_id: "", access_token: "", test_event_code: "" };

/** Mostra só o fim da chave — nunca reexibe o valor inteiro depois de salvo. */
function mask(value: string | null): string {
  if (!value) return "";
  return value.length <= 8 ? "••••" : "••••••••" + value.slice(-4);
}

export function MetritoSettings() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(EMPTY);
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const { data: row, isLoading } = useQuery<MetritoRow | null>({
    queryKey: ["metrito-settings", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("metrito_settings")
        .select("api_key, project_id, generic_key")
        .eq("owner_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return (data as MetritoRow) ?? null;
    },
  });

  useEffect(() => {
    setForm({
      api_key: row?.api_key ?? "",
      project_id: row?.project_id ?? "",
      generic_key: row?.generic_key ?? "",
    });
    setTouched({});
  }, [row]);

  const save = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Sessão expirada");
      const { error } = await (supabase as any)
        .from("metrito_settings")
        .upsert(
          {
            owner_id: user.id,
            api_key: form.api_key.trim() || null,
            project_id: form.project_id.trim() || null,
            generic_key: form.generic_key.trim() || null,
          },
          { onConflict: "owner_id" },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Credenciais do Metrito salvas");
      queryClient.invalidateQueries({ queryKey: ["metrito-settings", user?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const configured = !!(row?.api_key || row?.project_id || row?.generic_key);

  // ── Meta CAPI nativo (fase 1: ctwa_clid) — mesma conta, tabela separada
  // (capi_settings), porque é um envio direto pro Meta, não passa pelo Metrito.
  const [capiForm, setCapiForm] = useState(CAPI_EMPTY);
  const [capiTouched, setCapiTouched] = useState<Record<string, boolean>>({});

  const { data: capiRow, isLoading: capiLoading } = useQuery<CapiRow | null>({
    queryKey: ["capi-settings", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("capi_settings")
        .select("pixel_id, access_token, test_event_code")
        .eq("owner_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return (data as CapiRow) ?? null;
    },
  });

  useEffect(() => {
    setCapiForm({
      pixel_id: capiRow?.pixel_id ?? "",
      access_token: capiRow?.access_token ?? "",
      test_event_code: capiRow?.test_event_code ?? "",
    });
    setCapiTouched({});
  }, [capiRow]);

  const saveCapi = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Sessão expirada");
      const { error } = await (supabase as any)
        .from("capi_settings")
        .upsert(
          {
            owner_id: user.id,
            pixel_id: capiForm.pixel_id.trim() || null,
            access_token: capiForm.access_token.trim() || null,
            test_event_code: capiForm.test_event_code.trim() || null,
          },
          { onConflict: "owner_id" },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Credenciais do Meta CAPI salvas");
      queryClient.invalidateQueries({ queryKey: ["capi-settings", user?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const capiConfigured = !!(capiRow?.pixel_id || capiRow?.access_token);

  const capiField = (
    key: keyof typeof CAPI_EMPTY,
    label: string,
    placeholder: string,
    hint: string,
    secret = false,
  ) => (
    <div className="space-y-1.5">
      <Label htmlFor={`capi-${key}`}>{label}</Label>
      <Input
        id={`capi-${key}`}
        value={secret && !capiTouched[key] ? mask(capiForm[key]) : capiForm[key]}
        onFocus={() => secret && setCapiTouched((t) => ({ ...t, [key]: true }))}
        onChange={(e) => setCapiForm({ ...capiForm, [key]: e.target.value })}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        className="font-mono text-sm"
      />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );

  const field = (
    key: keyof typeof EMPTY,
    label: string,
    placeholder: string,
    hint: string,
    secret = false,
  ) => (
    <div className="space-y-1.5">
      <Label htmlFor={`metrito-${key}`}>{label}</Label>
      <Input
        id={`metrito-${key}`}
        value={secret && !touched[key] ? mask(form[key]) : form[key]}
        onFocus={() => secret && setTouched((t) => ({ ...t, [key]: true }))}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        className="font-mono text-sm"
      />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );

  return (
    <CollapsibleSettingsCard
      cardClassName="glass-card"
      icon={<BarChart3 size={18} className="text-primary" />}
      title="Metrito"
      description="Liga esta conta ao seu projeto do Metrito: a origem de cada conversa é identificada, e leads e vendas são enviados para atribuição de anúncio."
      headerAction={
          <Badge variant={configured ? "default" : "outline"} className="shrink-0">
            {configured ? "Conta própria" : "Usando o padrão"}
          </Badge>
      }
      contentClassName="space-y-5"
    >
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
            <Loader2 size={15} className="animate-spin" /> Carregando...
          </div>
        ) : (
          <>
            {field(
              "api_key",
              "Chave de API",
              "mtk_live_...",
              "Em Configurações › API Keys no Metrito. Marque só os escopos tracking:write e data:read.",
              true,
            )}
            {field(
              "project_id",
              "ID do projeto",
              "69162064162b926ae607959b",
              "O projeto de onde vêm as métricas de gasto e CPL.",
            )}
            {field(
              "generic_key",
              "Chave de conexão personalizada",
              "chave do ?k= da conexão",
              "Em Conexões › Adicionar Conexão › Personalizado. É por ela que as vendas são registradas.",
              true,
            )}

            <p className="text-xs text-muted-foreground border-l-2 border-border pl-3">
              Deixando tudo em branco, esta conta usa a configuração padrão do sistema.
              Ao preencher, ela passa a usar só o que estiver aqui — campo vazio desliga
              a parte correspondente, em vez de voltar para o padrão. É proposital:
              misturar sua chave com o projeto de outra conta mandaria os dados para o
              painel errado.
            </p>

            <Button onClick={() => save.mutate()} disabled={save.isPending} className="gap-1.5">
              {save.isPending && <Loader2 size={15} className="animate-spin" />}
              Salvar credenciais
            </Button>

            <div className="border-t border-border pt-5 space-y-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Meta CAPI (envio nativo)</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Pixel e token do próprio Meta Business — usado pra mandar Lead/Purchase direto
                    pra Meta a partir do ctwa_clid (clique em anúncio), em paralelo ao Metrito acima.
                  </p>
                </div>
                <Badge variant={capiConfigured ? "default" : "outline"} className="shrink-0">
                  {capiConfigured ? "Conta própria" : "Usando o padrão"}
                </Badge>
              </div>

              {capiLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                  <Loader2 size={15} className="animate-spin" /> Carregando...
                </div>
              ) : (
                <>
                  {capiField(
                    "pixel_id",
                    "Pixel ID",
                    "1234567890123456",
                    "Meta Events Manager › Fonte de dados › esse Pixel.",
                  )}
                  {capiField(
                    "access_token",
                    "Token de acesso (CAPI)",
                    "EAAG...",
                    "Gerado no Events Manager desse Pixel, em Configurações › Conversions API.",
                    true,
                  )}
                  {capiField(
                    "test_event_code",
                    "Código de teste (opcional)",
                    "TESTxxxx",
                    "Cole aqui só durante a validação, na aba Test Events do Events Manager. Remova depois — evento com este código não conta pra otimização do anúncio.",
                  )}

                  <Button onClick={() => saveCapi.mutate()} disabled={saveCapi.isPending} variant="outline" className="gap-1.5">
                    {saveCapi.isPending && <Loader2 size={15} className="animate-spin" />}
                    Salvar CAPI
                  </Button>
                </>
              )}
            </div>
          </>
        )}
    </CollapsibleSettingsCard>
  );
}
