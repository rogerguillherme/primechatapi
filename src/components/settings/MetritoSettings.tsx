import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

const EMPTY = { api_key: "", project_id: "", generic_key: "" };

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
    <Card className="glass-card">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <BarChart3 size={18} className="text-primary" />
              Metrito
            </CardTitle>
            <CardDescription>
              Liga esta conta ao seu projeto do Metrito: a origem de cada conversa é
              identificada, e leads e vendas são enviados para atribuição de anúncio.
            </CardDescription>
          </div>
          <Badge variant={configured ? "default" : "outline"} className="shrink-0">
            {configured ? "Conta própria" : "Usando o padrão"}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
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
          </>
        )}
      </CardContent>
    </Card>
  );
}
