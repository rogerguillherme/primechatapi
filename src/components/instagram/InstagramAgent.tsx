import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Bot, MessageSquare, AtSign, Settings, Sparkles, Save, Loader2,
  Shield, Zap, Brain, Plus, Trash2, MessageCircle, Heart,
} from "lucide-react";
import { toast } from "sonner";

interface FaqItem {
  id: string;
  question: string;
  answer: string;
}

export function InstagramAgent() {
  const [agentActive, setAgentActive] = useState(false);
  const [replyComments, setReplyComments] = useState(true);
  const [replyDMs, setReplyDMs] = useState(true);
  const [autoLike, setAutoLike] = useState(false);
  const [agentName, setAgentName] = useState("Assistente Instagram");
  const [personality, setPersonality] = useState("Você é um assistente simpático e profissional. Responda de forma amigável, use emojis com moderação. Sempre direcione para o link na bio quando perguntarem sobre produtos.");
  const [instructions, setInstructions] = useState("- Nunca mencione concorrentes\n- Responda em português\n- Máximo de 3 parágrafos\n- Se não souber, direcione para o DM");
  const [aiModel, setAiModel] = useState("google/gemini-3-flash-preview");
  const [maxDaily, setMaxDaily] = useState("100");
  const [saving, setSaving] = useState(false);

  const [faqs, setFaqs] = useState<FaqItem[]>([
    { id: "1", question: "Qual o preço?", answer: "Confira nossos preços no link da bio! Temos promoções especiais 🔥" },
    { id: "2", question: "Como comprar?", answer: "É só clicar no link da bio e seguir as instruções. Qualquer dúvida, chama no DM!" },
  ]);
  const [newQ, setNewQ] = useState("");
  const [newA, setNewA] = useState("");

  const handleSave = () => {
    setSaving(true);
    setTimeout(() => {
      setSaving(false);
      toast.success("Agente salvo com sucesso!");
    }, 1000);
  };

  const addFaq = () => {
    if (!newQ.trim() || !newA.trim()) {
      toast.error("Preencha pergunta e resposta");
      return;
    }
    setFaqs(prev => [...prev, { id: crypto.randomUUID(), question: newQ, answer: newA }]);
    setNewQ("");
    setNewA("");
  };

  const removeFaq = (id: string) => {
    setFaqs(prev => prev.filter(f => f.id !== id));
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Bot className="h-5 w-5 text-purple-500" /> Agente Instagram
          </h2>
          <p className="text-sm text-muted-foreground">Configure um agente IA para responder comentários e DMs automaticamente</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Label htmlFor="agent-active" className="text-sm">Agente</Label>
            <Switch id="agent-active" checked={agentActive} onCheckedChange={setAgentActive} />
            <Badge className={agentActive ? "bg-green-500/10 text-green-600 border-green-500/20" : "bg-muted text-muted-foreground"}>
              {agentActive ? "Ativo" : "Inativo"}
            </Badge>
          </div>
        </div>
      </div>

      <Tabs defaultValue="personality" className="space-y-4">
        <TabsList className="grid grid-cols-4 w-full max-w-lg">
          <TabsTrigger value="personality" className="gap-1.5 text-xs"><Brain className="h-3.5 w-3.5" /> Persona</TabsTrigger>
          <TabsTrigger value="rules" className="gap-1.5 text-xs"><Shield className="h-3.5 w-3.5" /> Regras</TabsTrigger>
          <TabsTrigger value="faq" className="gap-1.5 text-xs"><MessageCircle className="h-3.5 w-3.5" /> FAQ</TabsTrigger>
          <TabsTrigger value="settings" className="gap-1.5 text-xs"><Settings className="h-3.5 w-3.5" /> Config</TabsTrigger>
        </TabsList>

        {/* Personality */}
        <TabsContent value="personality" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><Sparkles className="h-4 w-4 text-purple-500" /> Personalidade do Agente</CardTitle>
              <CardDescription>Defina como o agente se comporta e responde</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="text-xs font-medium">Nome do agente</Label>
                <Input value={agentName} onChange={(e) => setAgentName(e.target.value)} className="mt-1.5" placeholder="Ex: Assistente Prime" />
              </div>
              <div>
                <Label className="text-xs font-medium">Personalidade e tom de voz</Label>
                <Textarea
                  value={personality}
                  onChange={(e) => setPersonality(e.target.value)}
                  className="mt-1.5 min-h-[120px]"
                  placeholder="Descreva como o agente deve se comportar..."
                />
              </div>
              <div>
                <Label className="text-xs font-medium">Modelo de IA</Label>
                <Select value={aiModel} onValueChange={setAiModel}>
                  <SelectTrigger className="mt-1.5">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="google/gemini-3-flash-preview">Gemini 3 Flash (Rápido)</SelectItem>
                    <SelectItem value="google/gemini-2.5-pro">Gemini 2.5 Pro (Avançado)</SelectItem>
                    <SelectItem value="openai/gpt-5-mini">GPT-5 Mini (Equilibrado)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Rules */}
        <TabsContent value="rules" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><Shield className="h-4 w-4 text-purple-500" /> Instruções e Regras</CardTitle>
              <CardDescription>Defina limites e diretrizes para as respostas</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="text-xs font-medium">Instruções (uma por linha)</Label>
                <Textarea
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  className="mt-1.5 min-h-[150px] font-mono text-xs"
                  placeholder="- Regra 1&#10;- Regra 2"
                />
              </div>

              <Separator />

              <div className="space-y-3">
                <h4 className="text-sm font-medium">Canais de resposta</h4>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AtSign className="h-4 w-4 text-muted-foreground" />
                    <Label className="text-sm">Responder comentários</Label>
                  </div>
                  <Switch checked={replyComments} onCheckedChange={setReplyComments} />
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-muted-foreground" />
                    <Label className="text-sm">Responder DMs</Label>
                  </div>
                  <Switch checked={replyDMs} onCheckedChange={setReplyDMs} />
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Heart className="h-4 w-4 text-muted-foreground" />
                    <Label className="text-sm">Curtir comentários automaticamente</Label>
                  </div>
                  <Switch checked={autoLike} onCheckedChange={setAutoLike} />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* FAQ */}
        <TabsContent value="faq" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><MessageCircle className="h-4 w-4 text-purple-500" /> Perguntas Frequentes</CardTitle>
              <CardDescription>O agente prioriza estas respostas quando a pergunta é semelhante</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {faqs.map((faq) => (
                <div key={faq.id} className="rounded-lg border p-3 space-y-1.5">
                  <div className="flex items-start justify-between">
                    <p className="text-sm font-medium">{faq.question}</p>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive shrink-0" onClick={() => removeFaq(faq.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">{faq.answer}</p>
                </div>
              ))}

              <Separator />

              <div className="space-y-2">
                <Input value={newQ} onChange={(e) => setNewQ(e.target.value)} placeholder="Pergunta..." className="text-sm" />
                <Textarea value={newA} onChange={(e) => setNewA(e.target.value)} placeholder="Resposta..." className="min-h-[60px] text-sm" />
                <Button variant="outline" size="sm" onClick={addFaq} className="gap-1.5">
                  <Plus className="h-3.5 w-3.5" /> Adicionar FAQ
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Settings */}
        <TabsContent value="settings" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><Settings className="h-4 w-4 text-purple-500" /> Configurações</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="text-xs font-medium">Limite diário de respostas</Label>
                <Input type="number" value={maxDaily} onChange={(e) => setMaxDaily(e.target.value)} className="mt-1.5 max-w-xs" />
                <p className="text-[10px] text-muted-foreground mt-1">Máximo de respostas automáticas por dia (0 = ilimitado)</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Save button */}
      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} className="gap-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Salvar Agente
        </Button>
      </div>

      {/* Info */}
      <Card className="border-dashed">
        <CardContent className="py-4">
          <p className="text-xs text-muted-foreground text-center">
            ⚠️ O agente usa IA para gerar respostas automáticas. Revise as configurações para garantir que as respostas estejam alinhadas com sua marca.
            Respostas a comentários requerem o escopo <code className="bg-muted px-1 rounded">instagram_manage_comments</code>.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
