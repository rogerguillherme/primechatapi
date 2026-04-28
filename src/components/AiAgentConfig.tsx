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
import { Bot, User, FileText, HelpCircle, FolderOpen, Save, Volume2, Plus, Trash2, Upload, ArrowLeft, ChevronRight, Play, Pause, Zap, GraduationCap, MessageSquare, Send, Loader2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { EventAgentMapping } from "@/components/EventAgentMapping";
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
      return (data || []).map((d: any) => ({ ...d, faq: Array.isArray(d.faq) ? d.faq : [] })) as AiAgent[];
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
          <p className="text-sm text-muted-foreground mt-1">Crie e gerencie seus agentes de atendimento e eventos</p>
        </div>
      </div>

      <Tabs defaultValue="agents" className="w-full">
        <TabsList>
          <TabsTrigger value="agents" className="gap-2"><Bot size={14} /> Agentes</TabsTrigger>
          <TabsTrigger value="events" className="gap-2"><Zap size={14} /> Eventos</TabsTrigger>
        </TabsList>

        <TabsContent value="agents" className="mt-4 space-y-4">
          <div className="flex justify-end">
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
        </TabsContent>

        <TabsContent value="events" className="mt-4">
          <EventAgentMapping />
        </TabsContent>
      </Tabs>
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
        <TabsList className="bg-muted w-full justify-start flex-wrap h-auto">
          <TabsTrigger value="personality" className="gap-2"><User size={14} /> Personalidade</TabsTrigger>
          <TabsTrigger value="instructions" className="gap-2"><FileText size={14} /> Instruções</TabsTrigger>
          <TabsTrigger value="knowledge" className="gap-2"><FolderOpen size={14} /> Base de Informações</TabsTrigger>
          <TabsTrigger value="faq" className="gap-2"><HelpCircle size={14} /> Perguntas e Respostas</TabsTrigger>
          <TabsTrigger value="training" className="gap-2"><GraduationCap size={14} /> Treinamento</TabsTrigger>
          <TabsTrigger value="simulation" className="gap-2" disabled={!agent}><MessageSquare size={14} /> Simulação</TabsTrigger>
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

        <TabsContent value="training" className="space-y-4 mt-4">
          {agent ? <TrainingPanel agentId={agent.id} /> : (
            <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">Salve o agente primeiro para começar a treinar.</CardContent></Card>
          )}
        </TabsContent>

        <TabsContent value="simulation" className="space-y-4 mt-4">
          {agent ? <SimulationPanel agentId={agent.id} agentName={name || agent.name} /> : (
            <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">Salve o agente primeiro para simular conversas.</CardContent></Card>
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

/* ── Training Panel ── */
function TrainingPanel({ agentId }: { agentId: string }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [userMessage, setUserMessage] = useState("");
  const [badReply, setBadReply] = useState("");
  const [goodReply, setGoodReply] = useState("");
  const [note, setNote] = useState("");

  const { data: feedbacks, isLoading } = useQuery({
    queryKey: ["agent-feedback", agentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_agent_feedback")
        .select("*")
        .eq("agent_id", agentId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const addFeedback = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Não autenticado");
      const { error } = await supabase.from("ai_agent_feedback").insert({
        agent_id: agentId,
        user_id: user.id,
        user_message: userMessage,
        bad_reply: badReply || null,
        good_reply: goodReply,
        note: note || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Treino adicionado! O agente vai usar isso nas próximas respostas.");
      setUserMessage(""); setBadReply(""); setGoodReply(""); setNote("");
      queryClient.invalidateQueries({ queryKey: ["agent-feedback", agentId] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const removeFeedback = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("ai_agent_feedback").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["agent-feedback", agentId] }),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 space-y-3">
          <div>
            <Label className="text-base font-semibold flex items-center gap-2">
              <GraduationCap size={16} className="text-primary" /> Adicionar Treino por Feedback
            </Label>
            <p className="text-xs text-muted-foreground mt-1">
              Ensine o agente mostrando exemplos reais de como ele deve (ou não deve) responder.
            </p>
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Mensagem do cliente</Label>
            <Textarea placeholder="Ex: Quanto custa o produto?" value={userMessage} onChange={(e) => setUserMessage(e.target.value)} className="min-h-[60px]" />
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-destructive">❌ Resposta ruim (opcional — o que NÃO fazer)</Label>
            <Textarea placeholder="Ex: O preço é R$ 297,00 à vista." value={badReply} onChange={(e) => setBadReply(e.target.value)} className="min-h-[60px]" />
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-green-600">✅ Resposta ideal</Label>
            <Textarea placeholder="Ex: Oi! Olha, o investimento depende do plano que combina mais com você. Posso te explicar rapidinho?" value={goodReply} onChange={(e) => setGoodReply(e.target.value)} className="min-h-[80px]" />
          </div>
          <div className="space-y-2">
            <Label className="text-xs">💡 Observação (opcional)</Label>
            <Input placeholder="Ex: Sempre criar curiosidade antes de dar o preço" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <Button
            onClick={() => addFeedback.mutate()}
            disabled={!userMessage.trim() || !goodReply.trim() || addFeedback.isPending}
            className="gap-2"
          >
            {addFeedback.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Salvar Treino
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-2">
        <Label className="text-sm font-semibold">Treinos cadastrados ({feedbacks?.length || 0})</Label>
        {isLoading ? (
          <p className="text-xs text-muted-foreground">Carregando...</p>
        ) : !feedbacks?.length ? (
          <Card><CardContent className="py-6 text-center text-xs text-muted-foreground">Nenhum treino ainda.</CardContent></Card>
        ) : (
          <div className="space-y-2">
            {feedbacks.map((f: any) => (
              <Card key={f.id}>
                <CardContent className="p-3 space-y-2 text-xs">
                  <div className="flex justify-between items-start gap-2">
                    <p className="text-muted-foreground"><strong>Cliente:</strong> {f.user_message}</p>
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive shrink-0" onClick={() => removeFeedback.mutate(f.id)}>
                      <Trash2 size={12} />
                    </Button>
                  </div>
                  {f.bad_reply && <p className="text-destructive">❌ {f.bad_reply}</p>}
                  <p className="text-green-600">✅ {f.good_reply}</p>
                  {f.note && <p className="text-muted-foreground italic">💡 {f.note}</p>}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Simulation Panel ── */
function SimulationPanel({ agentId, agentName }: { agentId: string; agentName: string }) {
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  async function send() {
    if (!input.trim() || loading) return;
    const userMsg = { role: "user" as const, content: input.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-agent-simulate", {
        body: { agent_id: agentId, messages: newMessages },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setMessages([...newMessages, { role: "assistant", content: data.reply || "..." }]);
    } catch (e: any) {
      toast.error(e.message || "Erro ao simular");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-base font-semibold flex items-center gap-2">
              <MessageSquare size={16} className="text-primary" /> Simulação de Conversa
            </Label>
            <p className="text-xs text-muted-foreground mt-1">
              Teste como <strong>{agentName || "o agente"}</strong> responderia a clientes reais.
            </p>
          </div>
          {messages.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setMessages([])}>Limpar</Button>
          )}
        </div>

        <ScrollArea className="h-[400px] border rounded-lg bg-muted/30 p-3">
          {messages.length === 0 ? (
            <div className="h-full flex items-center justify-center text-center text-xs text-muted-foreground py-20">
              Envie uma mensagem para começar a conversa de teste.
            </div>
          ) : (
            <div className="space-y-2">
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
                    m.role === "user" ? "bg-primary text-primary-foreground" : "bg-card border"
                  }`}>
                    {m.content}
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex justify-start">
                  <div className="bg-card border rounded-2xl px-3 py-2 text-sm text-muted-foreground flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin" /> digitando...
                  </div>
                </div>
              )}
            </div>
          )}
        </ScrollArea>

        <div className="flex gap-2">
          <Input
            placeholder="Digite uma mensagem como se fosse o cliente..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            disabled={loading}
          />
          <Button onClick={send} disabled={!input.trim() || loading} className="gap-2">
            <Send size={14} /> Enviar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
