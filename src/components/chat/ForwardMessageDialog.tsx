import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useLeadsPicker, type PickerLead } from "@/hooks/use-leads-picker";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { functionErrorMessage } from "@/lib/functionError";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Loader2, Search, Send } from "lucide-react";

/** Mensagem que será encaminhada (formato das linhas de `chat_messages`). */
export interface ForwardableMessage {
  id: string;
  content: string | null;
  media_url: string | null;
  media_type: string | null;
}

export interface ForwardMessageDialogProps {
  /** `null` mantém o diálogo fechado. */
  message: ForwardableMessage | null;
  onClose: () => void;
  /** Número (conta WhatsApp) usado no envio. */
  accountId: string | null;
}

function previewOf(msg: ForwardableMessage): string {
  if (msg.content?.trim()) return msg.content.trim();
  if (msg.media_type === "audio") return "🎤 Áudio";
  if (msg.media_type === "image") return "📷 Imagem";
  if (msg.media_type === "video") return "🎥 Vídeo";
  if (msg.media_type) return "📎 Arquivo";
  return "Mensagem";
}

/**
 * Encaminha uma mensagem já existente para outros contatos.
 *
 * O envio é sequencial de propósito: a Meta responde erro por destinatário
 * (janela de 24h fechada, número inválido) e o operador precisa saber quantos
 * de fato saíram, não só que "deu erro".
 */
export function ForwardMessageDialog({ message, onClose, accountId }: ForwardMessageDialogProps) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { data: leads = [], isLoading } = useLeadsPicker();

  const filtered = useMemo(() => {
    const termo = search.trim().toLowerCase();
    const base = leads.filter((l) => !!l.phone);
    if (!termo) return base.slice(0, 60);
    return base
      .filter((l) => (l.name || "").toLowerCase().includes(termo) || (l.phone || "").includes(termo))
      .slice(0, 60);
  }, [leads, search]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const fechar = () => {
    setSearch("");
    setSelected(new Set());
    onClose();
  };

  const forward = useMutation({
    mutationFn: async () => {
      if (!message) throw new Error("Nenhuma mensagem selecionada");
      const destinos: PickerLead[] = leads.filter((l) => selected.has(l.id) && l.phone);
      if (destinos.length === 0) throw new Error("Selecione ao menos um contato");

      let enviados = 0;
      const falhas: string[] = [];
      for (const lead of destinos) {
        try {
          const { error } = await supabase.functions.invoke("whatsapp-cloud-send", {
            body: {
              phone: lead.phone,
              message: message.content || "",
              lead_id: lead.id,
              media_url: message.media_url || undefined,
              media_type: message.media_type || undefined,
              account_id: accountId,
            },
          });
          if (error) throw error;
          enviados++;
        } catch (err: unknown) {
          falhas.push(lead.name || lead.phone || "contato");
          console.error("Falha ao encaminhar para", lead.id, await functionErrorMessage(err, "erro"));
        }
      }
      return { enviados, falhas };
    },
    onSuccess: ({ enviados, falhas }) => {
      if (enviados > 0) toast.success(`Mensagem encaminhada para ${enviados} contato(s)`);
      if (falhas.length > 0) toast.error(`Não foi possível enviar para: ${falhas.slice(0, 3).join(", ")}`);
      fechar();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Dialog open={!!message} onOpenChange={(open) => !open && fechar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Encaminhar mensagem</DialogTitle>
          <DialogDescription className="line-clamp-2">
            {message ? previewOf(message) : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar contato por nome ou telefone"
            className="pl-8 h-9"
          />
        </div>

        <div className="max-h-64 overflow-y-auto rounded-md border border-border divide-y divide-border">
          {isLoading && (
            <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
              <Loader2 size={14} className="animate-spin" /> Carregando contatos...
            </div>
          )}
          {!isLoading && filtered.length === 0 && (
            <p className="p-3 text-sm text-muted-foreground">Nenhum contato encontrado.</p>
          )}
          {filtered.map((lead) => {
            const ativo = selected.has(lead.id);
            return (
              <button
                key={lead.id}
                type="button"
                onClick={() => toggle(lead.id)}
                className={cn(
                  "w-full text-left px-3 py-2 text-sm transition-colors hover:bg-accent",
                  ativo && "bg-primary/10",
                )}
              >
                <span className="block font-medium truncate">{lead.name || lead.phone}</span>
                <span className="block text-xs text-muted-foreground">{lead.phone}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">{selected.size} selecionado(s)</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={fechar} disabled={forward.isPending}>
              Cancelar
            </Button>
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => forward.mutate()}
              disabled={forward.isPending || selected.size === 0}
            >
              {forward.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              Encaminhar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
