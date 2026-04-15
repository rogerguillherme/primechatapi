import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  CalendarDays, Clock, ImageIcon, Plus, Send, Trash2, Edit, Image as ImageLucide,
  Play, FileText, Sparkles, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";

interface ScheduledPost {
  id: string;
  caption: string;
  mediaUrl: string;
  type: "IMAGE" | "VIDEO" | "CAROUSEL";
  scheduledAt: Date;
  status: "draft" | "scheduled" | "published" | "failed";
}

const mockPosts: ScheduledPost[] = [
  {
    id: "1",
    caption: "Novo produto disponível! 🔥 Confira o link na bio.",
    mediaUrl: "",
    type: "IMAGE",
    scheduledAt: new Date(Date.now() + 86400000),
    status: "scheduled",
  },
  {
    id: "2",
    caption: "Bastidores da produção 🎬",
    mediaUrl: "",
    type: "VIDEO",
    scheduledAt: new Date(Date.now() + 172800000),
    status: "draft",
  },
];

const statusMap: Record<string, { label: string; color: string }> = {
  draft: { label: "Rascunho", color: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20" },
  scheduled: { label: "Agendado", color: "bg-blue-500/10 text-blue-600 border-blue-500/20" },
  published: { label: "Publicado", color: "bg-green-500/10 text-green-600 border-green-500/20" },
  failed: { label: "Falhou", color: "bg-red-500/10 text-red-600 border-red-500/20" },
};

export function InstagramPosts() {
  const [posts, setPosts] = useState<ScheduledPost[]>(mockPosts);
  const [creating, setCreating] = useState(false);
  const [caption, setCaption] = useState("");
  const [postType, setPostType] = useState<"IMAGE" | "VIDEO" | "CAROUSEL">("IMAGE");
  const [date, setDate] = useState<Date | undefined>(undefined);
  const [time, setTime] = useState("12:00");
  const [aiLoading, setAiLoading] = useState(false);

  const handleCreate = () => {
    if (!caption.trim()) {
      toast.error("Adicione uma legenda");
      return;
    }
    if (!date) {
      toast.error("Selecione uma data");
      return;
    }
    const [h, m] = time.split(":").map(Number);
    const scheduledAt = new Date(date);
    scheduledAt.setHours(h, m, 0, 0);

    const newPost: ScheduledPost = {
      id: crypto.randomUUID(),
      caption,
      mediaUrl: "",
      type: postType,
      scheduledAt,
      status: "scheduled",
    };
    setPosts(prev => [newPost, ...prev]);
    setCaption("");
    setDate(undefined);
    setCreating(false);
    toast.success("Post agendado com sucesso!");
  };

  const handleDelete = (id: string) => {
    setPosts(prev => prev.filter(p => p.id !== id));
    toast.success("Post removido");
  };

  const generateCaption = async () => {
    setAiLoading(true);
    // Simulated AI generation
    setTimeout(() => {
      setCaption("✨ Novidades chegando! Fique ligado nas próximas atualizações. Comente aqui o que você mais espera! 👇🔥 #novidades #lançamento");
      setAiLoading(false);
      toast.success("Legenda gerada pela IA!");
    }, 1500);
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Postagens</h2>
          <p className="text-sm text-muted-foreground">Agende e gerencie suas publicações</p>
        </div>
        <Button
          onClick={() => setCreating(!creating)}
          className="gap-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
        >
          <Plus className="h-4 w-4" /> Nova Postagem
        </Button>
      </div>

      {/* Create form */}
      {creating && (
        <Card className="border-purple-500/20">
          <CardHeader>
            <CardTitle className="text-base">Criar Postagem</CardTitle>
            <CardDescription>Agende uma nova publicação para o Instagram</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium mb-1.5 block">Tipo de conteúdo</label>
                  <Select value={postType} onValueChange={(v) => setPostType(v as any)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="IMAGE"><div className="flex items-center gap-2"><ImageLucide className="h-4 w-4" /> Imagem</div></SelectItem>
                      <SelectItem value="VIDEO"><div className="flex items-center gap-2"><Play className="h-4 w-4" /> Vídeo / Reels</div></SelectItem>
                      <SelectItem value="CAROUSEL"><div className="flex items-center gap-2"><ImageIcon className="h-4 w-4" /> Carrossel</div></SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="text-xs font-medium mb-1.5 block">Data</label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !date && "text-muted-foreground")}>
                        <CalendarDays className="mr-2 h-4 w-4" />
                        {date ? format(date, "dd 'de' MMM, yyyy", { locale: ptBR }) : "Selecionar data"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar mode="single" selected={date} onSelect={setDate} locale={ptBR} disabled={(d) => d < new Date()} />
                    </PopoverContent>
                  </Popover>
                </div>

                <div>
                  <label className="text-xs font-medium mb-1.5 block">Horário</label>
                  <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-medium">Legenda</label>
                    <Button variant="ghost" size="sm" onClick={generateCaption} disabled={aiLoading} className="text-xs gap-1 h-7">
                      {aiLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                      Gerar com IA
                    </Button>
                  </div>
                  <Textarea
                    value={caption}
                    onChange={(e) => setCaption(e.target.value)}
                    placeholder="Escreva a legenda do post..."
                    className="min-h-[140px] resize-none"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">{caption.length}/2200 caracteres</p>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setCreating(false)}>Cancelar</Button>
              <Button onClick={handleCreate} className="gap-2 bg-gradient-to-r from-purple-600 to-pink-600">
                <Send className="h-4 w-4" /> Agendar Post
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Posts list */}
      <div className="space-y-3">
        {posts.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center text-muted-foreground">
              <FileText className="h-12 w-12 mx-auto mb-4 opacity-20" />
              <p className="text-lg font-medium">Nenhuma postagem agendada</p>
              <p className="text-sm mt-1">Crie uma nova postagem para começar</p>
            </CardContent>
          </Card>
        ) : (
          posts.map((post) => {
            const st = statusMap[post.status];
            return (
              <Card key={post.id} className="hover:shadow-sm transition-shadow">
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-start gap-4">
                    <div className="w-16 h-16 rounded-lg bg-gradient-to-br from-purple-500/10 to-pink-500/10 flex items-center justify-center shrink-0">
                      {post.type === "VIDEO" ? <Play className="h-6 w-6 text-purple-500" /> :
                       post.type === "CAROUSEL" ? <ImageIcon className="h-6 w-6 text-purple-500" /> :
                       <ImageLucide className="h-6 w-6 text-purple-500" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge className={cn("text-[10px]", st.color)}>{st.label}</Badge>
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <CalendarDays className="h-3 w-3" />
                          {format(post.scheduledAt, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                        </span>
                      </div>
                      <p className="text-sm line-clamp-2">{post.caption}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button variant="ghost" size="icon" className="h-8 w-8"><Edit className="h-3.5 w-3.5" /></Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(post.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* Info card */}
      <Card className="border-dashed">
        <CardContent className="py-4">
          <p className="text-xs text-muted-foreground text-center">
            ⚠️ O agendamento de posts requer permissão <code className="bg-muted px-1 rounded">instagram_content_publish</code> no app Meta.
            Posts agendados serão publicados automaticamente no horário definido.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
