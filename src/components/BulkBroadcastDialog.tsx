import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Search, X, Image as ImageIcon, Send, Megaphone, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface BulkBroadcastDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  accountId: string;
  accountName: string;
}

function getInitials(name: string) {
  return (name || "?").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

export function BulkBroadcastDialog({ open, onOpenChange, accountId, accountName }: BulkBroadcastDialogProps) {
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [delayMin, setDelayMin] = useState(5);
  const [delayMax, setDelayMax] = useState(15);
  const [sending, setSending] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setExcludedIds(new Set());
      setSearch("");
    }
  }, [open]);

  // Carrega TODOS os leads do tenant que já têm mensagem nesta conta (= contatos do WhatsApp)
  const { data: leads = [], isLoading } = useQuery({
    queryKey: ["bulk-leads", accountId],
    enabled: open && !!accountId,
    queryFn: async () => {
      // Pega lead_ids únicos que têm mensagem nesta conta
      const { data: msgs, error } = await supabase
        .from("chat_messages")
        .select("lead_id")
        .eq("account_id", accountId)
        .limit(50000);
      if (error) throw error;
      const ids = Array.from(new Set((msgs || []).map((m: any) => m.lead_id).filter(Boolean)));
      if (ids.length === 0) return [];

      // Busca dados dos leads em chunks (in() tem limite prático)
      const out: any[] = [];
      const chunk = 500;
      for (let i = 0; i < ids.length; i += chunk) {
        const slice = ids.slice(i, i + chunk);
        const { data } = await supabase
          .from("leads")
          .select("id, name, phone, photo_url")
          .in("id", slice);
        if (data) out.push(...data);
      }
      return out.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    },
  });

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return leads;
    return leads.filter((l: any) =>
      l.name?.toLowerCase().includes(s) || l.phone?.includes(s)
    );
  }, [leads, search]);

  const includedCount = leads.length - excludedIds.size;

  const toggleExclude = (id: string) => {
    setExcludedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const excludeAllFiltered = () => {
    setExcludedIds((prev) => {
      const next = new Set(prev);
      for (const l of filtered) next.add(l.id);
      return next;
    });
  };

  const handleUpload = async (file: File) => {
    if (!file) return;
    setUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const path = `bulk-broadcast/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("chat-media").upload(path, file);
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("chat-media").getPublicUrl(path);
      setImageUrl(pub.publicUrl);
      toast.success("Imagem carregada");
    } catch (err: any) {
      toast.error(err.message || "Erro no upload");
    } finally {
      setUploading(false);
    }
  };

  const handleSend = async () => {
    if (!message.trim()) {
      toast.error("Escreva uma mensagem");
      return;
    }
    if (includedCount === 0) {
      toast.error("Nenhum contato selecionado");
      return;
    }
    if (delayMin > delayMax) {
      toast.error("Delay mínimo não pode ser maior que máximo");
      return;
    }

    const leadIds = leads.filter((l: any) => !excludedIds.has(l.id)).map((l: any) => l.id);
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("evolution-bulk-broadcast", {
        body: {
          account_id: accountId,
          lead_ids: leadIds,
          message: message.trim(),
          image_url: imageUrl || undefined,
          delay_min: delayMin,
          delay_max: delayMax,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`Disparo iniciado para ${leadIds.length} contatos`);
      onOpenChange(false);
      setMessage("");
      setImageUrl("");
    } catch (err: any) {
      toast.error(err.message || "Erro ao iniciar disparo");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] flex flex-col p-0">
        <DialogHeader className="p-6 pb-4 border-b">
          <DialogTitle className="flex items-center gap-2">
            <Megaphone size={18} className="text-primary" />
            Disparo em Massa — {accountName}
          </DialogTitle>
          <DialogDescription>
            Envia para todos os contatos da conta. Você pode pesquisar e excluir números antes de disparar.
            Use {"{primeiro_nome}"} para personalizar.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-6 overflow-hidden flex-1">
          {/* LEFT: Mensagem */}
          <div className="flex flex-col gap-3 min-h-0">
            <div>
              <Label className="text-xs">Mensagem</Label>
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Olá {primeiro_nome}, tudo bem?..."
                className="mt-1 min-h-[140px] text-sm"
                maxLength={4000}
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Variáveis: {"{nome}"}, {"{primeiro_nome}"}, {"{telefone}"}
              </p>
            </div>

            <div>
              <Label className="text-xs">Imagem (opcional)</Label>
              <div className="flex items-center gap-2 mt-1">
                <Input
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder="URL ou faça upload"
                  className="text-sm h-9"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                >
                  {uploading ? <Loader2 size={14} className="animate-spin" /> : <ImageIcon size={14} />}
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleUpload(f);
                    if (e.target) e.target.value = "";
                  }}
                />
              </div>
              {imageUrl && (
                <div className="mt-2 relative inline-block">
                  <img src={imageUrl} alt="preview" className="max-h-24 rounded border border-border" />
                  <button
                    onClick={() => setImageUrl("")}
                    className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-0.5"
                  >
                    <X size={12} />
                  </button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Delay mín (s)</Label>
                <Input
                  type="number"
                  min={0}
                  value={delayMin}
                  onChange={(e) => setDelayMin(Math.max(0, parseInt(e.target.value) || 0))}
                  className="h-9 text-sm mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">Delay máx (s)</Label>
                <Input
                  type="number"
                  min={0}
                  value={delayMax}
                  onChange={(e) => setDelayMax(Math.max(0, parseInt(e.target.value) || 0))}
                  className="h-9 text-sm mt-1"
                />
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Anti-ban: ordem embaralhada, sufixo invisível e pausa em 5 erros consecutivos.
            </p>
          </div>

          {/* RIGHT: Lista de contatos */}
          <div className="flex flex-col gap-2 min-h-0 border border-border rounded-lg p-3">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs">
                Contatos: <Badge variant="default" className="ml-1">{includedCount}</Badge>{" "}
                <span className="text-muted-foreground">/ {leads.length}</span>
                {excludedIds.size > 0 && (
                  <span className="text-destructive ml-2">{excludedIds.size} excluído(s)</span>
                )}
              </Label>
              {excludedIds.size > 0 && (
                <button
                  onClick={() => setExcludedIds(new Set())}
                  className="text-[10px] text-primary hover:underline"
                >
                  restaurar todos
                </button>
              )}
            </div>

            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nome ou telefone..."
                className="pl-7 h-8 text-xs"
              />
            </div>

            {search && filtered.length > 0 && (
              <button
                onClick={excludeAllFiltered}
                className="text-[10px] text-destructive hover:underline self-start flex items-center gap-1"
              >
                <Trash2 size={10} /> Excluir todos os {filtered.length} resultados
              </button>
            )}

            <ScrollArea className="flex-1 min-h-[240px] max-h-[320px]">
              {isLoading ? (
                <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
                  <Loader2 size={14} className="animate-spin mr-2" /> Carregando contatos...
                </div>
              ) : filtered.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-8">
                  {leads.length === 0 ? "Nenhum contato encontrado nesta conta." : "Nenhum resultado."}
                </p>
              ) : (
                filtered.map((lead: any) => {
                  const excluded = excludedIds.has(lead.id);
                  return (
                    <div
                      key={lead.id}
                      className={cn(
                        "flex items-center gap-2 px-2 py-1.5 rounded transition-colors text-xs",
                        excluded ? "opacity-40 line-through" : "hover:bg-accent/50"
                      )}
                    >
                      <Avatar className="w-6 h-6">
                        {lead.photo_url && <AvatarImage src={lead.photo_url} />}
                        <AvatarFallback className="text-[9px]">{getInitials(lead.name)}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="truncate font-medium">{lead.name}</p>
                        <p className="text-[10px] text-muted-foreground truncate">{lead.phone}</p>
                      </div>
                      <button
                        onClick={() => toggleExclude(lead.id)}
                        className={cn(
                          "p-1 rounded transition-colors",
                          excluded
                            ? "text-primary hover:bg-primary/10"
                            : "text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        )}
                        title={excluded ? "Restaurar" : "Excluir do disparo"}
                      >
                        {excluded ? <X size={12} className="rotate-45" /> : <X size={12} />}
                      </button>
                    </div>
                  );
                })
              )}
            </ScrollArea>
          </div>
        </div>

        <DialogFooter className="p-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
            Cancelar
          </Button>
          <Button onClick={handleSend} disabled={sending || includedCount === 0 || !message.trim()}>
            {sending ? (
              <><Loader2 size={14} className="animate-spin mr-1" /> Iniciando...</>
            ) : (
              <><Send size={14} className="mr-1" /> Disparar para {includedCount}</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
