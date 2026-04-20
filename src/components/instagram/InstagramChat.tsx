import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Search, Send, Instagram, MessageSquare, RefreshCw, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Conversation {
  id: string;
  participant_id: string;
  participant_username: string | null;
  participant_name: string | null;
  participant_avatar_url: string | null;
  last_message_text: string | null;
  last_message_at: string | null;
  unread_count: number;
}

interface Message {
  id: string;
  conversation_id: string;
  direction: "inbound" | "outbound";
  text: string | null;
  created_at: string;
}

async function callApi(action: string, body?: any) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Não autenticado");
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  const res = await fetch(
    `https://${projectId}.supabase.co/functions/v1/instagram-messages?action=${action}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body || {}),
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "Erro");
  return data;
}

function formatTime(ts: string | null) {
  if (!ts) return "";
  const d = new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export function InstagramChat() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const scrollEndRef = useRef<HTMLDivElement>(null);

  // Conversations
  const convQuery = useQuery({
    queryKey: ["ig-conversations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("instagram_conversations")
        .select("*")
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(100);
      if (error) throw error;
      return data as Conversation[];
    },
  });

  // Initial sync moved below to capture capability warnings

  // Realtime updates for conversations
  useEffect(() => {
    const channel = supabase
      .channel("ig-conv-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "instagram_conversations" }, () => {
        qc.invalidateQueries({ queryKey: ["ig-conversations"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc]);

  // Messages for selected conversation
  const msgQuery = useQuery({
    queryKey: ["ig-messages", selectedId],
    queryFn: async () => {
      if (!selectedId) return [];
      // sync from Graph then fetch local
      await callApi("messages", { conversation_id: selectedId }).catch(() => {});
      const { data, error } = await supabase
        .from("instagram_messages")
        .select("*")
        .eq("conversation_id", selectedId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as Message[];
    },
    enabled: !!selectedId,
  });

  // Realtime for messages
  useEffect(() => {
    if (!selectedId) return;
    const channel = supabase
      .channel(`ig-msg-${selectedId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "instagram_messages", filter: `conversation_id=eq.${selectedId}` },
        () => qc.invalidateQueries({ queryKey: ["ig-messages", selectedId] })
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [selectedId, qc]);

  // Mark read on selection
  useEffect(() => {
    if (!selectedId) return;
    callApi("mark_read", { conversation_id: selectedId }).catch(() => {});
  }, [selectedId]);

  // Auto scroll
  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgQuery.data]);

  const sendMutation = useMutation({
    mutationFn: (text: string) => callApi("send", { conversation_id: selectedId, text }),
    onSuccess: () => {
      setDraft("");
      qc.invalidateQueries({ queryKey: ["ig-messages", selectedId] });
      qc.invalidateQueries({ queryKey: ["ig-conversations"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [syncWarning, setSyncWarning] = useState<string | null>(null);

  const syncMutation = useMutation({
    mutationFn: () => callApi("sync"),
    onSuccess: (d: any) => {
      if (d?.ok === false) {
        setSyncWarning(d.message || "Falha ao sincronizar");
        if (d?.token_invalid || d?.disconnected) {
          toast.error("Conta desconectada", { description: d.message, duration: 10000 });
        } else {
          toast.warning("Permissão do Meta App pendente", { description: d.message, duration: 8000 });
        }
      } else {
        setSyncWarning(null);
        toast.success(`${d?.upserted ?? 0} conversas sincronizadas`);
        qc.invalidateQueries({ queryKey: ["ig-conversations"] });
      }
    },
    onError: (e: Error) => {
      setSyncWarning(e.message);
      toast.error(e.message);
    },
  });

  // Capture sync warning from initial mount sync
  useEffect(() => {
    callApi("sync")
      .then((d: any) => {
        if (d?.ok === false) setSyncWarning(d.message);
      })
      .catch((e: Error) => setSyncWarning(e.message));
  }, []);

  const filtered = (convQuery.data || []).filter((c) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (c.participant_username || "").toLowerCase().includes(q) ||
      (c.participant_name || "").toLowerCase().includes(q) ||
      (c.last_message_text || "").toLowerCase().includes(q)
    );
  });

  const selected = filtered.find((c) => c.id === selectedId) || convQuery.data?.find((c) => c.id === selectedId);

  return (
    <div className="flex h-full">
      {/* Sidebar conversas */}
      <div className="w-80 border-r border-border/50 flex flex-col bg-card min-h-0">
        <div className="p-3 border-b border-border/50 flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar conversa..."
              className="pl-9 h-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="h-9 w-9"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
            title="Sincronizar"
          >
            {syncMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          </Button>
        </div>
        <ScrollArea className="flex-1">
          {convQuery.isLoading && (
            <div className="p-3 space-y-2">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          )}
          {!convQuery.isLoading && filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground px-4 text-center">
              <Instagram className="h-10 w-10 mb-3 opacity-40" />
              <p className="text-sm font-medium">Nenhuma conversa</p>
              <p className="text-xs mt-1">
                Quando alguém te enviar uma DM no Instagram, ela aparecerá aqui automaticamente
              </p>
              {syncWarning && (
                <div className="mt-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-left">
                  <p className="text-[11px] text-amber-600 dark:text-amber-400 leading-relaxed">
                    ⚠️ {syncWarning}
                  </p>
                </div>
              )}
            </div>
          )}
          {filtered.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedId(c.id)}
              className={cn(
                "w-full text-left p-3 border-b border-border/30 hover:bg-accent/40 transition-colors",
                selectedId === c.id && "bg-accent"
              )}
            >
              <div className="flex items-center gap-3">
                <div className="relative shrink-0">
                  {c.participant_avatar_url ? (
                    <img
                      src={c.participant_avatar_url}
                      alt=""
                      className="w-10 h-10 rounded-full object-cover"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 text-white flex items-center justify-center text-sm font-semibold">
                      {(c.participant_username || c.participant_name || "?")[0].toUpperCase()}
                    </div>
                  )}
                  {c.unread_count > 0 && (
                    <Badge className="absolute -top-1 -right-1 h-4 min-w-4 px-1 text-[10px] bg-pink-500 hover:bg-pink-500">
                      {c.unread_count}
                    </Badge>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium text-sm truncate">
                      @{c.participant_username || c.participant_name || c.participant_id}
                    </p>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {formatTime(c.last_message_at)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {c.last_message_text || "(sem mensagens)"}
                  </p>
                </div>
              </div>
            </button>
          ))}
        </ScrollArea>
      </div>

      {/* Chat */}
      <div className="flex-1 flex flex-col min-h-0">
        {!selected ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <MessageSquare className="h-16 w-16 mx-auto mb-4 opacity-20" />
              <p className="text-lg font-medium">Selecione uma conversa</p>
              <p className="text-sm mt-1">As DMs do Instagram aparecem aqui em tempo real</p>
            </div>
          </div>
        ) : (
          <>
            <div className="px-5 py-3 border-b border-border/50 flex items-center gap-3">
              {selected.participant_avatar_url ? (
                <img src={selected.participant_avatar_url} alt="" className="w-9 h-9 rounded-full object-cover" />
              ) : (
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 text-white flex items-center justify-center text-xs font-semibold">
                  {(selected.participant_username || selected.participant_name || "?")[0].toUpperCase()}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm">@{selected.participant_username || selected.participant_name}</p>
                <p className="text-xs text-muted-foreground">Instagram Direct</p>
              </div>
            </div>

            <ScrollArea className="flex-1 px-5 py-4">
              <div className="space-y-2 max-w-2xl mx-auto">
                {msgQuery.isLoading && (
                  <>
                    <Skeleton className="h-12 w-2/3" />
                    <Skeleton className="h-12 w-1/2 ml-auto" />
                  </>
                )}
                {msgQuery.data?.map((m) => (
                  <div
                    key={m.id}
                    className={cn(
                      "max-w-[75%] px-3 py-2 rounded-2xl text-sm",
                      m.direction === "outbound"
                        ? "ml-auto bg-gradient-to-br from-pink-500 to-purple-500 text-white rounded-br-sm"
                        : "bg-muted rounded-bl-sm"
                    )}
                  >
                    <p className="whitespace-pre-wrap break-words">{m.text}</p>
                    <p className={cn(
                      "text-[10px] mt-1",
                      m.direction === "outbound" ? "text-white/70" : "text-muted-foreground"
                    )}>
                      {formatTime(m.created_at)}
                    </p>
                  </div>
                ))}
                {msgQuery.data?.length === 0 && !msgQuery.isLoading && (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    Nenhuma mensagem ainda. Envie a primeira!
                  </p>
                )}
                <div ref={scrollEndRef} />
              </div>
            </ScrollArea>

            <div className="border-t border-border/50 p-3 flex gap-2">
              <Input
                placeholder="Digite uma mensagem..."
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && draft.trim() && !sendMutation.isPending) {
                    sendMutation.mutate(draft.trim());
                  }
                }}
                className="flex-1"
                disabled={sendMutation.isPending}
              />
              <Button
                size="icon"
                onClick={() => draft.trim() && sendMutation.mutate(draft.trim())}
                disabled={!draft.trim() || sendMutation.isPending}
                className="bg-gradient-to-br from-pink-500 to-purple-500 hover:opacity-90"
              >
                {sendMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
