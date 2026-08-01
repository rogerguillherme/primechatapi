import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useUserTemplates } from "@/hooks/use-user-templates";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { ChatMediaBubble } from "@/components/ChatMediaBubble";
import { AudioRecorder } from "@/components/AudioRecorder";
import { useWhatsAppAccounts } from "@/hooks/use-whatsapp-accounts";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import {
  Search, Send, MessageSquare, FileText, Check, CheckCheck,
  MoreVertical, ArrowLeft, Paperclip, Clock, MessageCircleReply,
  ShoppingBag, RotateCcw, Tag, X, AlertCircle, Bot, Users, PowerOff, Megaphone,
} from "lucide-react";
import { BulkBroadcastDialog } from "@/components/BulkBroadcastDialog";
import { format, isToday, isYesterday, isSameDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";

type ChatTab = "aguardando_respostas" | "respondidas" | "erro";
type AiMode = "off" | "all" | "selected";

const CHAT_TABS: { value: ChatTab; label: string; icon: React.ReactNode }[] = [
  { value: "respondidas", label: "Respondidas", icon: <MessageCircleReply size={14} /> },
  { value: "aguardando_respostas", label: "Aguardando", icon: <Clock size={14} /> },
  { value: "erro", label: "Erro", icon: <AlertCircle size={14} /> },
];

function getAvatarColor(name: string) {
  const colors = ["bg-emerald-600", "bg-violet-600", "bg-amber-600", "bg-rose-600", "bg-cyan-600", "bg-indigo-600"];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function getInitials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

function formatDateSeparator(date: Date) {
  if (isToday(date)) return "HOJE";
  if (isYesterday(date)) return "ONTEM";
  return format(date, "dd/MM/yyyy", { locale: ptBR });
}

function StatusIcon({ status }: { status: string }) {
  if (status === "failed") return <AlertCircle size={14} className="text-destructive" aria-label="Falha no envio" />;
  if (status === "accepted" || status === "queued" || status === "processing") return <Clock size={14} className="opacity-60" aria-label="Aguardando confirmação da Meta" />;
  if (status === "read") return <CheckCheck size={14} className="text-sky-400" />;
  if (status === "delivered") return <CheckCheck size={14} className="opacity-60" />;
  return <Check size={14} className="opacity-60" />;
}

export function CloudChatTab() {
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [activeTab, setActiveTab] = useState<ChatTab>("aguardando_respostas");
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [filterAccountId, setFilterAccountId] = useState<string | null>(null);
  const [filterLabelIds, setFilterLabelIds] = useState<Set<string>>(new Set());
  const [showLabelFilter, setShowLabelFilter] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { accounts, defaultAccount } = useWhatsAppAccounts();
  const { templates } = useUserTemplates();

  useEffect(() => {
    if (!selectedAccountId && defaultAccount) setSelectedAccountId(defaultAccount.id);
  }, [defaultAccount, selectedAccountId]);

  // Auto backfill profile photos for leads (once per account per session)
  useEffect(() => {
    if (!selectedAccountId) return;
    const key = `photos-backfilled-${selectedAccountId}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
    supabase.functions
      .invoke("evolution-backfill-photos", { body: { account_id: selectedAccountId, limit: 200 } })
      .then(({ data }: any) => {
        if (data?.updated > 0) {
          queryClient.invalidateQueries({ queryKey: ["chat-leads"] });
        }
      })
      .catch(() => {});
  }, [selectedAccountId, queryClient]);

  // Fetch labels
  const { data: labels = [] } = useQuery({
    queryKey: ["chat-labels"],
    queryFn: async () => {
      const { data } = await supabase.from("chat_labels").select("*").order("name");
      return data || [];
    },
  });

  // Fetch lead-label mapping
  const { data: leadLabelsMap } = useQuery({
    queryKey: ["lead-labels-map"],
    queryFn: async () => {
      const { data } = await supabase.from("lead_labels").select("lead_id, label_id");
      const map = new Map<string, Set<string>>();
      for (const ll of data || []) {
        if (!map.has(ll.lead_id)) map.set(ll.lead_id, new Set());
        map.get(ll.lead_id)!.add(ll.label_id);
      }
      return map;
    },
  });

  // Fetch leads (already carries the denormalized last-message summary)
  const { data: leads } = useQuery({
    queryKey: ["chat-leads"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("leads")
        .select(
          "id, name, phone, email, photo_url, chat_status, ai_enabled, updated_at, last_message_content, last_message_at, last_message_direction, last_message_status, last_message_account_id, account_ids"
        )
        .order("updated_at", { ascending: false, nullsFirst: false })
        .limit(5000);
      return (data || []) as any[];
    },
    refetchInterval: 30000,
    staleTime: 15000,
  });

  const leadAccountMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const lead of leads || []) {
      for (const accId of lead.account_ids || []) {
        if (!map.has(accId)) map.set(accId, new Set());
        map.get(accId)!.add(lead.id);
      }
    }
    return map;
  }, [leads]);

  const latestMessages = useMemo(() => {
    const map = new Map<string, { content: string; created_at: string; direction: string; status: string | null }>();
    for (const lead of leads || []) {
      if (!lead.last_message_at) continue;
      map.set(lead.id, {
        content: lead.last_message_content || "",
        created_at: lead.last_message_at,
        direction: lead.last_message_direction || "outbound",
        status: lead.last_message_status,
      });
    }
    return map;
  }, [leads]);



  // A lead sits in "Erro" only while its most recent message is a failed outbound.
  // Once a new inbound message arrives (or a successful send happens), it moves out
  // to the tab defined by chat_status.
  const failedLeadIds = useMemo(() => {
    const set = new Set<string>();
    if (!latestMessages) return set;
    for (const [leadId, msg] of latestMessages) {
      if (msg.direction === "outbound" && msg.status === "failed") set.add(leadId);
    }
    return set;
  }, [latestMessages]);

  const { data: aiMode = "off" } = useQuery({
    queryKey: ["ai-auto-reply-mode"],
    queryFn: async () => {
      const { data } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "ai_auto_reply_mode")
        .maybeSingle();
      return (data?.value as AiMode | undefined) ?? "off";
    },
  });

  const setAiMode = useMutation({
    mutationFn: async (mode: AiMode) => {
      const { error } = await supabase
        .from("app_settings")
        .upsert(
          { key: "ai_auto_reply_mode", value: mode, updated_at: new Date().toISOString() },
          { onConflict: "key" }
        );
      if (error) throw error;
      return mode;
    },
    onSuccess: (mode) => {
      queryClient.setQueryData(["ai-auto-reply-mode"], mode);
      const label = mode === "all" ? "todas as conversas" : mode === "selected" ? "conversas selecionadas" : "desativado";
      toast.success(`Agente IA: ${label}`);
    },
    onError: () => toast.error("Erro ao atualizar agente IA"),
  });

  const toggleLeadAi = useMutation({
    mutationFn: async (next: boolean) => {
      if (!selectedLeadId) throw new Error("Nenhum contato selecionado");
      const { error } = await supabase
        .from("leads")
        .update({ ai_enabled: next })
        .eq("id", selectedLeadId);
      if (error) throw error;
      return next;
    },
    onSuccess: (next) => {
      queryClient.invalidateQueries({ queryKey: ["chat-leads"] });
      toast.success(next ? "Agente IA ativado nesta conversa" : "Agente IA desativado nesta conversa");
    },
    onError: () => toast.error("Erro ao atualizar agente IA"),
  });

  // Messages for selected lead
  const { data: messages } = useQuery({
    queryKey: ["chat-messages", selectedLeadId],
    queryFn: async () => {
      if (!selectedLeadId) return [];
      const { data } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("lead_id", selectedLeadId)
        .order("created_at", { ascending: true });
      return data || [];
    },
    enabled: !!selectedLeadId,
    refetchOnWindowFocus: true,
    refetchOnMount: "always",
  });

  // Keep a ref so the realtime callback always sees the latest selectedLeadId
  const selectedLeadIdRef = useRef(selectedLeadId);
  selectedLeadIdRef.current = selectedLeadId;

  // Realtime – global channel for sidebar (latest msgs / lead list)
  useEffect(() => {
    const channel = supabase
      .channel("cloud-chat-global-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_messages" }, () => {
        queryClient.invalidateQueries({ queryKey: ["chat-leads"] });
        queryClient.invalidateQueries({ queryKey: ["chat-leads"] });
        queryClient.invalidateQueries({ queryKey: ["chat-leads"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "leads" }, () => {
        queryClient.invalidateQueries({ queryKey: ["chat-leads"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  // Realtime – dedicated channel per selected lead, with optimistic cache merge
  // so new messages render IMMEDIATELY without waiting for a refetch or polling.
  useEffect(() => {
    if (!selectedLeadId) return;
    const leadId = selectedLeadId;
    const queryKey = ["chat-messages", leadId];

    const channel = supabase
      .channel(`cloud-chat-msgs-${leadId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages", filter: `lead_id=eq.${leadId}` },
        (payload) => {
          const newMsg = payload.new as any;
          queryClient.setQueryData<any[]>(queryKey, (prev) => {
            const list = prev || [];
            if (list.some((m) => m.id === newMsg.id)) return list;
            // Insert keeping ascending order by created_at
            const next = [...list, newMsg].sort(
              (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            );
            return next;
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "chat_messages", filter: `lead_id=eq.${leadId}` },
        (payload) => {
          const updated = payload.new as any;
          queryClient.setQueryData<any[]>(queryKey, (prev) =>
            (prev || []).map((m) => (m.id === updated.id ? { ...m, ...updated } : m))
          );
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "chat_messages", filter: `lead_id=eq.${leadId}` },
        (payload) => {
          const oldMsg = payload.old as any;
          queryClient.setQueryData<any[]>(queryKey, (prev) =>
            (prev || []).filter((m) => m.id !== oldMsg.id)
          );
        }
      )
      .subscribe((status) => {
        // Safety net: if subscription drops, fall back to a refetch on (re)connect
        if (status === "SUBSCRIBED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          queryClient.invalidateQueries({ queryKey });
        }
      });

    // Refetch immediately on lead switch / tab visibility regain
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        queryClient.invalidateQueries({ queryKey });
        queryClient.invalidateQueries({ queryKey: ["chat-leads"] });
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    // Slow safety polling (only when this lead is open) — covers rare realtime gaps
    const interval = setInterval(() => {
      queryClient.invalidateQueries({ queryKey });
    }, 10000);

    return () => {
      supabase.removeChannel(channel);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(interval);
    };
  }, [selectedLeadId, queryClient]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + "px";
    }
  }, [message]);

  const selectedLead = leads?.find((l) => l.id === selectedLeadId);
  const leadAiEnabled = !!selectedLead?.ai_enabled;

  const replyNowWithAi = useMutation({
    mutationFn: async () => {
      if (!selectedLead) throw new Error("Nenhum contato selecionado");
      // Find last inbound message
      const lastInbound = [...(messages || [])]
        .reverse()
        .find((m: any) => m.direction === "inbound");
      if (!lastInbound) throw new Error("Nenhuma mensagem do cliente para responder");
      const { data, error } = await supabase.functions.invoke("ai-auto-reply", {
        body: {
          lead_id: selectedLead.id,
          message: lastInbound.content,
          account_id: selectedAccountId || lastInbound.account_id || undefined,
        },
      });
      if (error) throw error;
      if ((data as any)?.skipped) throw new Error(`IA não respondeu: ${(data as any).skipped}`);
      return data;
    },
    onSuccess: () => {
      toast.success("Agente IA respondeu a última mensagem");
      if (selectedLeadId) {
        queryClient.invalidateQueries({ queryKey: ["chat-messages", selectedLeadId] });
      }
    },
    onError: (e: any) => toast.error(e?.message || "Erro ao gerar resposta da IA"),
  });

  const handleToggleCurrentLeadAi = async () => {
    if (!selectedLeadId) return;
    const willEnable = !leadAiEnabled;
    if (aiMode !== "selected") setAiMode.mutate("selected");
    await toggleLeadAi.mutateAsync(willEnable);
    // When activating, immediately respond to the last inbound message
    if (willEnable) {
      const hasInbound = (messages || []).some((m: any) => m.direction === "inbound");
      if (hasInbound) {
        replyNowWithAi.mutate();
      }
    }
  };

  const sendMutation = useMutation({
    mutationFn: async ({ text, mediaUrl, mediaType }: { text?: string; mediaUrl?: string; mediaType?: string }) => {
      if (!selectedLead) throw new Error("No lead selected");
      const { data, error } = await supabase.functions.invoke("whatsapp-cloud-send", {
        body: { phone: selectedLead.phone, message: text || "", lead_id: selectedLead.id, media_url: mediaUrl, media_type: mediaType, account_id: selectedAccountId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      setMessage("");
      queryClient.invalidateQueries({ queryKey: ["chat-messages", selectedLeadId] });
      queryClient.invalidateQueries({ queryKey: ["chat-leads"] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const uploadAndSendMedia = useCallback(async (file: File) => {
    if (!selectedLead) return;
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("lead_id", selectedLead.id);
      const { data, error } = await supabase.functions.invoke("chat-upload-media", { body: formData });
      if (error) throw error;
      sendMutation.mutate({ mediaUrl: data.url, mediaType: data.media_type });
    } catch (err: any) {
      toast.error(err.message);
    }
  }, [selectedLead, sendMutation]);

  const handleAudioRecorded = useCallback((blob: Blob) => {
    uploadAndSendMedia(new File([blob], "audio.webm", { type: "audio/webm" }));
  }, [uploadAndSendMedia]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadAndSendMedia(file);
    if (e.target) e.target.value = "";
  }, [uploadAndSendMedia]);

  const handleSend = () => {
    const text = message.trim();
    if (!text) return;
    sendMutation.mutate({ text });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const filteredLeads = useMemo(() => {
    if (!leads) return [];
    const s = search.toLowerCase();
    const seen = new Set<string>();
    return leads.filter((l) => {
      if (activeTab === "erro") {
        if (!failedLeadIds?.has(l.id)) return false;
      } else {
        // Exclude leads with failed messages from all other tabs — they live in "Erro"
        if (failedLeadIds?.has(l.id)) return false;
        if (l.chat_status !== activeTab) return false;
      }
      if (s && !l.name.toLowerCase().includes(s) && !l.phone.includes(s) && !l.email?.toLowerCase().includes(s)) return false;
      if (filterAccountId && !leadAccountMap?.get(filterAccountId)?.has(l.id)) return false;
      if (filterLabelIds.size > 0) {
        const leadLbls = leadLabelsMap?.get(l.id);
        if (!leadLbls) return false;
        for (const lid of filterLabelIds) {
          if (!leadLbls.has(lid)) return false;
        }
      }
      // Dedupe by phone (leads list is ordered by recency upstream)
      const key = (l.phone || "").replace(/\D/g, "") || l.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [leads, search, activeTab, filterAccountId, leadAccountMap, filterLabelIds, leadLabelsMap, failedLeadIds]);

  const tabCounts = useMemo(() => {
    if (!leads) return {} as Record<string, number>;
    const counts: Record<string, number> = {};
    const seenByTab: Record<string, Set<string>> = {};
    for (const l of leads) {
      const tab = failedLeadIds?.has(l.id) ? "erro" : l.chat_status;
      if (!tab) continue;
      const key = (l.phone || "").replace(/\D/g, "") || l.id;
      if (!seenByTab[tab]) seenByTab[tab] = new Set();
      if (seenByTab[tab].has(key)) continue;
      seenByTab[tab].add(key);
      counts[tab] = (counts[tab] || 0) + 1;
    }
    return counts;
  }, [leads, failedLeadIds]);

  const sortedLeads = useMemo(() => {
    return [...filteredLeads].sort((a, b) => {
      const ma = latestMessages?.get(a.id);
      const mb = latestMessages?.get(b.id);
      if (ma && mb) return new Date(mb.created_at).getTime() - new Date(ma.created_at).getTime();
      if (ma) return -1;
      if (mb) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [filteredLeads, latestMessages]);

  const groupedMessages = useMemo(() => {
    if (!messages) return [];
    const groups: { date: Date; messages: typeof messages }[] = [];
    for (const msg of messages) {
      const msgDate = new Date(msg.created_at);
      const last = groups[groups.length - 1];
      if (last && isSameDay(last.date, msgDate)) last.messages.push(msg);
      else groups.push({ date: msgDate, messages: [msg] });
    }
    return groups;
  }, [messages]);

  const formatSidebarTime = (dateStr: string) => {
    const d = new Date(dateStr);
    if (isToday(d)) return format(d, "HH:mm");
    if (isYesterday(d)) return "Ontem";
    return format(d, "dd/MM/yy");
  };

  const toggleLabelFilter = (labelId: string) => {
    setFilterLabelIds((prev) => {
      const next = new Set(prev);
      if (next.has(labelId)) next.delete(labelId);
      else next.add(labelId);
      return next;
    });
  };

  // Get labels for a specific lead
  const getLeadLabels = (leadId: string) => {
    const labelIds = leadLabelsMap?.get(leadId);
    if (!labelIds) return [];
    return labels.filter((l) => labelIds.has(l.id));
  };

  return (
    <div className="flex h-full border border-border rounded-lg overflow-hidden bg-background">
      {/* LEFT PANEL - Contact list */}
      <div className={cn(
        "w-[340px] flex flex-col border-r border-border",
        selectedLeadId ? "hidden lg:flex" : "flex flex-1 lg:flex-none lg:w-[340px]"
      )}>
        {/* Search */}
        <div className="p-3 border-b border-border space-y-2">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar contato..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9 text-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            {accounts.length > 1 && (
              <select
                value={filterAccountId || ""}
                onChange={(e) => setFilterAccountId(e.target.value || null)}
                className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs"
              >
                <option value="">Todos os números</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            )}
            {(() => {
              const evoAccount =
                accounts.find((a: any) => a.id === filterAccountId && a.provider === "evolution") ||
                accounts.find((a: any) => a.id === selectedAccountId && a.provider === "evolution") ||
                accounts.find((a: any) => a.provider === "evolution");
              if (!evoAccount) return null;
              return (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={() => setBulkOpen(true)}
                  title={`Disparo em massa para ${evoAccount.name}`}
                >
                  <Megaphone size={12} />
                  Disparo
                </Button>
              );
            })()}
            <Button
              variant={showLabelFilter ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => setShowLabelFilter(!showLabelFilter)}
            >
              <Tag size={12} />
              Tags
              {filterLabelIds.size > 0 && (
                <Badge variant="secondary" className="h-4 text-[9px] px-1 ml-0.5">{filterLabelIds.size}</Badge>
              )}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant={aiMode === "off" ? "outline" : "default"}
                  size="sm"
                  className="h-7 px-2 text-xs gap-1"
                  title="Configurar agente IA"
                >
                  <Bot size={12} />
                  IA
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Agente IA</div>
                <DropdownMenuItem onClick={() => setAiMode.mutate("off")} className={cn("gap-2", aiMode === "off" && "bg-accent")}>
                  <PowerOff size={14} />
                  <div className="flex-1">
                    <p className="text-sm">Desativado</p>
                    <p className="text-[11px] text-muted-foreground">Não responde nenhuma conversa</p>
                  </div>
                  {aiMode === "off" && <Check size={14} />}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setAiMode.mutate("all")} className={cn("gap-2", aiMode === "all" && "bg-accent")}>
                  <Users size={14} />
                  <div className="flex-1">
                    <p className="text-sm">Todas as conversas</p>
                    <p className="text-[11px] text-muted-foreground">Responde qualquer mensagem recebida</p>
                  </div>
                  {aiMode === "all" && <Check size={14} />}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setAiMode.mutate("selected")} className={cn("gap-2", aiMode === "selected" && "bg-accent")}>
                  <MessageSquare size={14} />
                  <div className="flex-1">
                    <p className="text-sm">Conversas selecionadas</p>
                    <p className="text-[11px] text-muted-foreground">Use o botão IA dentro do chat</p>
                  </div>
                  {aiMode === "selected" && <Check size={14} />}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Label filter chips */}
        {showLabelFilter && labels.length > 0 && (
          <div className="px-3 py-2 border-b border-border flex flex-wrap gap-1.5">
            {labels.map((label) => (
              <button
                key={label.id}
                onClick={() => toggleLabelFilter(label.id)}
                className={cn(
                  "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border transition-colors",
                  filterLabelIds.has(label.id)
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-accent"
                )}
              >
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: label.color }} />
                {label.name}
                {filterLabelIds.has(label.id) && <X size={10} />}
              </button>
            ))}
          </div>
        )}

        {/* Tabs */}
        <div className="px-2 py-2 border-b border-border">
          <div className="flex gap-1 overflow-x-auto scrollbar-none">
            {CHAT_TABS.map((tab) => {
              const isActive = activeTab === tab.value;
              const isErro = tab.value === "erro";
              return (
                <button
                  key={tab.value}
                  onClick={() => setActiveTab(tab.value)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors border",
                    isActive
                      ? isErro
                        ? "bg-destructive/10 text-destructive border-destructive/30"
                        : "bg-primary/10 text-primary border-primary/30"
                      : "text-muted-foreground border-transparent hover:bg-accent hover:text-foreground"
                  )}
                >
                  {tab.icon}
                  <span>{tab.label}</span>
                  {tabCounts[tab.value] ? (
                    <span className={cn(
                      "text-[10px] min-w-[18px] h-4 rounded-full flex items-center justify-center px-1 font-semibold",
                      isActive
                        ? isErro ? "bg-destructive text-destructive-foreground" : "bg-primary text-primary-foreground"
                        : "bg-muted text-foreground"
                    )}>
                      {tabCounts[tab.value]}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        {/* Contact list */}
        <ScrollArea className="flex-1">
          {sortedLeads.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">Nenhum contato encontrado.</p>
          )}
          {sortedLeads.map((lead) => {
            const latest = latestMessages?.get(lead.id);
            const isSelected = lead.id === selectedLeadId;
            const leadTags = getLeadLabels(lead.id);
            return (
              <button
                key={lead.id}
                onClick={() => setSelectedLeadId(lead.id)}
                className={cn(
                  "w-full text-left flex items-center gap-3 px-3 py-3 transition-colors border-b border-border/30",
                  isSelected ? "bg-accent" : "hover:bg-accent/40"
                )}
              >
                <Avatar className="w-10 h-10 flex-shrink-0">
                  {lead.photo_url && <AvatarImage src={lead.photo_url} alt={lead.name} />}
                  <AvatarFallback className={cn(getAvatarColor(lead.name), "text-white text-xs font-medium")}>
                    {getInitials(lead.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-sm truncate">{lead.name}</p>
                    {latest && (
                      <span className="text-[11px] text-muted-foreground ml-2 shrink-0">
                        {formatSidebarTime(latest.created_at)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 mt-0.5">
                    {latest?.direction === "outbound" && <CheckCheck size={12} className="text-sky-400 shrink-0" />}
                    <p className="text-xs text-muted-foreground truncate">
                      {latest ? latest.content : "Iniciar conversa"}
                    </p>
                  </div>
                  {leadTags.length > 0 && (
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {leadTags.slice(0, 3).map((tag) => (
                        <span
                          key={tag.id}
                          className="inline-flex items-center gap-0.5 px-1.5 py-0 rounded-full text-[9px] border border-border"
                        >
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: tag.color }} />
                          {tag.name}
                        </span>
                      ))}
                      {leadTags.length > 3 && (
                        <span className="text-[9px] text-muted-foreground">+{leadTags.length - 3}</span>
                      )}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </ScrollArea>
      </div>

      {/* RIGHT PANEL - Chat area */}
      <div className={cn("flex-1 flex flex-col min-w-0", !selectedLeadId ? "hidden lg:flex" : "flex")}>
        {selectedLead ? (
          <>
            {/* Header */}
            <div className="h-14 px-4 flex items-center gap-3 border-b border-border bg-card">
              <button onClick={() => setSelectedLeadId(null)} className="lg:hidden p-1 text-muted-foreground hover:text-foreground">
                <ArrowLeft size={18} />
              </button>
              <Avatar className="w-9 h-9">
                {selectedLead.photo_url && <AvatarImage src={selectedLead.photo_url} />}
                <AvatarFallback className={cn(getAvatarColor(selectedLead.name), "text-white text-xs")}>
                  {getInitials(selectedLead.name)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">{selectedLead.name}</p>
                <p className="text-[11px] text-muted-foreground">{selectedLead.phone}</p>
              </div>
              {accounts.length > 1 && (
                <select
                  value={selectedAccountId || ""}
                  onChange={(e) => setSelectedAccountId(e.target.value || null)}
                  className="h-7 rounded-md border border-input bg-background px-2 text-xs"
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              )}
              <Button
                type="button"
                size="sm"
                variant={aiMode === "all" || leadAiEnabled ? "default" : "outline"}
                className="h-8 px-2 text-xs gap-1.5 shrink-0"
                onClick={handleToggleCurrentLeadAi}
                disabled={toggleLeadAi.isPending || setAiMode.isPending}
                title={
                  aiMode === "all"
                    ? "Agente IA ativo globalmente — clique para usar apenas conversas selecionadas"
                    : leadAiEnabled
                    ? "Agente IA ativo nesta conversa — clique para desativar"
                    : "Ativar agente IA nesta conversa"
                }
              >
                <Bot size={14} />
                IA {aiMode === "all" || leadAiEnabled ? "ON" : "OFF"}
              </Button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 lg:px-8 py-4 bg-muted/20">
              <div className="max-w-3xl mx-auto space-y-1">
                {messages?.length === 0 && (
                  <div className="flex justify-center py-10">
                    <div className="bg-card rounded-lg px-6 py-3 shadow-sm">
                      <p className="text-sm text-muted-foreground">Nenhuma mensagem ainda. Envie a primeira! 💬</p>
                    </div>
                  </div>
                )}
                {groupedMessages.map((group, gi) => (
                  <div key={gi}>
                    <div className="flex justify-center my-3">
                      <span className="bg-card text-muted-foreground text-[11px] font-medium px-3 py-1 rounded-md shadow-sm uppercase tracking-wide">
                        {formatDateSeparator(group.date)}
                      </span>
                    </div>
                    {group.messages.map((msg, mi) => {
                      const isOutbound = msg.direction === "outbound";
                      const prevMsg = mi > 0 ? group.messages[mi - 1] : null;
                      const showTail = !prevMsg || prevMsg.direction !== msg.direction;
                      return (
                        <div key={msg.id} className={cn("flex mb-[2px]", isOutbound ? "justify-end" : "justify-start", showTail && "mt-2")}>
                          <div className={cn(
                            "relative max-w-[65%] px-[9px] pt-[6px] pb-2 text-sm leading-[19px] shadow-sm rounded-lg",
                            isOutbound ? "bg-primary/10 text-foreground" : "bg-card text-foreground",
                            showTail && isOutbound && "rounded-tr-none",
                            showTail && !isOutbound && "rounded-tl-none"
                          )}>
                            {msg.media_url && msg.media_type ? (
                              <div className="mb-1">
                                <ChatMediaBubble mediaType={msg.media_type} mediaUrl={msg.media_url} caption={msg.media_type !== "audio" ? msg.content : undefined} isOutbound={isOutbound} />
                                <span className="inline-block w-[60px]" />
                              </div>
                            ) : (
                              <p className="whitespace-pre-wrap break-words">
                                {msg.content}
                                <span className="inline-block w-[60px]" />
                              </p>
                            )}
                            <span className="absolute bottom-[5px] right-[7px] flex items-center gap-[2px] text-muted-foreground">
                              <span className="text-[11px]">{format(new Date(msg.created_at), "HH:mm")}</span>
                              {isOutbound && <StatusIcon status={msg.status} />}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>
            </div>

            {/* Input */}
            <div className="px-4 py-2 bg-card border-t border-border">
              <input ref={fileInputRef} type="file" accept="image/*,video/*,audio/*,.pdf,.doc,.docx" className="hidden" onChange={handleFileSelect} />
              <div className="flex items-end gap-2 max-w-3xl mx-auto">
                <div className="flex items-center gap-0.5 shrink-0 mb-[5px]">
                  {templates && templates.length > 0 && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="p-2 rounded-full hover:bg-accent text-muted-foreground hover:text-foreground"><FileText size={20} /></button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-72">
                        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground uppercase">Templates</div>
                        {templates.map((t) => (
                          <DropdownMenuItem key={t.id} onClick={() => setMessage(t.content)} className="flex flex-col items-start gap-0.5">
                            <span className="font-medium text-sm">{t.name}</span>
                            <span className="text-xs text-muted-foreground line-clamp-2">{t.content}</span>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                  <button onClick={() => fileInputRef.current?.click()} className="p-2 rounded-full hover:bg-accent text-muted-foreground hover:text-foreground">
                    <Paperclip size={20} />
                  </button>
                </div>
                <div className="flex-1 bg-background rounded-lg border border-border overflow-hidden">
                  <textarea
                    ref={textareaRef}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Digite uma mensagem"
                    className="w-full px-3 py-[9px] text-sm bg-transparent outline-none resize-none placeholder:text-muted-foreground max-h-[120px]"
                    rows={1}
                    style={{ minHeight: "38px" }}
                  />
                </div>
                {message.trim() ? (
                  <button onClick={handleSend} disabled={sendMutation.isPending} className="p-2.5 rounded-full shrink-0 mb-[3px] bg-primary text-primary-foreground hover:opacity-90">
                    <Send size={18} />
                  </button>
                ) : (
                  <AudioRecorder onRecorded={handleAudioRecorded} disabled={sendMutation.isPending} />
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center bg-muted/10">
            <MessageSquare size={48} className="text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">Selecione um contato para iniciar</p>
          </div>
        )}
      </div>

      {(() => {
        const evoAccount =
          accounts.find((a: any) => a.id === filterAccountId && a.provider === "evolution") ||
          accounts.find((a: any) => a.id === selectedAccountId && a.provider === "evolution") ||
          accounts.find((a: any) => a.provider === "evolution");
        if (!evoAccount) return null;
        return (
          <BulkBroadcastDialog
            open={bulkOpen}
            onOpenChange={setBulkOpen}
            accountId={evoAccount.id}
            accountName={evoAccount.name}
          />
        );
      })()}
    </div>
  );
}
