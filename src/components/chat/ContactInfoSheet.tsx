import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToggleLeadLabel } from "@/hooks/use-chat-labels";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Loader2, Save, Columns3, Mail, Phone, CreditCard, Calendar, Clock } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export interface ContactInfoSheetProps {
  leadId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Aba inicial: dados ou edição */
  defaultTab?: "info" | "edit";
}

interface EditableLead {
  name: string;
  phone: string;
  email: string;
  cpf: string;
  origin: string;
}

function getAvatarColor(name: string): string {
  const colors = [
    "bg-emerald-600", "bg-violet-600", "bg-amber-600",
    "bg-rose-600", "bg-cyan-600", "bg-indigo-600",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function getInitials(name: string): string {
  return name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

function InfoRow({ icon: Icon, label, value }: { icon: any; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2">
      <Icon size={16} className="text-muted-foreground mt-0.5 flex-shrink-0" />
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium break-all">{value || "—"}</p>
      </div>
    </div>
  );
}

export function ContactInfoSheet({ leadId, open, onOpenChange, defaultTab = "info" }: ContactInfoSheetProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"info" | "edit">(defaultTab);
  const [form, setForm] = useState<EditableLead>({ name: "", phone: "", email: "", cpf: "", origin: "" });

  useEffect(() => {
    if (open) setTab(defaultTab);
  }, [open, defaultTab]);

  const { data: lead, isLoading } = useQuery({
    queryKey: ["contact-info-lead", leadId],
    enabled: !!leadId && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leads")
        .select("*")
        .eq("id", leadId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: stages } = useQuery({
    queryKey: ["pipeline-stages-contact"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pipeline_stages")
        .select("id, name, color, position")
        .order("position");
      if (error) throw error;
      return data || [];
    },
  });

  const { data: labels } = useQuery({
    queryKey: ["chat-labels-contact"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase.from("chat_labels").select("id, name, color");
      if (error) throw error;
      return data || [];
    },
  });

  const { data: leadLabelIds } = useQuery({
    queryKey: ["lead-labels-contact", leadId],
    enabled: !!leadId && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lead_labels")
        .select("label_id")
        .eq("lead_id", leadId!);
      if (error) throw error;
      return (data || []).map((r) => r.label_id);
    },
  });

  useEffect(() => {
    if (!lead) return;
    setForm({
      name: lead.name ?? "",
      phone: lead.phone ?? "",
      email: lead.email ?? "",
      cpf: lead.cpf ?? "",
      origin: lead.origin ?? "",
    });
  }, [lead]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["contact-info-lead", leadId] });
    queryClient.invalidateQueries({ queryKey: ["chat-leads"] });
    queryClient.invalidateQueries({ queryKey: ["kanban-leads"] });
    queryClient.invalidateQueries({ queryKey: ["leads"] });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!leadId) throw new Error("Lead não selecionado");
      if (!form.name.trim()) throw new Error("Informe o nome do contato");
      if (!form.phone.trim()) throw new Error("Informe o telefone do contato");
      const { error } = await supabase
        .from("leads")
        .update({
          name: form.name.trim(),
          phone: form.phone.trim(),
          email: form.email.trim() || null,
          cpf: form.cpf.trim() || null,
          origin: form.origin.trim() || null,
        })
        .eq("id", leadId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Contato atualizado" });
      invalidate();
      setTab("info");
    },
    onError: (err: any) => {
      toast({ title: "Erro ao salvar", description: err.message, variant: "destructive" });
    },
  });

  const moveStageMutation = useMutation({
    mutationFn: async (stageId: string) => {
      if (!leadId) throw new Error("Lead não selecionado");
      const { error } = await supabase
        .from("leads")
        .update({ stage_id: stageId === "none" ? null : stageId })
        .eq("id", leadId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Etapa atualizada" });
      invalidate();
    },
    onError: (err: any) => {
      toast({ title: "Erro ao mover", description: err.message, variant: "destructive" });
    },
  });

  // Toggle compartilhado com o chat: aplicar etiqueta com coluna associada
  // move o lead de etapa (trigger no banco).
  const toggleLabel = useToggleLeadLabel(leadId);

  const currentStage = useMemo(
    () => (stages || []).find((s) => s.id === (lead as any)?.stage_id),
    [stages, lead]
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:w-[440px] sm:max-w-[440px] flex flex-col p-0 gap-0">
        <SheetHeader className="p-0">
          <div className="px-6 pt-6 pb-4 bg-muted/30">
            <div className="flex items-center gap-4">
              <Avatar className="w-16 h-16 flex-shrink-0">
                {(lead as any)?.photo_url ? <AvatarImage src={(lead as any).photo_url} alt={form.name} /> : null}
                <AvatarFallback className={cn(getAvatarColor(form.name || "?"), "text-white font-semibold text-xl")}>
                  {getInitials(form.name || "?")}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1 text-left">
                <SheetTitle className="text-lg truncate">{form.name || "Contato"}</SheetTitle>
                <p className="text-sm text-muted-foreground">{form.phone}</p>
                {currentStage && (
                  <Badge variant="secondary" className="mt-1 text-[10px] gap-1">
                    <Columns3 size={10} /> {currentStage.name}
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </SheetHeader>

        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Tabs value={tab} onValueChange={(v) => setTab(v as "info" | "edit")} className="flex-1 flex flex-col min-h-0">
            <div className="px-6 pt-3">
              <TabsList className="w-full">
                <TabsTrigger value="info" className="flex-1">Dados</TabsTrigger>
                <TabsTrigger value="edit" className="flex-1">Editar</TabsTrigger>
              </TabsList>
            </div>

            <ScrollArea className="flex-1">
              <TabsContent value="info" className="px-6 py-4 space-y-5 m-0">
                <div>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                    Informações
                  </h3>
                  <InfoRow icon={Phone} label="Telefone" value={(lead as any)?.phone} />
                  <InfoRow icon={Mail} label="E-mail" value={(lead as any)?.email} />
                  <InfoRow icon={CreditCard} label="CPF" value={(lead as any)?.cpf} />
                  <InfoRow icon={Clock} label="Origem" value={(lead as any)?.origin || "—"} />
                  <InfoRow
                    icon={Calendar}
                    label="Cadastrado em"
                    value={
                      (lead as any)?.created_at
                        ? format(new Date((lead as any).created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })
                        : "—"
                    }
                  />
                  <InfoRow
                    icon={Clock}
                    label="Última mensagem recebida"
                    value={
                      (lead as any)?.last_inbound_at
                        ? format(new Date((lead as any).last_inbound_at), "dd/MM/yyyy HH:mm", { locale: ptBR })
                        : "—"
                    }
                  />
                </div>

                <Separator />

                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Mover para etapa do Kanban
                  </h3>
                  <Select
                    value={(lead as any)?.stage_id || "none"}
                    onValueChange={(v) => moveStageMutation.mutate(v)}
                    disabled={moveStageMutation.isPending}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione a etapa" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sem etapa</SelectItem>
                      {(stages || []).map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {labels && labels.length > 0 && (
                  <>
                    <Separator />
                    <div className="space-y-2">
                      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        Etiquetas
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {labels.map((l) => {
                          const active = (leadLabelIds || []).includes(l.id);
                          return (
                            <button
                              key={l.id}
                              onClick={() => toggleLabel.mutate({ labelId: l.id, applied: active })}
                              className={cn(
                                "text-xs px-2.5 py-1 rounded-full border transition-colors",
                                active
                                  ? "bg-primary text-primary-foreground border-primary"
                                  : "bg-muted/40 text-muted-foreground border-border hover:bg-muted"
                              )}
                            >
                              {l.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}
              </TabsContent>

              <TabsContent value="edit" className="px-6 py-4 space-y-4 m-0">
                <div className="space-y-1.5">
                  <Label htmlFor="contact-name">Nome</Label>
                  <Input
                    id="contact-name"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="contact-phone">Telefone</Label>
                  <Input
                    id="contact-phone"
                    value={form.phone}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="contact-email">E-mail</Label>
                  <Input
                    id="contact-email"
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="contact-cpf">CPF</Label>
                  <Input
                    id="contact-cpf"
                    value={form.cpf}
                    onChange={(e) => setForm((f) => ({ ...f, cpf: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="contact-origin">Origem</Label>
                  <Input
                    id="contact-origin"
                    value={form.origin}
                    onChange={(e) => setForm((f) => ({ ...f, origin: e.target.value }))}
                  />
                </div>
              </TabsContent>
            </ScrollArea>

            {tab === "edit" && (
              <div className="px-6 py-3 border-t border-border">
                <Button
                  className="w-full gap-2"
                  onClick={() => saveMutation.mutate()}
                  disabled={saveMutation.isPending}
                >
                  {saveMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                  Salvar alterações
                </Button>
              </div>
            )}
          </Tabs>
        )}
      </SheetContent>
    </Sheet>
  );
}
