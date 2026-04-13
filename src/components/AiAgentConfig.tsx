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
import { Bot, User, FileText, HelpCircle, FolderOpen, Save, Volume2, Plus, Trash2, Upload, ArrowLeft, ChevronRight, Play, Pause } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

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

interface AiAgent {
  id: string;
  name: string;
  identity: string;
  guidelines: string;
  instructions: string;
  knowledge: string;
  faq: { question: string; answer: string }[];
  voice: string;
  voice_stability: number;
  voice_similarity: number;
  voice_accent: number;
  voice_speed: number;
  ai_model: string;
  max_interactions: number;
  active: boolean;
  created_at: string;
}

/* ── Agent List View ── */
function AgentListView({ onEdit }: { onEdit: (agent: AiAgent | null) => void }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: agents, isLoading } = useQuery({
    queryKey: ["ai-agents"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_agents")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as AiAgent[];
    },
    enabled: !!user,
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase.from("ai_agents").update({ active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["ai-agents"] }),
  });

  const deleteAgent = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("ai_agents").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-agents"] });
      toast.success("Agente removido.");
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground flex items-center gap-2">
            <Bot className="text-primary" size={24} />
            Agentes IA
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Crie e gerencie seus agentes de atendimento</p>
        </div>
        <Button size="sm" onClick={() => onEdit(null)}>
          <Plus size={14} /> Novo Agente
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="text-sm text-muted-foreground text-center py-8">Carregando...</p>
          ) : !agents?.length ? (
            <div className="text-center py-12 space-y-3">
              <Bot size={40} className="mx-auto text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Nenhum agente criado ainda.</p>
              <Button variant="outline" size="sm" onClick={() => onEdit(null)}>
                Criar primeiro agente
              </Button>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {agents.map((agent) => (
                <div key={agent.id} className="flex items-center gap-3 px-4 py-3 hover:bg-accent/30 transition-colors">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <Bot size={16} className="text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{agent.name}</p>
                      <Badge variant={agent.active ? "default" : "secondary"} className="text-[10px]">
                        {agent.active ? "Ativo" : "Inativo"}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {agent.identity || "Sem identidade definida"}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost" size="icon" className="h-8 w-8"
                      onClick={() => toggleActive.mutate({ id: agent.id, active: !agent.active })}
                    >
                      {agent.active ? <Pause size={14} /> : <Play size={14} />}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit(agent)}>
                      <ChevronRight size={14} />
                    </Button>
                    <Button
                      variant="ghost" size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => { if (confirm("Remover agente?")) deleteAgent.mutate(agent.id); }}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ── Agent Editor View ── */
function AgentEditorView({ agent, onBack }: { agent: AiAgent | null; onBack: () => void }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [name, setName] = useState(agent?.name || "");
  const [identity, setIdentity] = useState(agent?.identity || "");
  const [guidelines, setGuidelines] = useState(agent?.guidelines || "");
  const [instructions, setInstructions] = useState(agent?.instructions || "");
  const [knowledge, setKnowledge] = useState(agent?.knowledge || "");
  const [selectedVoice, setSelectedVoice] = useState(agent?.voice || "samuel");
  const [stability, setStability] = useState([agent?.voice_stability ?? 0.5]);
  const [similarity, setSimilarity] = useState([agent?.voice_similarity ?? 0.7]);
  const [accent, setAccent] = useState([agent?.voice_accent ?? 0.5]);
  const [speed, setSpeed] = useState([agent?.voice_speed ?? 1.0]);
  const [faqItems, setFaqItems] = useState<{ question: string; answer: string }[]>(
    Array.isArray(agent?.faq) ? agent.faq : []
  );
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!name.trim()) { toast.error("Nome é obrigatório."); return; }
    if (!user) return;
    setSaving(true);

    const payload = {
      user_id: user.id,
      name: name.trim(),
      identity,
      guidelines,
      instructions,
      knowledge,
      faq: faqItems,
      voice: selectedVoice,
      voice_stability: stability[0],
      voice_similarity: similarity[0],
      voice_accent: accent[0],
      voice_speed: speed[0],
      updated_at: new Date().toISOString(),
    };

    let error;
    if (agent) {
      ({ error } = await supabase.from("ai_agents").update(payload).eq("id", agent.id));
    } else {
      ({ error } = await supabase.from("ai_agents").insert(payload));
    }

    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(agent ? "Agente atualizado!" : "Agente criado!");
    queryClient.invalidateQueries({ queryKey: ["ai-agents"] });
    onBack();
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
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft size={18} />
          </Button>
          <div>
            <h1 className="text-2xl font-display font-bold text-foreground flex items-center gap-2">
              <Bot className="text-primary" size={24} />
              {agent ? "Editar Agente" : "Novo Agente"}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">Configure a personalidade e comportamento</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={handleSave} disabled={saving} className="gap-2">
          <Save size={14} />
          {saving ? "Salvando..." : "Salvar"}
        </Button>
      </div>

      {/* Name field */}
      <div className="space-y-2">
        <Label className="text-sm font-semibold">Nome do Agente</Label>
        <Input
          placeholder="Ex: Assistente de Vendas, Suporte Técnico..."
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <Tabs defaultValue="personality" className="w-full">
        <TabsList className="bg-muted w-full justify-start">
          <TabsTrigger value="personality" className="gap-2"><User size={14} /> Personalidade</TabsTrigger>
          <TabsTrigger value="instructions" className="gap-2"><FileText size={14} /> Instruções</TabsTrigger>
          <TabsTrigger value="knowledge" className="gap-2"><FolderOpen size={14} /> Base de Informações</TabsTrigger>
          <TabsTrigger value="faq" className="gap-2"><HelpCircle size={14} /> Perguntas e Respostas</TabsTrigger>
          <TabsTrigger value="files" className="gap-2"><Upload size={14} /> Arquivos</TabsTrigger>
        </TabsList>

        <TabsContent value="personality" className="space-y-6 mt-4">
          <div className="space-y-2">
            <Label className="text-base font-semibold">Identidade</Label>
            <Textarea
              placeholder="Seu nome é Prime, você é a assistente virtual da empresa Prime Chat..."
              value={identity}
              onChange={(e) => setIdentity(e.target.value)}
              className="min-h-[100px]"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-base font-semibold">Diretrizes de Comunicação</Label>
            <Textarea
              placeholder="Defina como o agente deve se expressar no atendimento..."
              value={guidelines}
              onChange={(e) => setGuidelines(e.target.value)}
              className="min-h-[140px]"
            />
          </div>
          <div className="space-y-4 pt-2">
            <Label className="text-base font-semibold">Voz</Label>
            <div className="flex items-center gap-4">
              <Select value={selectedVoice} onValueChange={setSelectedVoice}>
                <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {voiceOptions.map((v) => (
                    <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" className="gap-2"><Volume2 size={14} /> Testar Voz</Button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              <VoiceSlider label="Estabilidade" range="0.0 - 1.0" description="Controla a consistência da voz" value={stability} onChange={setStability} />
              <VoiceSlider label="Similaridade" range="0.0 - 1.0" description="Controla a similaridade à voz original" value={similarity} onChange={setSimilarity} />
              <VoiceSlider label="Sotaque" range="0.0 - 1.0" description="Controla o estilo e expressividade" value={accent} onChange={setAccent} />
              <VoiceSlider label="Velocidade" range="0.7 - 1.2" description="Controla a velocidade de fala" value={speed} onChange={setSpeed} min={0.7} max={1.2} />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="instructions" className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label className="text-base font-semibold">Instruções Personalizadas</Label>
            <p className="text-sm text-muted-foreground">Defina instruções detalhadas sobre como o agente deve se comportar.</p>
            <Textarea
              placeholder="Ex: Sempre cumprimente o cliente pelo nome..."
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              className="min-h-[300px]"
            />
          </div>
        </TabsContent>

        <TabsContent value="knowledge" className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label className="text-base font-semibold">Base de Informações</Label>
            <p className="text-sm text-muted-foreground">Adicione informações sobre sua empresa, produtos e serviços.</p>
            <Textarea
              placeholder="Ex: A Prime Chat é uma plataforma de comunicação via WhatsApp..."
              value={knowledge}
              onChange={(e) => setKnowledge(e.target.value)}
              className="min-h-[300px]"
            />
          </div>
        </TabsContent>

        <TabsContent value="faq" className="space-y-4 mt-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-base font-semibold">Perguntas e Respostas</Label>
              <p className="text-sm text-muted-foreground">Adicione pares de pergunta e resposta.</p>
            </div>
            <Button onClick={addFaqItem} variant="outline" size="sm" className="gap-2"><Plus size={14} /> Adicionar</Button>
          </div>
          {faqItems.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center space-y-3">
                <HelpCircle size={32} className="mx-auto text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Nenhuma pergunta cadastrada.</p>
                <Button onClick={addFaqItem} variant="outline" size="sm">Adicionar primeira pergunta</Button>
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
                      <Input placeholder="Ex: Qual o horário de atendimento?" value={item.question} onChange={(e) => updateFaq(i, "question", e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">Resposta</Label>
                      <Textarea placeholder="Ex: Nosso horário é de segunda a sexta, das 9h às 18h." value={item.answer} onChange={(e) => updateFaq(i, "answer", e.target.value)} className="min-h-[80px]" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="files" className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label className="text-base font-semibold">Arquivos</Label>
            <p className="text-sm text-muted-foreground">Faça upload de documentos para enriquecer a base de conhecimento.</p>
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

/* ── Main Component ── */
export function AiAgentConfig() {
  const [editing, setEditing] = useState<AiAgent | null | undefined>(undefined);

  if (editing !== undefined) {
    return <AgentEditorView agent={editing} onBack={() => setEditing(undefined)} />;
  }

  return <AgentListView onEdit={(agent) => setEditing(agent)} />;
}

function VoiceSlider({ label, range, description, value, onChange, min = 0, max = 1 }: {
  label: string; range: string; description: string; value: number[]; onChange: (v: number[]) => void; min?: number; max?: number;
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
