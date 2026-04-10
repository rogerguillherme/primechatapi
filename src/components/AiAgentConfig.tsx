import { useState, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Bot, User, FileText, HelpCircle, FolderOpen, Save, Volume2, ArrowLeft, Plus, Trash2, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const voiceOptions = [
  { id: "samuel", name: "Samuel" },
  { id: "julieta", name: "Julieta" },
  { id: "marcos", name: "Marcos Vinicius" },
  { id: "carla", name: "Carla" },
  { id: "joao", name: "João Pedro" },
  { id: "maria", name: "Maria Eduarda" },
  { id: "otavio", name: "Otavio Luiz" },
  { id: "bia", name: "Bia" },
];

const AI_KEYS = [
  "ai_auto_reply_enabled",
  "ai_company_name",
  "ai_company_description",
  "ai_products_services",
  "ai_custom_instructions",
  "ai_agent_identity",
  "ai_agent_guidelines",
  "ai_agent_voice",
  "ai_agent_knowledge",
  "ai_agent_faq",
] as const;

export function AiAgentConfig() {
  const [identity, setIdentity] = useState("");
  const [guidelines, setGuidelines] = useState("");
  const [instructions, setInstructions] = useState("");
  const [knowledge, setKnowledge] = useState("");
  const [selectedVoice, setSelectedVoice] = useState("samuel");
  const [stability, setStability] = useState([0.5]);
  const [similarity, setSimilarity] = useState([0.7]);
  const [accent, setAccent] = useState([0.5]);
  const [speed, setSpeed] = useState([1.0]);
  const [faqItems, setFaqItems] = useState<{ question: string; answer: string }[]>([]);
  const [saving, setSaving] = useState(false);

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

    setIdentity(map.ai_agent_identity || "");
    setGuidelines(map.ai_agent_guidelines || map.ai_company_description || "");
    setInstructions(map.ai_custom_instructions || "");
    setKnowledge(map.ai_agent_knowledge || "");
    setSelectedVoice(map.ai_agent_voice || "samuel");

    try {
      const faq = JSON.parse(map.ai_agent_faq || "[]");
      setFaqItems(faq);
    } catch {
      setFaqItems([]);
    }
  }

  async function handleSave() {
    setSaving(true);
    const pairs: Record<string, string> = {
      ai_agent_identity: identity,
      ai_agent_guidelines: guidelines,
      ai_custom_instructions: instructions,
      ai_agent_knowledge: knowledge,
      ai_agent_voice: selectedVoice,
      ai_agent_faq: JSON.stringify(faqItems),
    };

    for (const [key, value] of Object.entries(pairs)) {
      await supabase.from("app_settings").upsert({ key, value }, { onConflict: "key" });
    }

    setSaving(false);
    toast.success("Configurações do agente salvas!");
  }

  const addFaqItem = () => setFaqItems([...faqItems, { question: "", answer: "" }]);
  const removeFaqItem = (i: number) => setFaqItems(faqItems.filter((_, idx) => idx !== i));
  const updateFaq = (i: number, field: "question" | "answer", value: string) => {
    const updated = [...faqItems];
    updated[i][field] = value;
    setFaqItems(updated);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground flex items-center gap-2">
            <Bot className="text-primary" size={24} />
            Agente IA
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Gerencie as configurações do agente</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleSave} disabled={saving} className="gap-2">
            <Save size={14} />
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        </div>
      </div>

      <Tabs defaultValue="personality" className="w-full">
        <TabsList className="bg-muted w-full justify-start">
          <TabsTrigger value="personality" className="gap-2">
            <User size={14} /> Personalidade
          </TabsTrigger>
          <TabsTrigger value="instructions" className="gap-2">
            <FileText size={14} /> Instruções
          </TabsTrigger>
          <TabsTrigger value="knowledge" className="gap-2">
            <FolderOpen size={14} /> Base de Informações
          </TabsTrigger>
          <TabsTrigger value="faq" className="gap-2">
            <HelpCircle size={14} /> Perguntas e Respostas
          </TabsTrigger>
          <TabsTrigger value="files" className="gap-2">
            <Upload size={14} /> Arquivos
          </TabsTrigger>
        </TabsList>

        {/* Personality Tab */}
        <TabsContent value="personality" className="space-y-6 mt-4">
          <div className="space-y-2">
            <Label className="text-base font-semibold">Identidade</Label>
            <Textarea
              placeholder="Seu nome é Prime, você é a assistente virtual da empresa Prime Chat. Você é simpática, acolhedora e sempre demonstra empatia nas interações."
              value={identity}
              onChange={(e) => setIdentity(e.target.value)}
              className="min-h-[100px]"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-base font-semibold">Diretrizes de Comunicação</Label>
            <Textarea
              placeholder={`Defina como o agente deve se expressar no atendimento (tom de voz, clareza, formalidade, uso de emojis).\n\nExemplo 1: 'Comunique-se de forma clara, objetiva e educada. Use linguagem formal e evite gírias. Não utilize emojis.'\nExemplo 2: 'Use uma linguagem leve, simpática e acolhedora. Seja sempre positivo e demonstre proximidade com o cliente. Utilize emojis apenas para reforçar simpatia, sem exagerar.'`}
              value={guidelines}
              onChange={(e) => setGuidelines(e.target.value)}
              className="min-h-[140px]"
            />
            <div className="flex items-center gap-2 text-xs text-muted-foreground justify-end">
              <button className="font-bold hover:text-foreground">B</button>
              <button className="italic hover:text-foreground">I</button>
              <button className="line-through hover:text-foreground">S</button>
              <button className="hover:text-foreground">+ Adicionar variável</button>
            </div>
          </div>

          {/* Voice Section */}
          <div className="space-y-4 pt-2">
            <Label className="text-base font-semibold">Voz</Label>
            <div className="flex items-center gap-4">
              <Select value={selectedVoice} onValueChange={setSelectedVoice}>
                <SelectTrigger className="w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {voiceOptions.map((v) => (
                    <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" className="gap-2">
                <Volume2 size={14} /> Testar Voz
              </Button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              <VoiceSlider label="Estabilidade" range="0.0 - 1.0" description="Controla a consistência da voz entre diferentes gerações" value={stability} onChange={setStability} />
              <VoiceSlider label="Similaridade" range="0.0 - 1.0" description="Controla o quão similar a voz gerada será à voz original" value={similarity} onChange={setSimilarity} />
              <VoiceSlider label="Sotaque" range="0.0 - 1.0" description="Controla o estilo e expressividade da voz" value={accent} onChange={setAccent} />
              <VoiceSlider label="Velocidade" range="0.7 - 1.2" description="Controla a velocidade de fala da voz" value={speed} onChange={setSpeed} min={0.7} max={1.2} />
            </div>
          </div>
        </TabsContent>

        {/* Instructions Tab */}
        <TabsContent value="instructions" className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label className="text-base font-semibold">Instruções Personalizadas</Label>
            <p className="text-sm text-muted-foreground">
              Defina instruções detalhadas sobre como o agente deve se comportar, responder e interagir com os clientes.
            </p>
            <Textarea
              placeholder="Ex: Sempre cumprimente o cliente pelo nome quando disponível. Nunca forneça informações sobre preços sem antes consultar o catálogo atualizado. Se o cliente mencionar um problema, mostre empatia antes de oferecer soluções..."
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              className="min-h-[300px]"
            />
          </div>
        </TabsContent>

        {/* Knowledge Base Tab */}
        <TabsContent value="knowledge" className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label className="text-base font-semibold">Base de Informações</Label>
            <p className="text-sm text-muted-foreground">
              Adicione informações sobre sua empresa, produtos, serviços e políticas que o agente usará para responder.
            </p>
            <Textarea
              placeholder="Ex: A Prime Chat é uma plataforma de comunicação via WhatsApp. Nossos planos incluem... Horário de atendimento: segunda a sexta, 9h às 18h..."
              value={knowledge}
              onChange={(e) => setKnowledge(e.target.value)}
              className="min-h-[300px]"
            />
          </div>
        </TabsContent>

        {/* FAQ Tab */}
        <TabsContent value="faq" className="space-y-4 mt-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-base font-semibold">Perguntas e Respostas</Label>
              <p className="text-sm text-muted-foreground">Adicione pares de pergunta e resposta para treinar o agente.</p>
            </div>
            <Button onClick={addFaqItem} variant="outline" size="sm" className="gap-2">
              <Plus size={14} /> Adicionar
            </Button>
          </div>

          {faqItems.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center space-y-3">
                <HelpCircle size={32} className="mx-auto text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Nenhuma pergunta cadastrada ainda.</p>
                <Button onClick={addFaqItem} variant="outline" size="sm">
                  Adicionar primeira pergunta
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {faqItems.map((item, i) => (
                <Card key={i}>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <Badge variant="secondary" className="text-xs">#{i + 1}</Badge>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeFaqItem(i)}>
                        <Trash2 size={14} />
                      </Button>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">Pergunta</Label>
                      <Input
                        placeholder="Ex: Qual o horário de atendimento?"
                        value={item.question}
                        onChange={(e) => updateFaq(i, "question", e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">Resposta</Label>
                      <Textarea
                        placeholder="Ex: Nosso horário de atendimento é de segunda a sexta, das 9h às 18h."
                        value={item.answer}
                        onChange={(e) => updateFaq(i, "answer", e.target.value)}
                        className="min-h-[80px]"
                      />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Files Tab */}
        <TabsContent value="files" className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label className="text-base font-semibold">Arquivos</Label>
            <p className="text-sm text-muted-foreground">
              Faça upload de documentos (PDF, TXT, DOCX) para enriquecer a base de conhecimento do agente.
            </p>
          </div>
          <Card>
            <CardContent className="py-12 text-center space-y-3">
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto">
                <Upload size={24} className="text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">Arraste arquivos aqui ou clique para selecionar</p>
              <Button variant="outline">Selecionar arquivos</Button>
              <p className="text-xs text-muted-foreground">Formatos aceitos: PDF, TXT, DOCX (máx. 10MB)</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function VoiceSlider({
  label,
  range,
  description,
  value,
  onChange,
  min = 0,
  max = 1,
}: {
  label: string;
  range: string;
  description: string;
  value: number[];
  onChange: (v: number[]) => void;
  min?: number;
  max?: number;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">{label} <span className="text-muted-foreground font-normal">({range})</span></Label>
        <span className="text-sm text-primary font-medium">{value[0].toFixed(1)}{label === "Velocidade" ? "x" : ""}</span>
      </div>
      <Slider value={value} onValueChange={onChange} min={min} max={max} step={0.1} />
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}
