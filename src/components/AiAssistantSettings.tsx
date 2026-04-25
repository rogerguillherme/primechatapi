import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Bot, Save, Sparkles, MessageSquare, Users, PowerOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const AI_KEYS = [
  "ai_auto_reply_mode",
  "ai_auto_reply_enabled",
  "ai_company_name",
  "ai_company_description",
  "ai_products_services",
  "ai_custom_instructions",
] as const;

type Mode = "off" | "all" | "selected";

const MODE_OPTIONS: { value: Mode; title: string; desc: string; icon: typeof Bot }[] = [
  { value: "off", title: "Desativado", desc: "O agente não responde nenhuma conversa.", icon: PowerOff },
  { value: "all", title: "Todas as conversas", desc: "Responde automaticamente qualquer mensagem recebida.", icon: Users },
  { value: "selected", title: "Conversas selecionadas", desc: "Responde apenas conversas onde a IA foi ativada manualmente.", icon: MessageSquare },
];

export function AiAssistantSettings() {
  const [mode, setMode] = useState<Mode>("off");
  const [companyName, setCompanyName] = useState("");
  const [companyDesc, setCompanyDesc] = useState("");
  const [products, setProducts] = useState("");
  const [customInstructions, setCustomInstructions] = useState("");
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    const { data } = await supabase
      .from("app_settings")
      .select("key, value")
      .in("key", [...AI_KEYS]);

    const map: Record<string, string> = {};
    for (const row of data || []) map[row.key] = row.value;

    const storedMode = map.ai_auto_reply_mode as Mode | undefined;
    if (storedMode === "off" || storedMode === "all" || storedMode === "selected") {
      setMode(storedMode);
    } else {
      // Backwards compat with old boolean flag
      setMode(map.ai_auto_reply_enabled === "true" ? "all" : "off");
    }
    setCompanyName(map.ai_company_name || "");
    setCompanyDesc(map.ai_company_description || "");
    setProducts(map.ai_products_services || "");
    setCustomInstructions(map.ai_custom_instructions || "");
    setLoaded(true);
  }

  async function save() {
    setSaving(true);
    try {
      const entries = [
        { key: "ai_auto_reply_mode", value: mode },
        // keep legacy flag in sync for any older callers
        { key: "ai_auto_reply_enabled", value: mode === "all" ? "true" : "false" },
        { key: "ai_company_name", value: companyName },
        { key: "ai_company_description", value: companyDesc },
        { key: "ai_products_services", value: products },
        { key: "ai_custom_instructions", value: customInstructions },
      ];

      for (const entry of entries) {
        await supabase
          .from("app_settings")
          .upsert(
            { key: entry.key, value: entry.value, updated_at: new Date().toISOString() },
            { onConflict: "key" }
          );
      }

      toast({ title: "Configurações salvas", description: "O assistente de IA foi atualizado." });
    } catch {
      toast({ title: "Erro ao salvar", description: "Tente novamente.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return null;

  const statusLabel = mode === "all" ? "Todas conversas" : mode === "selected" ? "Conversas selecionadas" : "Desativado";
  const statusColor = mode === "off" ? "" : "bg-emerald-500";

  return (
    <div className="space-y-6 max-w-3xl">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gradient-to-br from-violet-500/20 to-pink-500/20">
                <Bot className="h-5 w-5 text-violet-600 dark:text-violet-400" />
              </div>
              <div>
                <CardTitle className="text-lg">Assistente de IA</CardTitle>
                <CardDescription>
                  Responde automaticamente mensagens recebidas no WhatsApp
                </CardDescription>
              </div>
            </div>
            <Badge variant={mode === "off" ? "secondary" : "default"} className={statusColor}>
              {statusLabel}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <Label>Modo de ativação</Label>
            <RadioGroup value={mode} onValueChange={(v) => setMode(v as Mode)} className="grid gap-2">
              {MODE_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const selected = mode === opt.value;
                return (
                  <label
                    key={opt.value}
                    htmlFor={`mode-${opt.value}`}
                    className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                      selected ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"
                    }`}
                  >
                    <RadioGroupItem id={`mode-${opt.value}`} value={opt.value} className="mt-1" />
                    <Icon className={`h-4 w-4 mt-1 ${selected ? "text-primary" : "text-muted-foreground"}`} />
                    <div className="flex-1">
                      <p className="text-sm font-medium">{opt.title}</p>
                      <p className="text-xs text-muted-foreground">{opt.desc}</p>
                    </div>
                  </label>
                );
              })}
            </RadioGroup>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ai-company">Nome da Empresa</Label>
            <Input
              id="ai-company"
              placeholder="Ex: PrimeChat"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="ai-desc">Descrição do Negócio</Label>
            <Textarea
              id="ai-desc"
              placeholder="Descreva o que sua empresa faz, seu público-alvo, etc."
              value={companyDesc}
              onChange={(e) => setCompanyDesc(e.target.value)}
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="ai-products">Produtos / Serviços</Label>
            <Textarea
              id="ai-products"
              placeholder="Liste seus produtos, preços, planos, serviços oferecidos..."
              value={products}
              onChange={(e) => setProducts(e.target.value)}
              rows={4}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="ai-instructions">Instruções Personalizadas (opcional)</Label>
            <Textarea
              id="ai-instructions"
              placeholder="Ex: Sempre ofereça o plano anual primeiro. Nunca dê desconto. Mencione que temos suporte 24h..."
              value={customInstructions}
              onChange={(e) => setCustomInstructions(e.target.value)}
              rows={4}
            />
            <p className="text-xs text-muted-foreground">
              Adicione regras específicas para personalizar o comportamento do assistente.
            </p>
          </div>

          <Button onClick={save} disabled={saving} className="gap-2">
            <Save className="h-4 w-4" />
            {saving ? "Salvando..." : "Salvar Configurações"}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-dashed">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <Sparkles className="h-5 w-5 text-amber-500 mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-medium">Como funciona?</p>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• <strong>Todas as conversas:</strong> a IA responde automaticamente toda mensagem recebida</li>
                <li>• <strong>Conversas selecionadas:</strong> ative a IA individualmente em cada chat pelo botão no topo da conversa</li>
                <li>• A IA usa o histórico da conversa para manter o contexto</li>
                <li>• Respostas de botões interativos (fluxos) não são afetadas</li>
                <li>• O assistente nunca revela que é uma IA</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
