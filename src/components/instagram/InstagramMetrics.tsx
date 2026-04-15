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
import ReactMarkdown from "react-markdown";
import {
  Users, Heart, MessageSquare, Eye, TrendingUp, Instagram,
  ImageIcon, ExternalLink, Loader2, Sparkles, RefreshCw,
} from "lucide-react";

function MetricCard({ title, value, icon: Icon, loading }: {
  title: string; value: string; icon: any; loading?: boolean;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            {loading ? <Skeleton className="h-8 w-20 mt-1" /> : <p className="text-2xl font-bold mt-1">{value}</p>}
          </div>
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500/10 to-pink-500/10 flex items-center justify-center">
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

const AI_ANALYSIS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/instagram-ai-analysis`;

export function InstagramMetrics() {
  const { user } = useAuth();
  const [aiText, setAiText] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiDone, setAiDone] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

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
  const media = data?.media || [];
  const insights = data?.insights;
  const loading = isLoading;

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
              <Avatar className="h-16 w-16">
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
                {profile.biography && <p className="text-xs text-muted-foreground mt-1 max-w-md">{profile.biography}</p>}
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

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard title="Seguidores" value={formatNumber(profile?.followers_count)} icon={Users} loading={loading} />
        <MetricCard title="Seguindo" value={formatNumber(profile?.follows_count)} icon={Heart} loading={loading} />
        <MetricCard title="Publicações" value={formatNumber(profile?.media_count)} icon={ImageIcon} loading={loading} />
        <MetricCard title="Impressões (30d)" value={insights?.impressions != null ? formatNumber(insights.impressions) : "—"} icon={Eye} loading={loading} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <MetricCard title="Alcance (30d)" value={insights?.reach != null ? formatNumber(insights.reach) : "—"} icon={TrendingUp} loading={loading} />
        <MetricCard title="Visitas ao perfil (30d)" value={insights?.profile_views != null ? formatNumber(insights.profile_views) : "—"} icon={Users} loading={loading} />
      </div>

      {/* AI Analysis Card */}
      <Card className="border-purple-500/30 bg-gradient-to-br from-purple-500/5 to-pink-500/5">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-purple-500" />
              <CardTitle className="text-base">Análise Inteligente com IA</CardTitle>
            </div>
            <Button
              size="sm"
              onClick={runAiAnalysis}
              disabled={aiLoading || !data}
              className="gap-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
            >
              {aiLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : aiDone ? (
                <RefreshCw className="h-4 w-4" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {aiLoading ? "Analisando..." : aiDone ? "Analisar novamente" : "Analisar perfil"}
            </Button>
          </div>
          <CardDescription>
            IA analisa seu perfil, melhores posts, tipo de conteúdo e dá recomendações estratégicas
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!aiText && !aiLoading && (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
              <Sparkles className="h-10 w-10 opacity-20 mb-3" />
              <p className="text-sm">Clique em "Analisar perfil" para obter insights da IA</p>
              <p className="text-xs mt-1">A análise inclui tipo de perfil, melhores posts, padrões e recomendações</p>
            </div>
          )}
          {(aiText || aiLoading) && (
            <ScrollArea className="max-h-[500px]">
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown>{aiText || "Analisando seus dados..."}</ReactMarkdown>
                {aiLoading && (
                  <span className="inline-block w-2 h-4 bg-purple-500 animate-pulse ml-1 rounded" />
                )}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Recent media */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ImageIcon className="h-4 w-4" /> Posts Recentes
          </CardTitle>
          <CardDescription>Desempenho dos últimos posts</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {[...Array(8)].map((_, i) => <Skeleton key={i} className="aspect-square rounded-lg" />)}
            </div>
          ) : media.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
              <Instagram className="h-10 w-10 opacity-20 mb-3" />
              <p className="text-sm">Nenhum post encontrado</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {media.map((post: any) => (
                <a key={post.id} href={post.permalink} target="_blank" rel="noopener noreferrer" className="group relative aspect-square rounded-lg overflow-hidden bg-muted">
                  <img
                    src={post.media_type === "VIDEO" ? post.thumbnail_url : post.media_url}
                    alt={post.caption?.substring(0, 50) || "Post"}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-4 text-white text-sm">
                    <span className="flex items-center gap-1"><Heart className="h-4 w-4" /> {post.like_count ?? 0}</span>
                    <span className="flex items-center gap-1"><MessageSquare className="h-4 w-4" /> {post.comments_count ?? 0}</span>
                  </div>
                  {post.media_type === "VIDEO" && (
                    <Badge className="absolute top-2 left-2 text-[10px] bg-black/60 text-white border-0">Vídeo</Badge>
                  )}
                </a>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
