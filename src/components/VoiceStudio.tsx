import { useState, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Mic, Plus, Play, Pause, Volume2, Loader2 } from "lucide-react";
import { toast } from "sonner";

// Map to real ElevenLabs voice IDs
const preConfiguredVoices = [
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah", label: "Feminina - Suave", color: "bg-purple-500" },
  { id: "JBFqnCBsd6RMkjVDRZzb", name: "George", label: "Masculino - Profissional", color: "bg-emerald-500" },
  { id: "FGY2WhTYpPnrIDTdsKH5", name: "Laura", label: "Feminina - Acolhedora", color: "bg-amber-500" },
  { id: "TX3LPaxmHKxFdv7VOQHJ", name: "Liam", label: "Masculino - Jovem", color: "bg-cyan-500" },
  { id: "XrExE9yKIg1WjnnlVkGX", name: "Matilda", label: "Feminina - Expressiva", color: "bg-rose-500" },
  { id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel", label: "Masculino - Calmo", color: "bg-indigo-500" },
  { id: "pFZP5JQG7iQjIQuC4Bku", name: "Lily", label: "Feminina - Amigável", color: "bg-pink-500" },
  { id: "nPczCjzI2devNBz1zQrb", name: "Brian", label: "Masculino - Narrador", color: "bg-violet-500" },
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
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  const handleGenerate = async () => {
    if (!text.trim()) {
      toast.error("Digite um texto para gerar o áudio.");
      return;
    }
    if (!selectedVoice) {
      toast.error("Selecione uma voz primeiro.");
      return;
    }

    setIsGenerating(true);
    setAudioUrl(null);

    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/elevenlabs-tts`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({
            text,
            voiceId: selectedVoice,
            stability: stability[0],
            similarity_boost: similarity[0],
            style: accent[0],
            speed: speed[0],
          }),
        }
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Erro ${response.status}`);
      }

      const audioBlob = await response.blob();
      const url = URL.createObjectURL(audioBlob);
      setAudioUrl(url);
      toast.success("Áudio gerado com sucesso!");

      // Auto-play
      if (audioRef.current) {
        audioRef.current.src = url;
        audioRef.current.play();
        setIsPlaying(true);
      }
    } catch (e: any) {
      console.error("TTS error:", e);
      toast.error(e.message || "Erro ao gerar áudio.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handlePlayPause = () => {
    if (!audioRef.current || !audioUrl) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  const handlePreviewVoice = async (voiceId: string) => {
    if (playingVoice === voiceId) {
      previewAudioRef.current?.pause();
      setPlayingVoice(null);
      return;
    }

    setPlayingVoice(voiceId);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/elevenlabs-tts`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({
            text: "Olá! Eu sou uma voz do Prime Chat. Como posso te ajudar hoje?",
            voiceId,
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.5,
            speed: 1.0,
          }),
        }
      );

      if (!response.ok) throw new Error("Failed to preview voice");

      const audioBlob = await response.blob();
      const url = URL.createObjectURL(audioBlob);

      if (previewAudioRef.current) {
        previewAudioRef.current.src = url;
        previewAudioRef.current.onended = () => setPlayingVoice(null);
        previewAudioRef.current.play();
      }
    } catch {
      toast.error("Erro ao reproduzir preview da voz.");
      setPlayingVoice(null);
    }
  };

  const selectedVoiceName = preConfiguredVoices.find(v => v.id === selectedVoice)?.name;

  return (
    <div className="space-y-6">
      {/* Hidden audio elements */}
      <audio ref={audioRef} onEnded={() => setIsPlaying(false)} />
      <audio ref={previewAudioRef} />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground flex items-center gap-2">
            <Volume2 className="text-primary" size={24} />
            Voice Studio
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Gere áudios com vozes realistas usando ElevenLabs.
          </p>
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
                <p>Modelo: {selectedVoiceName || "Não Selecionado"}</p>
              </div>

              {/* Audio player */}
              <div className="flex items-center gap-3 bg-primary rounded-lg px-4 py-3 text-primary-foreground">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-primary-foreground hover:bg-white/20"
                  onClick={handlePlayPause}
                  disabled={!audioUrl}
                >
                  {isPlaying ? <Pause size={16} /> : <Play size={16} />}
                </Button>
                <div className="flex-1 h-1 bg-white/30 rounded-full">
                  <div className={`h-1 ${audioUrl ? "w-full" : "w-0"} bg-white rounded-full transition-all`} />
                </div>
              </div>

              <div className="flex justify-center">
                <Button
                  onClick={handleGenerate}
                  disabled={isGenerating || !text.trim() || !selectedVoice}
                  className="bg-primary hover:bg-primary/90 px-8 gap-2"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 size={16} className="animate-spin" /> Gerando...
                    </>
                  ) : (
                    "Gerar áudio"
                  )}
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
            <h3 className="text-lg font-display font-semibold text-foreground mb-3">Vozes disponíveis</h3>
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
                        handlePreviewVoice(voice.id);
                      }}
                    >
                      {playingVoice === voice.id ? (
                        <Loader2 size={16} className="animate-spin" />
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
