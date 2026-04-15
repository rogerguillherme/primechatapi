import { useState, useCallback, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import ReactMarkdown from "react-markdown";
import {
  Users, Heart, MessageSquare, Eye, TrendingUp, Instagram,
  ImageIcon, ExternalLink, Loader2, Sparkles, RefreshCw,
  BarChart3, Target, Zap, ThumbsUp, Play, Image as ImageLucide,
  Clock, CalendarDays, Share2,
} from "lucide-react";

function MetricCard({ title, value, icon: Icon, subtitle, loading, gradient }: {
  title: string; value: string; icon: any; subtitle?: string; loading?: boolean; gradient?: string;
}) {
  return (
    <Card className={gradient || ""}>
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</p>
            {loading ? <Skeleton className="h-8 w-20 mt-1" /> : <p className="text-2xl font-bold mt-1">{value}</p>}
            {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
          </div>
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500/10 to-pink-500/10 flex items-center justify-center">
            <Icon className="h-5 w-5 text-purple-500" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function formatNumber(n: number | undefined | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString("pt-BR");
}

function calcEngagement(post: any, followers: number): string {
  const likes = post.like_count ?? 0;
  const comments = post.comments_count ?? 0;
  if (!followers) return "—";
  return ((likes + comments) / followers * 100).toFixed(2) + "%";
}

function timeAgo(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "Hoje";
  if (days === 1) return "Ontem";
  if (days < 30) return `${days}d atrás`;
  if (days < 365) return `${Math.floor(days / 30)}m atrás`;
  return `${Math.floor(days / 365)}a atrás`;
}

const AI_ANALYSIS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/instagram-ai-analysis`;

// ─── Post Detail Modal ───
function PostDetailModal({ post, open, onClose, followers }: {
  post: any; open: boolean; onClose: () => void; followers: number;
}) {
  if (!post) return null;
  const engagement = calcEngagement(post, followers);
  const date = post.timestamp ? new Date(post.timestamp).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" }) : "—";

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <ImageLucide className="h-4 w-4" /> Detalhes do Post
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Image */}
          <div className="aspect-square rounded-lg overflow-hidden bg-muted">
            <img
              src={post.media_type === "VIDEO" ? post.thumbnail_url : post.media_url}
              alt=""
              className="w-full h-full object-cover"
            />
          </div>

          {/* Metrics */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <CalendarDays className="h-3.5 w-3.5" /> {date}
              <Badge variant="outline" className="text-[10px] ml-auto">
                {post.media_type === "VIDEO" ? "Vídeo" : post.media_type === "CAROUSEL_ALBUM" ? "Carrossel" : "Imagem"}
              </Badge>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border p-3 text-center">
                <Heart className="h-4 w-4 mx-auto text-red-500 mb-1" />
                <p className="text-lg font-bold">{formatNumber(post.like_count)}</p>
                <p className="text-[10px] text-muted-foreground">Curtidas</p>
              </div>
              <div className="rounded-lg border p-3 text-center">
                <MessageSquare className="h-4 w-4 mx-auto text-blue-500 mb-1" />
                <p className="text-lg font-bold">{formatNumber(post.comments_count)}</p>
                <p className="text-[10px] text-muted-foreground">Comentários</p>
              </div>
              <div className="rounded-lg border p-3 text-center">
                <Target className="h-4 w-4 mx-auto text-purple-500 mb-1" />
                <p className="text-lg font-bold">{engagement}</p>
                <p className="text-[10px] text-muted-foreground">Engajamento</p>
              </div>
              <div className="rounded-lg border p-3 text-center">
                <Share2 className="h-4 w-4 mx-auto text-green-500 mb-1" />
                <p className="text-lg font-bold">{formatNumber(post.shares_count)}</p>
                <p className="text-[10px] text-muted-foreground">Compartilhamentos</p>
              </div>
            </div>

            {post.caption && (
              <div className="rounded-lg border p-3">
                <p className="text-xs font-medium mb-1">Legenda</p>
                <p className="text-xs text-muted-foreground line-clamp-6">{post.caption}</p>
              </div>
            )}

            {post.permalink && (
              <a href={post.permalink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-purple-500 hover:underline">
                <ExternalLink className="h-3 w-3" /> Ver no Instagram
              </a>
            )}
          </div>
        </div>

        {/* Comments section */}
        {post.comments?.data && post.comments.data.length > 0 && (
          <div className="mt-4">
            <h4 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
              <MessageSquare className="h-4 w-4" /> Principais Comentários
            </h4>
            <div className="space-y-2 max-h-48 overflow-auto">
              {post.comments.data.slice(0, 10).map((c: any, i: number) => (
                <div key={i} className="rounded-lg border p-2.5 text-xs">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-foreground">@{c.username || "usuário"}</span>
                    <span className="text-muted-foreground">{c.timestamp ? timeAgo(c.timestamp) : ""}</span>
                  </div>
                  <p className="text-muted-foreground">{c.text}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── AI Visual Analysis Section ───
function AiAnalysisSection({ data, user }: { data: any; user: any }) {
  const [aiText, setAiText] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiDone, setAiDone] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const runAiAnalysis = useCallback(async () => {
    if (!data) return;
    setAiText("");
    setAiLoading(true);
    setAiDone(false);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(AI_ANALYSIS_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ instagramData: data }),
        signal: controller.signal,
      });

      if (!resp.ok || !resp.body) {
        const err = await resp.json().catch(() => ({ error: "Erro desconhecido" }));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIdx: number;
        while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, newlineIdx);
          buffer = buffer.slice(newlineIdx + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.startsWith(":") || line.trim() === "") continue;
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") break;
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              accumulated += content;
              setAiText(accumulated);
            }
          } catch {
            buffer = line + "\n" + buffer;
            break;
          }
        }
      }
    } catch (e: any) {
      if (e.name !== "AbortError") {
        setAiText(prev => prev + `\n\n❌ Erro: ${e.message}`);
      }
    } finally {
      setAiLoading(false);
      setAiDone(true);
      abortRef.current = null;
    }
  }, [data]);

  return (
    <Card className="border-purple-500/30 bg-gradient-to-br from-purple-500/5 to-pink-500/5">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
              <Sparkles className="h-4 w-4 text-white" />
            </div>
            <div>
              <CardTitle className="text-base">Análise Inteligente com IA</CardTitle>
              <CardDescription className="text-xs">Perfil, melhores posts, padrões e recomendações</CardDescription>
            </div>
          </div>
          <Button
            size="sm"
            onClick={runAiAnalysis}
            disabled={aiLoading || !data}
            className="gap-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
          >
            {aiLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : aiDone ? <RefreshCw className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
            {aiLoading ? "Analisando..." : aiDone ? "Analisar novamente" : "Analisar perfil"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {!aiText && !aiLoading && (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <Sparkles className="h-10 w-10 opacity-20 mb-3" />
            <p className="text-sm">Clique em "Analisar perfil" para obter insights da IA</p>
          </div>
        )}
        {(aiText || aiLoading) && (
          <ScrollArea className="max-h-[600px]">
            <div className="prose prose-sm dark:prose-invert max-w-none [&_h1]:text-lg [&_h2]:text-base [&_h2]:mt-4 [&_h2]:mb-2 [&_h3]:text-sm [&_strong]:text-foreground [&_li]:text-sm">
              <ReactMarkdown>{aiText || "Analisando seus dados..."}</ReactMarkdown>
              {aiLoading && <span className="inline-block w-2 h-4 bg-purple-500 animate-pulse ml-1 rounded" />}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main Component ───
export function InstagramMetrics() {
  const { user } = useAuth();
  const [selectedPost, setSelectedPost] = useState<any>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["instagram-data", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("instagram-fetch-data");
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    enabled: !!user,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  const profile = data?.profile;
  const media = (data?.media || []) as any[];
  const insights = data?.insights;
  const loading = isLoading;
  const followers = profile?.followers_count || 0;

  // Calculate overall engagement
  const totalEng = media.reduce((acc: number, p: any) => acc + (p.like_count || 0) + (p.comments_count || 0), 0);
  const avgEng = media.length > 0 && followers > 0 ? (totalEng / media.length / followers * 100).toFixed(2) + "%" : "—";

  // Best post
  const bestPost = media.length > 0
    ? media.reduce((best: any, p: any) => ((p.like_count || 0) + (p.comments_count || 0)) > ((best.like_count || 0) + (best.comments_count || 0)) ? p : best, media[0])
    : null;

  // Content type breakdown
  const typeCount = { IMAGE: 0, VIDEO: 0, CAROUSEL_ALBUM: 0 };
  media.forEach((p: any) => { if (p.media_type in typeCount) (typeCount as any)[p.media_type]++; });

  if (error && (error as any)?.message?.includes("Nenhuma conta")) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <Instagram className="h-12 w-12 mx-auto mb-4 opacity-20" />
            <p className="text-lg font-medium">Conecte sua conta Instagram</p>
            <p className="text-sm mt-1">Vá para Configuração e conecte sua conta para ver métricas.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Profile header */}
      {profile && (
        <Card className="border-purple-500/20 bg-gradient-to-r from-purple-500/5 via-pink-500/5 to-transparent">
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <Avatar className="h-16 w-16 ring-2 ring-purple-500/20">
                <AvatarImage src={profile.profile_picture_url} />
                <AvatarFallback className="bg-gradient-to-br from-purple-500 to-pink-500 text-white text-xl">
                  {profile.username?.[0]?.toUpperCase() || "?"}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold">@{profile.username}</h2>
                  <Badge className="bg-green-500/10 text-green-600 border-green-500/20 text-xs">Conectado</Badge>
                </div>
                {profile.name && <p className="text-sm text-muted-foreground">{profile.name}</p>}
                {profile.biography && <p className="text-xs text-muted-foreground mt-1 max-w-lg">{profile.biography}</p>}
              </div>
              <a href={`https://instagram.com/${profile.username}`} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors">
                <ExternalLink className="h-4 w-4" />
              </a>
            </div>
          </CardContent>
        </Card>
      )}

      {loading && !profile && (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-purple-500" />
          <span className="ml-2 text-muted-foreground">Carregando dados do Instagram...</span>
        </div>
      )}

      {/* Summary metrics */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <MetricCard title="Seguidores" value={formatNumber(profile?.followers_count)} icon={Users} loading={loading} />
        <MetricCard title="Seguindo" value={formatNumber(profile?.follows_count)} icon={Heart} loading={loading} />
        <MetricCard title="Posts" value={formatNumber(profile?.media_count)} icon={ImageIcon} loading={loading} />
        <MetricCard title="Engajamento Médio" value={avgEng} icon={Target} loading={loading} />
        <MetricCard title="Impressões 30d" value={insights?.impressions != null ? formatNumber(insights.impressions) : "—"} icon={Eye} loading={loading} />
        <MetricCard title="Alcance 30d" value={insights?.reach != null ? formatNumber(insights.reach) : "—"} icon={TrendingUp} loading={loading} />
      </div>

      {/* Content type breakdown + best post */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2"><BarChart3 className="h-4 w-4" /> Tipos de Conteúdo</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {[
                { label: "Imagens", count: typeCount.IMAGE, icon: ImageLucide, color: "bg-blue-500" },
                { label: "Vídeos/Reels", count: typeCount.VIDEO, icon: Play, color: "bg-red-500" },
                { label: "Carrossel", count: typeCount.CAROUSEL_ALBUM, icon: ImageIcon, color: "bg-purple-500" },
              ].map(t => {
                const pct = media.length > 0 ? (t.count / media.length * 100) : 0;
                return (
                  <div key={t.label} className="flex items-center gap-3">
                    <t.icon className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="flex-1">
                      <div className="flex justify-between text-xs mb-1">
                        <span>{t.label}</span>
                        <span className="font-medium">{t.count} ({pct.toFixed(0)}%)</span>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${t.color}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {bestPost && (
          <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setSelectedPost(bestPost)}>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2"><Zap className="h-4 w-4 text-yellow-500" /> Melhor Post</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-3">
                <div className="w-20 h-20 rounded-lg overflow-hidden bg-muted shrink-0">
                  <img
                    src={bestPost.media_type === "VIDEO" ? bestPost.thumbnail_url : bestPost.media_url}
                    alt="" className="w-full h-full object-cover"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{bestPost.caption?.substring(0, 100) || "Sem legenda"}</p>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="flex items-center gap-1"><Heart className="h-3.5 w-3.5 text-red-500" /> {formatNumber(bestPost.like_count)}</span>
                    <span className="flex items-center gap-1"><MessageSquare className="h-3.5 w-3.5 text-blue-500" /> {formatNumber(bestPost.comments_count)}</span>
                    <Badge variant="outline" className="text-[10px]">{calcEngagement(bestPost, followers)} eng.</Badge>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* AI Analysis */}
      <AiAnalysisSection data={data} user={user} />

      {/* Individual Posts Grid */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ImageIcon className="h-4 w-4" /> Posts Recentes — Métricas Individuais
          </CardTitle>
          <CardDescription>Clique em um post para ver detalhes e comentários</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-64 rounded-lg" />)}
            </div>
          ) : media.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
              <Instagram className="h-10 w-10 opacity-20 mb-3" />
              <p className="text-sm">Nenhum post encontrado</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {media.map((post: any) => {
                const eng = calcEngagement(post, followers);
                return (
                  <div
                    key={post.id}
                    onClick={() => setSelectedPost(post)}
                    className="group rounded-xl border bg-card overflow-hidden cursor-pointer hover:shadow-lg hover:border-purple-500/30 transition-all"
                  >
                    <div className="relative aspect-square bg-muted">
                      <img
                        src={post.media_type === "VIDEO" ? post.thumbnail_url : post.media_url}
                        alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        loading="lazy"
                      />
                      {post.media_type === "VIDEO" && (
                        <div className="absolute top-2 left-2">
                          <Badge className="text-[10px] bg-black/60 text-white border-0 gap-1"><Play className="h-2.5 w-2.5" /> Vídeo</Badge>
                        </div>
                      )}
                      {post.media_type === "CAROUSEL_ALBUM" && (
                        <div className="absolute top-2 left-2">
                          <Badge className="text-[10px] bg-black/60 text-white border-0 gap-1"><ImageIcon className="h-2.5 w-2.5" /> Carrossel</Badge>
                        </div>
                      )}
                      <div className="absolute top-2 right-2">
                        <Badge className="text-[10px] bg-black/60 text-white border-0">
                          <Clock className="h-2.5 w-2.5 mr-1" />
                          {post.timestamp ? timeAgo(post.timestamp) : "—"}
                        </Badge>
                      </div>
                    </div>
                    <div className="p-3 space-y-2">
                      {post.caption && (
                        <p className="text-xs text-muted-foreground line-clamp-2">{post.caption.substring(0, 100)}</p>
                      )}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3 text-xs">
                          <span className="flex items-center gap-1 text-red-500"><Heart className="h-3 w-3" /> {formatNumber(post.like_count)}</span>
                          <span className="flex items-center gap-1 text-blue-500"><MessageSquare className="h-3 w-3" /> {formatNumber(post.comments_count)}</span>
                        </div>
                        <Badge variant="outline" className="text-[10px] font-medium">
                          <Target className="h-2.5 w-2.5 mr-1" /> {eng}
                        </Badge>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Post Detail Modal */}
      <PostDetailModal post={selectedPost} open={!!selectedPost} onClose={() => setSelectedPost(null)} followers={followers} />
    </div>
  );
}
