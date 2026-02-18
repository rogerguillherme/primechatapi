import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Send, FileText, Smile, Check, CheckCheck, Paperclip } from "lucide-react";
import { format, isToday, isYesterday, isSameDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { ChatMediaBubble } from "@/components/ChatMediaBubble";
import { AudioRecorder } from "@/components/AudioRecorder";

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
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

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

  const { data: templates } = useQuery({
    queryKey: ["chat-templates"],
    queryFn: async () => {
      const { data } = await supabase.from("chat_templates").select("*").order("name");
      return data || [];
    },
    enabled: open,
  });

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
      const { data, error } = await supabase.functions.invoke("zapi-send-message", {
        body: {
          phone: lead.phone,
          message: text || "",
          lead_id: lead.id,
          media_url: mediaUrl || undefined,
          media_type: mediaType || undefined,
          template_name: templateName,
          template_language: templateLanguage,
          template_params: templateParams,
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
    const file = new File([blob], "audio.webm", { type: "audio/webm" });
    uploadAndSendMedia(file);
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
              <div className="flex-1 min-w-0">
                <p className="font-medium text-[15px] text-sidebar-foreground truncate">{lead.name}</p>
                <p className="text-xs text-sidebar-foreground/50">{lead.phone}</p>
              </div>
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
                  return (
                    <div
                      key={msg.id}
                      className={cn(
                        "flex mb-[2px]",
                        isOutbound ? "justify-end" : "justify-start",
                        showTail && "mt-2"
                      )}
                    >
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
                          {isOutbound && <CheckCheck size={13} className={msg.status === "read" ? "text-sky-400" : "opacity-60"} />}
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
            {templates && templates.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="p-2 rounded-full hover:bg-accent text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 mb-[2px]">
                    <FileText size={20} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-72 max-h-64 overflow-y-auto">
                  <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground uppercase">Templates</div>
                  {templates.map((t: any) => (
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
      </SheetContent>
    </Sheet>
  );
}
