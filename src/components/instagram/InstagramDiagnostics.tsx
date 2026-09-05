import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Stethoscope, Loader2, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

interface DiagnosticReport {
  connection_id: string;
  username: string | null;
  page_name: string | null;
  page_id: string | null;
  instagram_user_id: string | null;
  token_valid: boolean;
  healthy: boolean;
  permissions: { granted: string[]; missing: string[]; declined: string[] };
  page_subscribed_fields: { current: string[]; missing: string[] };
  ig_subscribed_fields: { current: string[]; missing: string[] };
  errors: string[];
}

export function InstagramDiagnostics() {
  const [loading, setLoading] = useState(false);
  const [reports, setReports] = useState<DiagnosticReport[] | null>(null);

  const runDiagnostic = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("instagram-diagnose");
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setReports(data?.diagnostics || []);
      const allHealthy = (data?.diagnostics || []).every((r: DiagnosticReport) => r.healthy);
      if (allHealthy) {
        toast.success("Tudo configurado corretamente!");
      } else {
        toast.warning("Diagnóstico identificou problemas — veja os detalhes");
      }
    } catch (err: any) {
      toast.error(err.message || "Erro ao rodar diagnóstico");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Stethoscope className="h-5 w-5 text-purple-500" />
            <CardTitle className="text-base">Diagnóstico de permissões e webhooks</CardTitle>
          </div>
          <Button onClick={runDiagnostic} disabled={loading} size="sm" variant="outline">
            {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Stethoscope className="h-4 w-4 mr-2" />}
            Rodar diagnóstico
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!reports && (
          <p className="text-sm text-muted-foreground">
            Verifica se o token está válido, quais permissões da Meta foram concedidas e se os webhooks de comentários e DMs estão devidamente assinados.
          </p>
        )}

        {reports?.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhuma conexão ativa encontrada.</p>
        )}

        {reports?.map((r) => (
          <div key={r.connection_id} className="rounded-lg border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <p className="font-semibold">@{r.username}</p>
                <p className="text-xs text-muted-foreground">{r.page_name}</p>
              </div>
              {r.healthy ? (
                <Badge className="bg-green-500/10 text-green-600 border-green-500/20">
                  <CheckCircle2 className="h-3 w-3 mr-1" /> Saudável
                </Badge>
              ) : (
                <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20">
                  <AlertTriangle className="h-3 w-3 mr-1" /> Problemas detectados
                </Badge>
              )}
            </div>

            {/* Token */}
            <div className="text-sm">
              <span className="font-medium">Token: </span>
              {r.token_valid ? (
                <span className="text-green-600 inline-flex items-center gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Válido
                </span>
              ) : (
                <span className="text-destructive inline-flex items-center gap-1">
                  <XCircle className="h-3.5 w-3.5" /> Inválido — reconecte a conta
                </span>
              )}
            </div>

            {/* Permissions */}
            <div className="text-sm">
              <p className="font-medium mb-1">Permissões concedidas pelo usuário</p>
              <div className="flex flex-wrap gap-1">
                {r.permissions.granted.length === 0 && (
                  <span className="text-xs text-muted-foreground">Nenhuma permissão encontrada</span>
                )}
                {r.permissions.granted.map((p) => (
                  <Badge key={p} variant="secondary" className="text-xs">{p}</Badge>
                ))}
              </div>
              {r.permissions.missing.length > 0 && (
                <>
                  <p className="font-medium text-destructive mt-2 mb-1">Permissões faltando (escopos do app Meta)</p>
                  <div className="flex flex-wrap gap-1">
                    {r.permissions.missing.map((p) => (
                      <Badge key={p} className="bg-destructive/10 text-destructive border-destructive/20 text-xs">
                        <XCircle className="h-3 w-3 mr-1" /> {p}
                      </Badge>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Adicione esses escopos em Meta Developer → seu app → App Review → Permissions and Features, depois desconecte e reconecte.
                  </p>
                </>
              )}
              {r.permissions.declined.length > 0 && (
                <>
                  <p className="font-medium text-amber-600 mt-2 mb-1">Permissões recusadas pelo usuário</p>
                  <div className="flex flex-wrap gap-1">
                    {r.permissions.declined.map((p) => (
                      <Badge key={p} className="bg-amber-500/10 text-amber-600 border-amber-500/20 text-xs">{p}</Badge>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Page subscribed_fields */}
            <div className="text-sm">
              <p className="font-medium mb-1">Webhooks da Página (Facebook)</p>
              <div className="flex flex-wrap gap-1">
                {r.page_subscribed_fields.current.length === 0 && (
                  <span className="text-xs text-muted-foreground">Nenhum campo assinado</span>
                )}
                {r.page_subscribed_fields.current.map((f) => (
                  <Badge key={f} variant="secondary" className="text-xs">
                    <CheckCircle2 className="h-3 w-3 mr-1 text-green-600" /> {f}
                  </Badge>
                ))}
              </div>
              {r.page_subscribed_fields.missing.length > 0 && (
                <>
                  <p className="font-medium text-destructive mt-2 mb-1">Campos faltando</p>
                  <div className="flex flex-wrap gap-1">
                    {r.page_subscribed_fields.missing.map((f) => (
                      <Badge key={f} className="bg-destructive/10 text-destructive border-destructive/20 text-xs">
                        <XCircle className="h-3 w-3 mr-1" /> {f}
                      </Badge>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Clique em "Ativar Webhooks" no card acima para reassinar.
                  </p>
                </>
              )}
            </div>

            {/* IG subscribed_fields */}
            <div className="text-sm">
              <p className="font-medium mb-1">Webhooks do Instagram (comentários/DMs/menções)</p>
              <div className="flex flex-wrap gap-1">
                {r.ig_subscribed_fields.current.length === 0 && (
                  <span className="text-xs text-muted-foreground">Nenhum campo assinado</span>
                )}
                {r.ig_subscribed_fields.current.map((f) => (
                  <Badge key={f} variant="secondary" className="text-xs">
                    <CheckCircle2 className="h-3 w-3 mr-1 text-green-600" /> {f}
                  </Badge>
                ))}
              </div>
              {r.ig_subscribed_fields.missing.length > 0 && (
                <>
                  <p className="font-medium text-destructive mt-2 mb-1">Campos faltando</p>
                  <div className="flex flex-wrap gap-1">
                    {r.ig_subscribed_fields.missing.map((f) => (
                      <Badge key={f} className="bg-destructive/10 text-destructive border-destructive/20 text-xs">
                        <XCircle className="h-3 w-3 mr-1" /> {f}
                      </Badge>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Sem o campo <code className="text-xs bg-muted px-1 rounded">comments</code>, a automação de comentários NÃO dispara. Clique em "Ativar Webhooks". Se continuar faltando, o app Meta não tem essa permissão aprovada.
                  </p>
                </>
              )}
            </div>

            {/* Errors */}
            {r.errors.length > 0 && (
              <div className="text-sm">
                <p className="font-medium text-destructive mb-1">Erros da API Meta</p>
                <ul className="list-disc list-inside space-y-1 text-xs text-destructive">
                  {r.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
