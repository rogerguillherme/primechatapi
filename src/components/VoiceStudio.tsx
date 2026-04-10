import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Mic, Plus, Play, Pause, Volume2 } from "lucide-react";

const preConfiguredVoices = [
  { id: "julieta", name: "Julieta", label: "Pré Configurada", color: "bg-purple-500" },
  { id: "marcos", name: "Marcos Vinicius", label: "Pré Configurada", color: "bg-emerald-500" },
  { id: "carla", name: "Carla", label: "Pré Configurada", color: "bg-amber-500" },
  { id: "joao", name: "João Pedro", label: "Pré Configurada", color: "bg-cyan-500" },
  { id: "maria", name: "Maria Eduarda", label: "Pré Configurada", color: "bg-rose-500" },
  { id: "otavio", name: "Otavio Luiz", label: "Pré Configurada", color: "bg-indigo-500" },
  { id: "bia", name: "Bia", label: "Pré Configurada", color: "bg-pink-500" },
  { id: "samuel", name: "Samuel", label: "Pré Configurada", color: "bg-violet-500" },
];

export function VoiceStudio() {
  const [text, setText] = useState("");
  const [stability, setStability] = useState([0.5]);
  const [similarity, setSimilarity] = useState([0.7]);
  const [accent, setAccent] = useState([0.5]);
  const [speed, setSpeed] = useState([1.0]);
  const [selectedVoice, setSelectedVoice] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [playingVoice, setPlayingVoice] = useState<string | null>(null);
  const [tokensUsed] = useState(0);
  const [tokensTotal] = useState(1000);

  const handleGenerate = () => {
    if (!text.trim()) return;
    setIsGenerating(true);
    setTimeout(() => setIsGenerating(false), 2000);
  };

  const handlePlayVoice = (voiceId: string) => {
    setPlayingVoice(playingVoice === voiceId ? null : voiceId);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground flex items-center gap-2">
            <Volume2 className="text-primary" size={24} />
            Voice Studio
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Gerenciar as vozes disponíveis, assim como personalizar vozes de acordo com suas preferências.
          </p>
        </div>
        <div className="text-right">
          <p className="text-lg font-display font-bold text-foreground">
            Usados {tokensUsed} de {tokensTotal.toLocaleString()} tokens
          </p>
          <p className="text-xs text-muted-foreground">+0 de tokens bônus</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Generation Panel */}
        <div className="space-y-4">
          <Tabs defaultValue="generate">
            <TabsList className="bg-muted">
              <TabsTrigger value="generate" className="gap-2">
                <Mic size={14} /> Gerar áudio
              </TabsTrigger>
              <TabsTrigger value="add-voice" className="gap-2">
                <Plus size={14} /> Adicionar uma nova voz
              </TabsTrigger>
            </TabsList>

            <TabsContent value="generate" className="space-y-4 mt-4">
              <Textarea
                placeholder="Digite aqui o texto desejado para virar um áudio."
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="min-h-[120px] resize-none"
              />

              <div className="space-y-5 pt-2">
                <SliderControl label="Estabilidade" value={stability} onChange={setStability} min={0} max={1} step={0.1} />
                <SliderControl label="Similaridade" value={similarity} onChange={setSimilarity} min={0} max={1} step={0.1} />
                <SliderControl label="Sotaque" value={accent} onChange={setAccent} min={0} max={1} step={0.1} />
                <SliderControl label="Velocidade" value={speed} onChange={setSpeed} min={0.7} max={1.2} step={0.1} />
              </div>

              <div className="text-sm text-muted-foreground space-y-1">
                <p>Modelo: {selectedVoice ? preConfiguredVoices.find(v => v.id === selectedVoice)?.name : "Não Selecionado"}</p>
                <p>Custo de tokens: 0 tokens</p>
              </div>

              {/* Audio player placeholder */}
              <div className="flex items-center gap-3 bg-primary rounded-lg px-4 py-3 text-primary-foreground">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-primary-foreground hover:bg-white/20"
                >
                  <Play size={16} />
                </Button>
                <div className="flex-1 h-1 bg-white/30 rounded-full">
                  <div className="h-1 w-0 bg-white rounded-full" />
                </div>
                <span className="text-xs font-mono">0:00</span>
                <span className="text-xs font-mono">0:00</span>
              </div>

              <div className="flex justify-center">
                <Button
                  onClick={handleGenerate}
                  disabled={isGenerating || !text.trim()}
                  className="bg-primary hover:bg-primary/90 px-8"
                >
                  {isGenerating ? "Gerando..." : "Gerar áudio"}
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="add-voice" className="mt-4">
              <Card>
                <CardContent className="py-8 text-center space-y-3">
                  <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto">
                    <Plus size={24} className="text-muted-foreground" />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Faça upload de um áudio para clonar uma voz personalizada.
                  </p>
                  <Button variant="outline">Fazer upload de áudio</Button>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        {/* Right: Voice Selection */}
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-display font-semibold text-foreground">Vozes personalizadas</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Você ainda não possui nenhuma voz personalizada.
            </p>
          </div>

          <div>
            <h3 className="text-lg font-display font-semibold text-foreground mb-3">Modelos pré aprovados</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {preConfiguredVoices.map((voice) => (
                <Card
                  key={voice.id}
                  className={`cursor-pointer transition-all hover:shadow-card-hover ${
                    selectedVoice === voice.id ? "ring-2 ring-primary border-primary" : ""
                  }`}
                  onClick={() => setSelectedVoice(voice.id)}
                >
                  <CardContent className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-3">
                      <Avatar className="h-10 w-10">
                        <AvatarFallback className={`${voice.color} text-white text-sm font-medium`}>
                          {voice.name.charAt(0)}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-medium text-sm">{voice.name}</p>
                        <p className="text-xs text-muted-foreground">{voice.label}</p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 rounded-full"
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePlayVoice(voice.id);
                      }}
                    >
                      {playingVoice === voice.id ? (
                        <Pause size={16} />
                      ) : (
                        <Play size={16} />
                      )}
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SliderControl({
  label,
  value,
  onChange,
  min,
  max,
  step,
}: {
  label: string;
  value: number[];
  onChange: (v: number[]) => void;
  min: number;
  max: number;
  step: number;
}) {
  return (
    <div className="flex items-center gap-4">
      <span className="text-sm text-foreground w-28 shrink-0">{label}</span>
      <Slider
        value={value}
        onValueChange={onChange}
        min={min}
        max={max}
        step={step}
        className="flex-1"
      />
      <span className="text-sm text-primary font-medium w-10 text-right">{value[0].toFixed(1)}</span>
    </div>
  );
}
