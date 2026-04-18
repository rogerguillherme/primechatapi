import { useState, useCallback, useRef, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import ReactMarkdown from "react-markdown";
import {
  Users, Heart, MessageSquare, Eye, TrendingUp, Instagram,
  ImageIcon, ExternalLink, Loader2, Sparkles, RefreshCw,
  Target, Zap, Play, Image as ImageLucide,
  Clock, CalendarDays, Share2, ChevronRight, Crown,
} from "lucide-react";

import { ProfileScore } from "./premium/ProfileScore";
import { Opportunities, buildOpportunities } from "./premium/Opportunities";
import { InstagramFunnel } from "./premium/InstagramFunnel";
import { PostingCalendar } from "./premium/PostingCalendar";
import { PremiumCTA } from "./premium/PremiumCTA";
import { MetricStat } from "./premium/MetricStat";

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
          <div className="aspect-square rounded-lg overflow-hidden bg-muted">
            <img src={post.media_type === "VIDEO" ? post.thumbnail_url : post.media_url} alt="" className="w-full h-full object-cover" />
          </div>
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

// ─── AI Diagnosis Section ───
function AiDiagnosis({ data }: { data: any }) {
  const [aiText, setAiText] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiDone, setAiDone] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const runAiAnalysis = useCallback(async () => {
    if (!data) return;
    setAiText(""); setAiLoading(true); setAiDone(false);
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
            if (content) { accumulated += content; setAiText(accumulated); }
          } catch { buffer = line + "\n" + buffer; break; }
        }
      }
    } catch (e: any) {
      if (e.name !== "AbortError") setAiText(prev => prev + `\n\n❌ Erro: ${e.message}`);
    } finally { setAiLoading(false); setAiDone(true); abortRef.current = null; }
  }, [data]);

  return (
    <div className="rounded-2xl border border-purple-500/20 bg-gradient-to-br from-purple-950/20 via-card to-card p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-purple-500/20">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <div>
            <h3 className="text-sm font-display font-bold flex items-center gap-2">
              Diagnóstico IA Prime
              <Badge className="bg-gradient-to-r from-purple-500/20 to-pink-500/20 text-purple-300 border-purple-500/30 text-[9px] px-1.5">PREMIUM</Badge>
            </h3>
            <p className="text-xs text-muted-foreground">Especialista virtual analisa seu perfil e entrega um plano de ação</p>
          </div>
        </div>
        <Button
          size="sm" onClick={runAiAnalysis} disabled={aiLoading || !data}
          className="gap-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 shadow-md"
        >
          {aiLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : aiDone ? <RefreshCw className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
          {aiLoading ? "Analisando..." : aiDone ? "Atualizar diagnóstico" : "Gerar diagnóstico"}
        </Button>
      </div>
      {!aiText && !aiLoading && (
        <div className="flex flex-col items-center justify-center py-10 text-muted-foreground border-2 border-dashed border-border rounded-xl">
          <Sparkles className="h-10 w-10 opacity-20 mb-3" />
          <p className="text-sm">Gere um diagnóstico completo do seu perfil</p>
          <p className="text-xs mt-1 opacity-70">Pontos fortes • Fraquezas • Oportunidades • Plano 30 dias</p>
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
    </div>
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

  const totalEng = media.reduce((acc: number, p: any) => acc + (p.like_count || 0) + (p.comments_count || 0), 0);
  const avgEngNumber = media.length > 0 && followers > 0 ? (totalEng / media.length / followers * 100) : 0;
  const avgEng = avgEngNumber > 0 ? avgEngNumber.toFixed(2) + "%" : "—";

  const bestPost = media.length > 0
    ? media.reduce((best: any, p: any) => ((p.like_count || 0) + (p.comments_count || 0)) > ((best.like_count || 0) + (best.comments_count || 0)) ? p : best, media[0])
    : null;

  const hasReels = media.some((p: any) => p.media_type === "VIDEO");
  const totalComments = media.reduce((a: number, p: any) => a + (p.comments_count || 0), 0);

  const opportunities = useMemo(() => buildOpportunities({
    avgEngagement: avgEngNumber,
    followers,
    postsCount: profile?.media_count || 0,
    bioLength: profile?.biography?.length || 0,
    hasInsights: !!insights,
    hasReels,
  }), [avgEngNumber, followers, profile, insights, hasReels]);

  const handleUpgrade = () => {
    // TODO: redirect to checkout / pricing page
    window.alert("Em breve: checkout do plano Pro 🚀");
  };

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
      {/* ─── Header / Profile bar ─── */}
      {profile ? (
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Avatar className="h-14 w-14 ring-2 ring-purple-500/30 ring-offset-2 ring-offset-background">
              <AvatarImage src={profile.profile_picture_url} />
              <AvatarFallback className="bg-gradient-to-br from-purple-500 to-pink-500 text-white text-lg font-bold">
                {profile.username?.[0]?.toUpperCase() || "?"}
              </AvatarFallback>
            </Avatar>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-display text-2xl font-bold tracking-tight">@{profile.username}</h1>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /> Conectado
                </span>
              </div>
              <p className="text-sm text-muted-foreground">{profile.name || "—"} · {formatNumber(profile.followers_count)} seguidores</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a href={`https://instagram.com/${profile.username}`} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="sm" className="gap-1.5"><ExternalLink className="h-3.5 w-3.5" /> Ver perfil</Button>
            </a>
            <Button size="sm" onClick={handleUpgrade} className="gap-1.5 bg-gradient-to-r from-purple-600 to-pink-600 hover:opacity-90 shadow-md">
              <Crown className="h-3.5 w-3.5" /> Upgrade Pro
            </Button>
          </div>
        </div>
      ) : loading ? (
        <Skeleton className="h-16 w-full" />
      ) : null}

      {/* ─── Hero: Score + Quick stats ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <ProfileScore
            followers={followers}
            avgEngagement={avgEngNumber}
            postsCount={profile?.media_count || 0}
            hasInsights={!!insights}
            bioLength={profile?.biography?.length || 0}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <MetricStat label="Seguidores" value={formatNumber(profile?.followers_count)} icon={Users} accent="purple" loading={loading} hint="vs semana passada" />
          <MetricStat label="Engajamento" value={avgEng} icon={Target} accent="pink" loading={loading} delta={avgEngNumber >= 3 ? 12 : -4} />
          <MetricStat label="Alcance 30d" value={insights?.reach != null ? formatNumber(insights.reach) : "—"} icon={TrendingUp} accent="emerald" loading={loading} />
          <MetricStat label="Impressões 30d" value={insights?.impressions != null ? formatNumber(insights.impressions) : "—"} icon={Eye} accent="sky" loading={loading} />
        </div>
      </div>

      {/* ─── Diagnosis + Opportunities ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <AiDiagnosis data={data} />
        </div>
        <Opportunities opportunities={opportunities} onUpgrade={handleUpgrade} />
      </div>

      {/* ─── Funnel + Calendar ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <InstagramFunnel
          reach={insights?.reach || followers * 2}
          engagement={totalEng}
          comments={totalComments}
          dms={0}
          conversions={0}
        />
        <PostingCalendar isPremium={false} onUpgrade={handleUpgrade} />
      </div>

      {/* ─── Best post showcase ─── */}
      {bestPost && (
        <div className="rounded-2xl border border-amber-500/20 bg-gradient-to-r from-amber-950/20 via-card to-card p-5">
          <div className="flex items-center gap-2 mb-3">
            <Zap className="h-4 w-4 text-amber-400" />
            <h3 className="text-sm font-display font-bold">Conteúdo que mais converteu</h3>
            <span className="text-[10px] text-muted-foreground">Use como template para os próximos</span>
          </div>
          <button onClick={() => setSelectedPost(bestPost)} className="group flex gap-4 w-full text-left rounded-xl p-3 -m-3 hover:bg-muted/30 transition-colors">
            <div className="w-24 h-24 rounded-xl overflow-hidden bg-muted shrink-0 ring-1 ring-border">
              <img src={bestPost.media_type === "VIDEO" ? bestPost.thumbnail_url : bestPost.media_url} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-foreground line-clamp-2 mb-2">{bestPost.caption?.substring(0, 140) || "Sem legenda"}</p>
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <span className="flex items-center gap-1 text-rose-400"><Heart className="h-3.5 w-3.5" /> {formatNumber(bestPost.like_count)}</span>
                <span className="flex items-center gap-1 text-sky-400"><MessageSquare className="h-3.5 w-3.5" /> {formatNumber(bestPost.comments_count)}</span>
                <Badge variant="outline" className="text-[10px]">{calcEngagement(bestPost, followers)} engajamento</Badge>
                <span className="ml-auto inline-flex items-center gap-1 text-xs text-purple-400 font-semibold">Ver análise <ChevronRight className="h-3 w-3" /></span>
              </div>
            </div>
          </button>
        </div>
      )}

      {/* ─── Posts grid ─── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <ImageIcon className="h-4 w-4" /> Últimos posts
              </CardTitle>
              <CardDescription>Clique para ver métricas e comentários</CardDescription>
            </div>
            <Badge variant="outline" className="text-xs">{media.length} posts</Badge>
          </div>
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
                    className="group rounded-xl border bg-card overflow-hidden cursor-pointer hover:shadow-card-hover hover:border-purple-500/30 transition-all"
                  >
                    <div className="relative aspect-square bg-muted">
                      <img src={post.media_type === "VIDEO" ? post.thumbnail_url : post.media_url} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy" />
                      {post.media_type === "VIDEO" && (
                        <div className="absolute top-2 left-2"><Badge className="text-[10px] bg-black/60 text-white border-0 gap-1"><Play className="h-2.5 w-2.5" /> Vídeo</Badge></div>
                      )}
                      {post.media_type === "CAROUSEL_ALBUM" && (
                        <div className="absolute top-2 left-2"><Badge className="text-[10px] bg-black/60 text-white border-0 gap-1"><ImageIcon className="h-2.5 w-2.5" /> Carrossel</Badge></div>
                      )}
                      <div className="absolute top-2 right-2"><Badge className="text-[10px] bg-black/60 text-white border-0"><Clock className="h-2.5 w-2.5 mr-1" />{post.timestamp ? timeAgo(post.timestamp) : "—"}</Badge></div>
                    </div>
                    <div className="p-3 space-y-2">
                      {post.caption && <p className="text-xs text-muted-foreground line-clamp-2">{post.caption.substring(0, 100)}</p>}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3 text-xs">
                          <span className="flex items-center gap-1 text-rose-400"><Heart className="h-3 w-3" /> {formatNumber(post.like_count)}</span>
                          <span className="flex items-center gap-1 text-sky-400"><MessageSquare className="h-3 w-3" /> {formatNumber(post.comments_count)}</span>
                        </div>
                        <Badge variant="outline" className="text-[10px] font-medium"><Target className="h-2.5 w-2.5 mr-1" /> {eng}</Badge>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Premium upgrade CTA ─── */}
      <PremiumCTA onUpgrade={handleUpgrade} />

      <PostDetailModal post={selectedPost} open={!!selectedPost} onClose={() => setSelectedPost(null)} followers={followers} />
    </div>
  );
}
