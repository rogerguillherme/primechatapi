import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useUserTemplates } from "@/hooks/use-user-templates";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Send, FileText, Smile, Check, CheckCheck, Paperclip, AlertCircle, Bot, User, Columns3, Zap, Workflow } from "lucide-react";
import { format, isToday, isYesterday, isSameDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { ChatMediaBubble } from "@/components/ChatMediaBubble";
import { AudioRecorder, audioFileFromBlob } from "@/components/AudioRecorder";
import { useWhatsAppAccounts } from "@/hooks/use-whatsapp-accounts";
import { ContactInfoSheet } from "@/components/chat/ContactInfoSheet";
import { startFlowForLead } from "@/lib/startFlowForLead";

interface LeadChatDrawerProps {
  lead: { id: string; name: string; phone: string } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

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

export function LeadChatDrawer({ lead, open, onOpenChange }: LeadChatDrawerProps) {
  const [message, setMessage] = useState("");
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [contactOpen, setContactOpen] = useState(false);
  const [contactTab, setContactTab] = useState<"info" | "edit">("info");
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { accounts, defaultAccount } = useWhatsAppAccounts();

  // Auto-select default account
  useEffect(() => {
    if (!selectedAccountId && defaultAccount) {
      setSelectedAccountId(defaultAccount.id);
    }
  }, [defaultAccount, selectedAccountId]);

  const { data: messages } = useQuery({
    queryKey: ["chat-messages", lead?.id],
    queryFn: async () => {
      if (!lead) return [];
      const { data } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("lead_id", lead.id)
        .order("created_at", { ascending: true });
      return data || [];
    },
    enabled: !!lead && open,
  });

  // AI mode (global) + per-lead AI flag
  const { data: aiMode } = useQuery({
    queryKey: ["ai-auto-reply-mode"],
    queryFn: async () => {
      const { data } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "ai_auto_reply_mode")
        .maybeSingle();
      return (data?.value as "off" | "all" | "selected" | undefined) ?? "off";
    },
    enabled: open,
  });

  const { data: leadAi } = useQuery({
    queryKey: ["lead-ai-enabled", lead?.id],
    queryFn: async () => {
      if (!lead) return false;
      const { data } = await supabase
        .from("leads")
        .select("ai_enabled")
        .eq("id", lead.id)
        .maybeSingle();
      return !!data?.ai_enabled;
    },
    enabled: !!lead && open,
  });

  const toggleAiMutation = useMutation({
    mutationFn: async (next: boolean) => {
      if (!lead) throw new Error("No lead");
      const { error } = await supabase
        .from("leads")
        .update({ ai_enabled: next })
        .eq("id", lead.id);
      if (error) throw error;
      return next;
    },
    onSuccess: (next) => {
      queryClient.setQueryData(["lead-ai-enabled", lead?.id], next);
      toast({
        title: next ? "Agente IA ativado nesta conversa" : "Agente IA desativado nesta conversa",
      });
    },
    onError: () => {
      toast({ title: "Erro ao atualizar", variant: "destructive" });
    },
  });

  // ── Etapas do Kanban: permitem mover o lead direto do cabeçalho da conversa ──
  const { data: pipelineStages = [] } = useQuery({
    queryKey: ["pipeline-stages-chat"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pipeline_stages")
        .select("id, name, color, position")
        .order("position");
      if (error) throw error;
      return data || [];
    },
    enabled: open,
  });

  const moveStageMutation = useMutation({
    mutationFn: async (stageId: string) => {
      if (!lead) throw new Error("Nenhuma conversa selecionada");
      const { error } = await supabase.from("leads").update({ stage_id: stageId }).eq("id", lead.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Lead movido de etapa" });
      queryClient.invalidateQueries({ queryKey: ["kanban-leads"] });
      queryClient.invalidateQueries({ queryKey: ["contact-info-lead", lead?.id] });
    },
    onError: (err: any) => {
      toast({ title: "Erro ao mover", description: err.message, variant: "destructive" });
    },
  });

  // ── Atalhos: mensagens rápidas ou ativação de fluxos já criados ──
  const { data: shortcuts = [] } = useQuery({
    queryKey: ["chat-shortcuts-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chat_shortcuts")
        .select("*")
        .eq("active", true)
        .order("command");
      if (error) throw error;
      return data || [];
    },
    enabled: open,
  });

  const runShortcut = useCallback(async (shortcut: any) => {
    if (!lead) return;
    if (shortcut.action_type === "flow") {
      try {
        await startFlowForLead({
          flowId: shortcut.flow_id,
          leadId: lead.id,
          accountId: selectedAccountId || defaultAccount?.id || null,
        });
        toast({ title: `Fluxo /${shortcut.command} iniciado` });
      } catch (err: any) {
        toast({ title: "Erro ao iniciar fluxo", description: err.message, variant: "destructive" });
      }
      return;
    }
    const text = (shortcut.message || "")
      .replace(/\{nome\}/gi, lead.name || "")
      .replace(/\{telefone\}/gi, lead.phone || "");
    setMessage(text);
    textareaRef.current?.focus();
  }, [lead, selectedAccountId, defaultAccount, toast]);

  const { templates } = useUserTemplates(open);


  const { data: accountTemplates = [] } = useQuery({
    queryKey: ["account-templates"],
    queryFn: async () => {
      const { data } = await supabase.from("account_templates").select("*");
      return (data || []) as { id: string; account_id: string; template_id: string }[];
    },
    enabled: open,
  });

  const availableTemplates = useMemo(() => {
    return (templates || []).filter((template: any) => {
      if (template.meta_status !== "APPROVED") return false;

      const linkedAccounts = accountTemplates.filter((link) => link.template_id === template.id);
      if (!selectedAccountId || linkedAccounts.length === 0) return true;

      return linkedAccounts.some((link) => link.account_id === selectedAccountId);
    });
  }, [templates, accountTemplates, selectedAccountId]);

  useEffect(() => {
    if (!open || !lead) return;
    const channel = supabase
      .channel(`chat-drawer-${lead.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages", filter: `lead_id=eq.${lead.id}` },
        () => queryClient.invalidateQueries({ queryKey: ["chat-messages", lead.id] })
      )
      .subscribe();

    // Polling fallback every 5 seconds
    const interval = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ["chat-messages", lead.id] });
    }, 5000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [lead, open, queryClient]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 100) + "px";
    }
  }, [message]);

  const groupedMessages = useMemo(() => {
    if (!messages) return [];
    const groups: { date: Date; messages: typeof messages }[] = [];
    for (const msg of messages) {
      const msgDate = new Date(msg.created_at);
      const last = groups[groups.length - 1];
      if (last && isSameDay(last.date, msgDate)) {
        last.messages.push(msg);
      } else {
        groups.push({ date: msgDate, messages: [msg] });
      }
    }
    return groups;
  }, [messages]);

  const sendMutation = useMutation({
    mutationFn: async ({ text, mediaUrl, mediaType, templateName, templateLanguage, templateParams }: { text?: string; mediaUrl?: string; mediaType?: string; templateName?: string; templateLanguage?: string; templateParams?: any[] }) => {
      if (!lead) throw new Error("No lead");
      const { data, error } = await supabase.functions.invoke("whatsapp-cloud-send", {
        body: {
          phone: lead.phone,
          message: text || "",
          lead_id: lead.id,
          media_url: mediaUrl || undefined,
          media_type: mediaType || undefined,
          template_name: templateName,
          template_language: templateLanguage,
          template_params: templateParams,
          account_id: selectedAccountId || undefined,
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      setMessage("");
      queryClient.invalidateQueries({ queryKey: ["chat-messages", lead?.id] });
    },
    onError: (err: any) => {
      toast({ title: "Erro ao enviar", description: err.message, variant: "destructive" });
    },
  });

  const uploadAndSendMedia = useCallback(async (file: File) => {
    if (!lead) return;
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("lead_id", lead.id);
      const { data, error } = await supabase.functions.invoke("chat-upload-media", { body: formData });
      if (error) throw error;
      sendMutation.mutate({ mediaUrl: data.url, mediaType: data.media_type });
    } catch (err: any) {
      toast({ title: "Erro no upload", description: err.message, variant: "destructive" });
    }
  }, [lead, sendMutation, toast]);

  const handleAudioRecorded = useCallback((blob: Blob) => {
    uploadAndSendMedia(audioFileFromBlob(blob));
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
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[420px] sm:max-w-[420px] flex flex-col p-0 gap-0">
        {/* Header */}
        <div className="h-14 px-4 flex items-center gap-3 border-b border-border" style={{ background: "hsl(var(--sidebar-background))" }}>
          {lead && (
            <>
              <div className={cn("w-10 h-10 rounded-full flex items-center justify-center text-white font-medium text-sm", getAvatarColor(lead.name))}>
                {getInitials(lead.name)}
              </div>
              <button
                type="button"
                onClick={() => { setContactTab("info"); setContactOpen(true); }}
                className="flex-1 min-w-0 text-left rounded-md px-1 py-0.5 hover:bg-sidebar-foreground/10 transition-colors"
                title="Ver dados do contato"
              >
                <p className="font-medium text-[15px] text-sidebar-foreground truncate">{lead.name}</p>
                <p className="text-xs text-sidebar-foreground/50">{lead.phone}</p>
              </button>

              {/* Dados do contato */}
              <button
                type="button"
                onClick={() => { setContactTab("info"); setContactOpen(true); }}
                title="Dados do contato"
                className="h-8 w-8 rounded-md inline-flex items-center justify-center border border-sidebar-foreground/20 text-sidebar-foreground/70 hover:bg-sidebar-foreground/10 transition-colors"
              >
                <User size={15} />
              </button>

              {/* Mover para etapa do Kanban */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    title="Mover para etapa do Kanban"
                    className="h-8 w-8 rounded-md inline-flex items-center justify-center border border-sidebar-foreground/20 text-sidebar-foreground/70 hover:bg-sidebar-foreground/10 transition-colors"
                  >
                    <Columns3 size={15} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 max-h-72 overflow-y-auto">
                  <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground uppercase">Mover para etapa</div>
                  {pipelineStages.length === 0 ? (
                    <div className="px-2 py-3 text-xs text-muted-foreground">Nenhuma etapa criada.</div>
                  ) : pipelineStages.map((stage: any) => (
                    <DropdownMenuItem
                      key={stage.id}
                      onClick={() => moveStageMutation.mutate(stage.id)}
                      className="gap-2"
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ background: stage.color || "hsl(var(--primary))" }}
                      />
                      <span className="truncate">{stage.name}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              {aiMode === "selected" && (
                <button
                  type="button"
                  onClick={() => toggleAiMutation.mutate(!leadAi)}
                  disabled={toggleAiMutation.isPending}
                  title={leadAi ? "Agente IA ativo nesta conversa" : "Ativar agente IA nesta conversa"}
                  className={cn(
                    "h-8 px-2 rounded-md inline-flex items-center gap-1.5 text-xs font-medium transition-colors border",
                    leadAi
                      ? "bg-violet-500/15 text-violet-300 border-violet-500/30 hover:bg-violet-500/25"
                      : "bg-transparent text-sidebar-foreground/70 border-sidebar-foreground/20 hover:bg-sidebar-foreground/10"
                  )}
                >
                  <Bot size={14} />
                  IA {leadAi ? "ON" : "OFF"}
                </button>
              )}
              {aiMode === "all" && (
                <span
                  title="Agente IA respondendo todas as conversas"
                  className="h-8 px-2 rounded-md inline-flex items-center gap-1.5 text-xs font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                >
                  <Bot size={14} /> IA ON
                </span>
              )}
              {accounts.length > 1 && (
                <select
                  value={selectedAccountId || ""}
                  onChange={(e) => setSelectedAccountId(e.target.value || null)}
                  className="h-7 rounded-md border border-sidebar-foreground/20 bg-transparent px-2 text-xs text-sidebar-foreground focus:outline-none"
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id} className="text-foreground bg-background">
                      {a.name} {a.is_default ? "(padrão)" : ""}
                    </option>
                  ))}
                </select>
              )}
            </>
          )}
        </div>

        {/* Messages */}
        <div
          className="flex-1 overflow-y-auto px-4 py-3"
          style={{
            backgroundColor: "hsl(30 20% 93%)",
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23000000' fill-opacity='0.02'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
          }}
        >
          <div className="space-y-1">
            {messages?.length === 0 && (
              <div className="flex justify-center py-8">
                <div className="bg-card/90 backdrop-blur rounded-lg px-5 py-2 shadow-sm">
                  <p className="text-sm text-muted-foreground">Nenhuma mensagem ainda 💬</p>
                </div>
              </div>
            )}

            {groupedMessages.map((group, gi) => (
              <div key={gi}>
                <div className="flex justify-center my-2">
                  <span className="bg-card/90 backdrop-blur text-muted-foreground text-[11px] font-medium px-3 py-1 rounded-md shadow-sm uppercase tracking-wide">
                    {formatDateSeparator(group.date)}
                  </span>
                </div>
                {group.messages.map((msg, mi) => {
                  const isOutbound = msg.direction === "outbound";
                  const prevMsg = mi > 0 ? group.messages[mi - 1] : null;
                  const showTail = !prevMsg || prevMsg.direction !== msg.direction;
                  const accountName = isOutbound && msg.account_id && accounts.length > 1
                    ? accounts.find((a) => a.id === msg.account_id)?.name
                    : null;
                  const prevAccount = prevMsg?.direction === "outbound" ? prevMsg.account_id : null;
                  const showAccountLabel = accountName && (showTail || msg.account_id !== prevAccount);
                  return (
                    <div
                      key={msg.id}
                      className={cn(
                        "flex flex-col mb-[2px]",
                        isOutbound ? "items-end" : "items-start",
                        showTail && "mt-2"
                      )}
                    >
                      {showAccountLabel && (
                        <span className="text-[10px] text-muted-foreground/70 px-2 mb-0.5 font-medium">
                          {accountName}
                        </span>
                      )}
                      <div className={cn(
                        "relative max-w-[85%] px-[9px] pt-[6px] pb-2 text-[13.5px] leading-[18px] shadow-sm",
                        isOutbound ? "bg-[#d9fdd3] text-[#111b21] rounded-lg" : "bg-card text-foreground rounded-lg",
                        showTail && isOutbound && "rounded-tr-none",
                        showTail && !isOutbound && "rounded-tl-none"
                      )}>
                        {showTail && (
                          <div className={cn("absolute top-0 w-2 h-3", isOutbound ? "-right-2" : "-left-2")}>
                            <svg viewBox="0 0 8 13" width="8" height="13">
                              {isOutbound ? (
                                <path fill="#d9fdd3" d="M1.533 3.568 8 12.193V1H2.812C1.042 1 .474 2.156 1.533 3.568z" />
                              ) : (
                                <path fill="hsl(var(--card))" d="M6.467 3.568 0 12.193V1h5.188c1.77 0 2.338 1.156 1.28 2.568z" />
                              )}
                            </svg>
                          </div>
                        )}
                        {msg.media_url && msg.media_type ? (
                          <div className="mb-1">
                            <ChatMediaBubble
                              mediaType={msg.media_type}
                              mediaUrl={msg.media_url}
                              caption={msg.media_type !== "audio" ? msg.content : undefined}
                              isOutbound={isOutbound}
                            />
                            <span className="inline-block w-[55px]" />
                          </div>
                        ) : (
                          <p className="whitespace-pre-wrap break-words">
                            {msg.content}
                            <span className="inline-block w-[55px]" />
                          </p>
                        )}
                        <span className={cn("absolute bottom-[4px] right-[6px] flex items-center gap-[2px]", isOutbound ? "text-[#667781]" : "text-muted-foreground")}>
                          <span className="text-[11px] leading-none">{format(new Date(msg.created_at), "HH:mm")}</span>
                          {isOutbound && (
                            msg.status === "failed"
                              ? <AlertCircle size={13} className="text-destructive" aria-label="Falha no envio" />
                              : <CheckCheck size={13} className={msg.status === "read" ? "text-sky-400" : "opacity-60"} />
                          )}
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
        <div className="px-3 py-2 bg-muted/50 border-t border-border">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*,audio/*"
            className="hidden"
            onChange={handleFileSelect}
          />
          <div className="flex items-end gap-1.5">
            {/* Atalhos: mensagem rápida ou fluxo */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  title="Atalhos (mensagens rápidas e fluxos)"
                  className="p-2 rounded-full hover:bg-accent text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 mb-[2px]"
                >
                  <Zap size={20} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-72 max-h-72 overflow-y-auto">
                <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground uppercase">Atalhos</div>
                {shortcuts.length === 0 ? (
                  <div className="px-2 py-3 text-xs text-muted-foreground">
                    Nenhum atalho criado. Configure em Configurações → Atalhos do chat.
                  </div>
                ) : shortcuts.map((s: any) => (
                  <DropdownMenuItem key={s.id} onClick={() => runShortcut(s)} className="gap-2 items-start">
                    {s.action_type === "flow"
                      ? <Workflow size={14} className="mt-0.5 text-primary flex-shrink-0" />
                      : <Zap size={14} className="mt-0.5 text-amber-500 flex-shrink-0" />}
                    <div className="min-w-0">
                      <p className="text-sm font-medium">/{s.command}</p>
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {s.action_type === "flow" ? "Ativar fluxo" : s.message}
                      </p>
                    </div>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

             {templates && templates.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="p-2 rounded-full hover:bg-accent text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 mb-[2px]">
                    <FileText size={20} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-72 max-h-64 overflow-y-auto">
                  <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground uppercase">Templates</div>
                   {availableTemplates.length === 0 ? (
                     <div className="px-2 py-3 text-xs text-muted-foreground">
                       Nenhum template aprovado para esta conta.
                     </div>
                   ) : availableTemplates.map((t: any) => (
                    <DropdownMenuItem 
                      key={t.id} 
                      onClick={() => {
                        if (t.template_name) {
                          const resolvedParams = ((t.template_params || []) as any[]).map((p: any) => {
                            const text = typeof p === "string" ? p : p?.text || "";
                            return {
                              type: "text",
                              text: text.replace(/\{nome\}/g, lead?.name?.split(" ")[0] || ""),
                            };
                          });
                          const hasUnresolved = resolvedParams.some((p: any) => !p.text || /\{.*\}/.test(p.text));
                          if (hasUnresolved) {
                            toast({ title: "Template incompleto", description: "Este template requer parâmetros que não podem ser preenchidos automaticamente no chat.", variant: "destructive" });
                            return;
                          }
                          sendMutation.mutate({ templateName: t.template_name, templateLanguage: t.template_language || "pt_BR", templateParams: resolvedParams });
                        } else {
                          setMessage(t.content);
                        }
                      }} 
                      className="flex flex-col items-start gap-0.5"
                    >
                      <span className="font-medium text-sm">{t.name}</span>
                      <span className="text-xs text-muted-foreground line-clamp-2">{t.content}</span>
                    </DropdownMenuItem>
                   ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="p-2 rounded-full hover:bg-accent text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 mb-[2px]"
            >
              <Paperclip size={20} />
            </button>
            <div className="flex-1 bg-card rounded-lg border border-border shadow-sm overflow-hidden">
              <textarea
                ref={textareaRef}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Digite uma mensagem"
                className="w-full px-3 py-[8px] text-[14px] bg-transparent outline-none resize-none placeholder:text-muted-foreground max-h-[100px]"
                rows={1}
                style={{ minHeight: "36px" }}
              />
            </div>
            {message.trim() ? (
              <button
                onClick={handleSend}
                disabled={sendMutation.isPending}
                className="p-2 rounded-full flex-shrink-0 mb-[2px] bg-primary text-primary-foreground hover:opacity-90 transition-colors"
              >
                <Send size={18} />
              </button>
            ) : (
              <AudioRecorder onRecorded={handleAudioRecorded} disabled={sendMutation.isPending} />
            )}
          </div>
        </div>

        <ContactInfoSheet
          leadId={lead?.id ?? null}
          open={contactOpen}
          onOpenChange={setContactOpen}
          defaultTab={contactTab}
        />
      </SheetContent>
    </Sheet>
  );
}
