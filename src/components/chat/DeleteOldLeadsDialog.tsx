import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Trash2, Loader2, AlertTriangle } from "lucide-react";
import { format, subDays } from "date-fns";

interface Props {
  trigger?: React.ReactNode;
}

export function DeleteOldLeadsDialog({ trigger }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(format(subDays(new Date(), 90), "yyyy-MM-dd"));
  const [end, setEnd] = useState(format(subDays(new Date(), 30), "yyyy-MM-dd"));
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [confirmText, setConfirmText] = useState("");

  const buildQuery = () => {
    if (!user) throw new Error("Sem sessão");
    const startIso = new Date(start + "T00:00:00").toISOString();
    const endIso = new Date(end + "T23:59:59").toISOString();
    // Leads sem atividade após "end": última interação anterior a endIso
    // e (se houver) posterior a startIso — janela de leads "antigos e inativos".
    let q = supabase
      .from("leads")
      .eq("user_id", user.id);
    // Sem last_inbound_at nem last_outbound_at depois de endIso
    q = q.or(`last_inbound_at.is.null,last_inbound_at.lte.${endIso}`);
    q = q.or(`last_outbound_at.is.null,last_outbound_at.lte.${endIso}`);
    // Última atividade (ou criação) posterior a startIso — mantém foco no intervalo
    q = q.gte("created_at", startIso);
    q = q.lte("created_at", endIso);
    return q;
  };

  const preview = useMutation({
    mutationFn: async () => {
      const q = buildQuery();
      const { count, error } = await q.select("id", { count: "exact", head: true });
      if (error) throw error;
      return count ?? 0;
    },
    onSuccess: (c) => setPreviewCount(c),
    onError: (e: Error) => toast({ title: "Erro ao contar leads", description: e.message, variant: "destructive" }),
  });

  const doDelete = useMutation({
    mutationFn: async () => {
      const q = buildQuery();
      const { data: ids, error } = await q.select("id");
      if (error) throw error;
      const leadIds = (ids || []).map((r: any) => r.id);
      if (leadIds.length === 0) return 0;

      // Apaga mensagens antes (chat_messages não tem cascade garantida)
      await supabase.from("chat_messages").delete().in("lead_id", leadIds);
      const { error: delErr } = await supabase.from("leads").delete().in("id", leadIds);
      if (delErr) throw delErr;
      return leadIds.length;
    },
    onSuccess: (n) => {
      toast({ title: `${n} lead(s) removido(s)`, description: "Chat atualizado." });
      qc.invalidateQueries({ queryKey: ["chat-leads"] });
      qc.invalidateQueries({ queryKey: ["chat-latest-messages"] });
      setOpen(false);
      setConfirmText("");
      setPreviewCount(null);
    },
    onError: (e: Error) =>
      toast({ title: "Erro ao excluir", description: e.message, variant: "destructive" }),
  });

  const canDelete = previewCount !== null && previewCount > 0 && confirmText === "EXCLUIR";

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setPreviewCount(null); setConfirmText(""); } }}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm" variant="outline" className="gap-1.5">
            <Trash2 size={14} /> Limpar antigos
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 size={18} className="text-destructive" /> Excluir leads antigos do chat
          </DialogTitle>
          <DialogDescription>
            Remove leads (e suas mensagens) criados no intervalo e sem interação após a data final.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">De</Label>
              <Input type="date" value={start} max={end} onChange={(e) => { setStart(e.target.value); setPreviewCount(null); }} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Até</Label>
              <Input type="date" value={end} min={start} max={format(new Date(), "yyyy-MM-dd")} onChange={(e) => { setEnd(e.target.value); setPreviewCount(null); }} />
            </div>
          </div>

          <Button
            variant="secondary"
            size="sm"
            className="w-full"
            onClick={() => preview.mutate()}
            disabled={preview.isPending}
          >
            {preview.isPending ? <Loader2 size={14} className="animate-spin mr-1.5" /> : null}
            Ver quantos leads serão afetados
          </Button>

          {previewCount !== null && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs space-y-2">
              <p className="flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-400">
                <AlertTriangle size={14} /> {previewCount} lead(s) serão apagados permanentemente
              </p>
              {previewCount > 0 && (
                <>
                  <p className="text-muted-foreground">
                    Isso remove os leads e todas as mensagens vinculadas. A ação não pode ser desfeita.
                  </p>
                  <div className="space-y-1">
                    <Label className="text-[11px]">Digite <span className="font-mono font-bold">EXCLUIR</span> para confirmar</Label>
                    <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="EXCLUIR" className="h-8 text-xs" />
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={!canDelete || doDelete.isPending}
            onClick={() => doDelete.mutate()}
            className="gap-1.5"
          >
            {doDelete.isPending && <Loader2 size={14} className="animate-spin" />}
            Excluir {previewCount ?? 0} lead(s)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
