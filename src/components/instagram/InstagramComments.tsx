import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  MessageCircle, Heart, Trash2, Send, EyeOff, Eye, Image as ImageIcon,
  RefreshCw, ExternalLink, Loader2, Filter,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type CommentFilter = "all" | "unreplied" | "unliked" | "pending";

interface MediaItem {
  id: string;
  caption?: string;
  media_type: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  timestamp: string;
  like_count?: number;
  comments_count?: number;
}

interface CommentItem {
  id: string;
  text: string;
  username: string;
  timestamp: string;
  like_count?: number;
  user?: { id: string; username: string; profile_picture_url?: string };
  replies?: { data: CommentItem[] } | CommentItem[];
}

async function callApi(action: string, opts: { method?: string; query?: Record<string, string>; body?: any } = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Não autenticado");
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  const params = new URLSearchParams({ action, ...(opts.query || {}) });
  const res = await fetch(
    `https://${projectId}.supabase.co/functions/v1/instagram-comments?${params}`,
    {
      method: opts.method || "GET",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "Erro");
  return data;
}

function formatDate(ts: string) {
  return new Date(ts).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

export function InstagramComments() {
  const qc = useQueryClient();
  const [selectedMedia, setSelectedMedia] = useState<MediaItem | null>(null);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [filter, setFilter] = useState<CommentFilter>("all");

  const mediaQuery = useQuery({
    queryKey: ["ig-comments-media"],
    queryFn: () => callApi("list").then((d) => d.media as MediaItem[]),
    refetchInterval: 60_000,
  });

  const connectionQuery = useQuery({
    queryKey: ["ig-connection-username"],
    queryFn: async () => {
      const { data } = await supabase
        .from("instagram_connections")
        .select("instagram_username")
        .eq("status", "connected")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return (data?.instagram_username || "").toLowerCase();
    },
  });

  const commentsQuery = useQuery({
    queryKey: ["ig-comments", selectedMedia?.id],
    queryFn: () =>
      callApi("list", { query: { media_id: selectedMedia!.id } }).then(
        (d) => d.comments as CommentItem[]
      ),
    enabled: !!selectedMedia,
    refetchInterval: 30_000,
  });

  const ownUsername = connectionQuery.data || "";
  const isReplied = (c: CommentItem) => {
    const replies = Array.isArray(c.replies) ? c.replies : c.replies?.data || [];
    return replies.some((r) => (r.username || "").toLowerCase() === ownUsername);
  };
  const isLiked = (c: CommentItem) => (c.like_count || 0) > 0;

  const filteredComments = (commentsQuery.data || []).filter((c) => {
    if (filter === "unreplied") return !isReplied(c);
    if (filter === "unliked") return !isLiked(c);
    if (filter === "pending") return !isReplied(c) && !isLiked(c);
    return true;
  });

  const counts = {
    all: commentsQuery.data?.length || 0,
    unreplied: (commentsQuery.data || []).filter((c) => !isReplied(c)).length,
    unliked: (commentsQuery.data || []).filter((c) => !isLiked(c)).length,
    pending: (commentsQuery.data || []).filter((c) => !isReplied(c) && !isLiked(c)).length,
  };

  const replyMutation = useMutation({
    mutationFn: (vars: { comment_id: string; message: string }) =>
      callApi("reply", { method: "POST", body: vars }),
    onSuccess: () => {
      toast.success("Resposta enviada");
      setReplyTo(null);
      setReplyText("");
      qc.invalidateQueries({ queryKey: ["ig-comments", selectedMedia?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const hideMutation = useMutation({
    mutationFn: (vars: { comment_id: string; hide: boolean }) =>
      callApi(vars.hide ? "hide" : "unhide", { method: "POST", body: { comment_id: vars.comment_id } }),
    onSuccess: (_d, v) => {
      toast.success(v.hide ? "Comentário ocultado" : "Comentário exibido");
      qc.invalidateQueries({ queryKey: ["ig-comments", selectedMedia?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (comment_id: string) =>
      callApi("delete", { method: "DELETE", query: { comment_id } }),
    onSuccess: () => {
      toast.success("Comentário excluído");
      qc.invalidateQueries({ queryKey: ["ig-comments", selectedMedia?.id] });
      qc.invalidateQueries({ queryKey: ["ig-comments-media"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });




  const totalComments = mediaQuery.data?.reduce((s, m) => s + (m.comments_count || 0), 0) || 0;
  const totalLikes = mediaQuery.data?.reduce((s, m) => s + (m.like_count || 0), 0) || 0;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 pt-6 pb-4 border-b border-border/50">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-2xl font-display font-bold">Comentários</h1>
            <p className="text-sm text-muted-foreground">
              Responda, oculte e modere comentários dos seus posts
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                qc.invalidateQueries({ queryKey: ["ig-comments-media"] });
                if (selectedMedia) qc.invalidateQueries({ queryKey: ["ig-comments", selectedMedia.id] });
              }}
              className="gap-2"
            >
              <RefreshCw size={14} /> Atualizar
            </Button>
          </div>
        </div>
        <div className="flex gap-3">
          <StatChip icon={<ImageIcon size={14} />} label="Posts" value={mediaQuery.data?.length ?? 0} />
          <StatChip icon={<MessageCircle size={14} />} label="Comentários" value={totalComments} />
          <StatChip icon={<Heart size={14} />} label="Curtidas" value={totalLikes} />
        </div>
      </div>

      {/* Body: posts | comments */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[340px_1fr] min-h-0">
        {/* Posts list */}
        <div className="border-r border-border/50 min-h-0 flex flex-col">
          <ScrollArea className="flex-1">
            <div className="p-3 space-y-2">
              {mediaQuery.isLoading && (
                <>
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-20 w-full" />
                </>
              )}
              {mediaQuery.data?.map((m) => {
                const thumb = m.thumbnail_url || m.media_url;
                const isActive = selectedMedia?.id === m.id;
                return (
                  <button
                    key={m.id}
                    onClick={() => setSelectedMedia(m)}
                    className={cn(
                      "w-full text-left flex gap-3 p-2 rounded-lg transition-colors border",
                      isActive
                        ? "bg-pink-500/10 border-pink-500/40"
                        : "border-transparent hover:bg-muted"
                    )}
                  >
                    <div className="w-14 h-14 rounded-md bg-muted overflow-hidden shrink-0 flex items-center justify-center">
                      {thumb ? (
                        <img src={thumb} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <ImageIcon size={18} className="text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-muted-foreground">{formatDate(m.timestamp)}</p>
                      <p className="text-sm line-clamp-2">{m.caption || "(sem legenda)"}</p>
                      <div className="flex gap-2 mt-1">
                        <Badge variant="secondary" className="h-5 text-[10px] gap-1">
                          <MessageCircle size={10} /> {m.comments_count || 0}
                        </Badge>
                        <Badge variant="secondary" className="h-5 text-[10px] gap-1">
                          <Heart size={10} /> {m.like_count || 0}
                        </Badge>
                      </div>
                    </div>
                  </button>
                );
              })}
              {mediaQuery.data?.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">
                  Nenhum post encontrado
                </p>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Comments panel */}
        <div className="min-h-0 flex flex-col">
          {!selectedMedia ? (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
              <MessageCircle size={48} className="mb-3 opacity-30" />
              <p className="text-sm">Selecione um post para ver os comentários</p>
            </div>
          ) : (
            <>
              <div className="px-5 py-3 border-b border-border/50 flex items-center gap-3">
                <div className="w-10 h-10 rounded-md bg-muted overflow-hidden shrink-0">
                  {(selectedMedia.thumbnail_url || selectedMedia.media_url) && (
                    <img
                      src={selectedMedia.thumbnail_url || selectedMedia.media_url}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm line-clamp-1">{selectedMedia.caption || "(sem legenda)"}</p>
                  <p className="text-xs text-muted-foreground">
                    {selectedMedia.comments_count || 0} comentários · {formatDate(selectedMedia.timestamp)}
                  </p>
                </div>
                {selectedMedia.permalink && (
                  <Button asChild variant="ghost" size="icon">
                    <a href={selectedMedia.permalink} target="_blank" rel="noreferrer">
                      <ExternalLink size={14} />
                    </a>
                  </Button>
                )}
              </div>

              <div className="px-5 py-2 border-b border-border/50">
                <Tabs value={filter} onValueChange={(v) => setFilter(v as CommentFilter)}>
                  <TabsList className="h-8">
                    <TabsTrigger value="all" className="text-xs gap-1">
                      Todos <Badge variant="secondary" className="h-4 px-1 text-[10px]">{counts.all}</Badge>
                    </TabsTrigger>
                    <TabsTrigger value="unreplied" className="text-xs gap-1">
                      Sem resposta <Badge variant="secondary" className="h-4 px-1 text-[10px]">{counts.unreplied}</Badge>
                    </TabsTrigger>
                    <TabsTrigger value="unliked" className="text-xs gap-1">
                      Sem curtida <Badge variant="secondary" className="h-4 px-1 text-[10px]">{counts.unliked}</Badge>
                    </TabsTrigger>
                    <TabsTrigger value="pending" className="text-xs gap-1">
                      <Filter size={10} /> Pendentes <Badge variant="secondary" className="h-4 px-1 text-[10px]">{counts.pending}</Badge>
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>

              <ScrollArea className="flex-1">
                <div className="p-5 space-y-3">
                  {commentsQuery.isLoading && (
                    <>
                      <Skeleton className="h-16 w-full" />
                      <Skeleton className="h-16 w-full" />
                    </>
                  )}
                  {filteredComments.map((c) => (
                    <CommentRow
                      key={c.id}
                      comment={c}
                      isOwnReplied={isReplied(c)}
                      replyTo={replyTo}
                      replyText={replyText}
                      onReplyOpen={(id) => {
                        setReplyTo(id);
                        setReplyText("");
                      }}
                      onReplyChange={setReplyText}
                      onReplySubmit={() =>
                        replyMutation.mutate({ comment_id: replyTo!, message: replyText })
                      }
                      onCancelReply={() => {
                        setReplyTo(null);
                        setReplyText("");
                      }}
                      onHide={(hide) => hideMutation.mutate({ comment_id: c.id, hide })}
                      onDelete={() => {
                        if (confirm("Excluir este comentário?")) deleteMutation.mutate(c.id);
                      }}
                      isReplying={replyMutation.isPending}
                    />
                  ))}
                  {!commentsQuery.isLoading && filteredComments.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-12">
                      {commentsQuery.data?.length === 0
                        ? "Nenhum comentário neste post"
                        : "Nenhum comentário neste filtro"}
                    </p>
                  )}
                </div>
              </ScrollArea>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StatChip({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/50 border border-border/50">
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold">{value.toLocaleString("pt-BR")}</span>
    </div>
  );
}

interface CommentRowProps {
  comment: CommentItem;
  isOwnReplied?: boolean;
  replyTo: string | null;
  replyText: string;
  onReplyOpen: (id: string) => void;
  onReplyChange: (v: string) => void;
  onReplySubmit: () => void;
  onCancelReply: () => void;
  onHide: (hide: boolean) => void;
  onDelete: () => void;
  isReplying: boolean;
}

function CommentRow({
  comment, isOwnReplied, replyTo, replyText, onReplyOpen, onReplyChange,
  onReplySubmit, onCancelReply, onHide, onDelete, isReplying,
}: CommentRowProps) {
  const replies = Array.isArray(comment.replies)
    ? comment.replies
    : comment.replies?.data || [];
  const isOpen = replyTo === comment.id;

  return (
    <Card className="border-border/60">
      <CardContent className="p-3 space-y-2">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-pink-500 to-purple-500 flex items-center justify-center text-white text-xs font-semibold shrink-0 overflow-hidden">
            {comment.user?.profile_picture_url ? (
              <img src={comment.user.profile_picture_url} alt="" className="w-full h-full object-cover" />
            ) : (
              comment.username?.[0]?.toUpperCase() || "?"
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold">@{comment.username}</span>
              <span className="text-xs text-muted-foreground">{formatDate(comment.timestamp)}</span>
              {(comment.like_count || 0) > 0 && (
                <Badge variant="secondary" className="h-5 text-[10px] gap-1">
                  <Heart size={10} /> {comment.like_count}
                </Badge>
              )}
              {isOwnReplied && (
                <Badge className="h-5 text-[10px] gap-1 bg-emerald-500/15 text-emerald-600 border border-emerald-500/30 hover:bg-emerald-500/15">
                  ✓ Respondido
                </Badge>
              )}
            </div>
            <p className="text-sm mt-1 break-words whitespace-pre-wrap">{comment.text}</p>
            <div className="flex items-center gap-1 mt-2">
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1" onClick={() => onReplyOpen(comment.id)}>
                <MessageCircle size={12} /> Responder
              </Button>
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1" onClick={() => onHide(true)}>
                <EyeOff size={12} /> Ocultar
              </Button>
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1" onClick={() => onHide(false)}>
                <Eye size={12} /> Exibir
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs gap-1 text-destructive hover:text-destructive"
                onClick={onDelete}
              >
                <Trash2 size={12} /> Excluir
              </Button>
            </div>
          </div>
        </div>

        {isOpen && (
          <div className="ml-12 flex gap-2">
            <Input
              autoFocus
              value={replyText}
              onChange={(e) => onReplyChange(e.target.value)}
              placeholder="Escreva uma resposta..."
              onKeyDown={(e) => {
                if (e.key === "Enter" && replyText.trim() && !isReplying) onReplySubmit();
                if (e.key === "Escape") onCancelReply();
              }}
            />
            <Button size="sm" onClick={onReplySubmit} disabled={!replyText.trim() || isReplying} className="gap-1">
              {isReplying ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              Enviar
            </Button>
            <Button size="sm" variant="ghost" onClick={onCancelReply}>Cancelar</Button>
          </div>
        )}

        {replies.length > 0 && (
          <div className="ml-12 mt-2 space-y-2 border-l-2 border-border/50 pl-3">
            {replies.map((r) => (
              <div key={r.id} className="text-sm">
                <span className="font-semibold">@{r.username}</span>{" "}
                <span className="text-xs text-muted-foreground">{formatDate(r.timestamp)}</span>
                <p className="break-words whitespace-pre-wrap">{r.text}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
