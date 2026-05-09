import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, CheckCircle2, RefreshCw, Instagram } from "lucide-react";
import { toast } from "sonner";

export function InstagramAddAccountDialog({
  open,
  onOpenChange,
  onReauthRequested,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onReauthRequested: () => void;
}) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState<string | null>(null);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["ig-available-accounts"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("instagram-list-available-accounts");
      if (error) throw error;
      if (data?.error) {
        if (data?.needs_reauth) throw Object.assign(new Error(data.error), { needs_reauth: true });
        throw new Error(data.error);
      }
      return data;
    },
    enabled: open,
    retry: false,
  });

  const accounts: any[] = data?.accounts || [];
  const errMsg = error instanceof Error ? error.message : "";
  const needsReauth = (error as any)?.needs_reauth;

  const handleAdd = async (acc: any) => {
    setAdding(acc.ig_user_id);
    try {
      const { data, error } = await supabase.functions.invoke("instagram-add-account", {
        body: { ig_user_id: acc.ig_user_id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`@${data.instagram_username} adicionada`);
      qc.invalidateQueries({ queryKey: ["instagram-connections"] });
      qc.invalidateQueries({ queryKey: ["ig-available-accounts"] });
    } catch (e: any) {
      toast.error(e.message || "Erro ao adicionar conta");
    } finally {
      setAdding(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Adicionar outra conta Instagram</DialogTitle>
          <DialogDescription>
            Contas Instagram Business disponíveis na sua conta Meta já autorizada.
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="py-8 flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {!isLoading && needsReauth && (
          <div className="py-6 text-center space-y-3">
            <p className="text-sm text-muted-foreground">{errMsg}</p>
            <Button onClick={onReauthRequested} className="gap-2">
              <RefreshCw className="h-4 w-4" /> Reconectar Meta
            </Button>
          </div>
        )}

        {!isLoading && !needsReauth && errMsg && (
          <p className="text-sm text-destructive py-4">{errMsg}</p>
        )}

        {!isLoading && !error && accounts.length === 0 && (
          <p className="text-sm text-muted-foreground py-6 text-center">
            Nenhuma conta Instagram Business adicional encontrada.
          </p>
        )}

        {!isLoading && accounts.length > 0 && (
          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {accounts.map((acc) => (
              <div
                key={acc.ig_user_id}
                className="flex items-center justify-between gap-3 rounded-lg border p-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar className="h-10 w-10">
                    <AvatarImage src={acc.ig_avatar} />
                    <AvatarFallback>
                      <Instagram className="h-4 w-4" />
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="font-medium truncate">@{acc.ig_username}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {acc.page_name} · {acc.ig_followers?.toLocaleString("pt-BR") || 0} seguidores
                    </p>
                  </div>
                </div>
                {acc.already_connected ? (
                  <Badge variant="secondary" className="gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Conectada
                  </Badge>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => handleAdd(acc)}
                    disabled={adding === acc.ig_user_id}
                    className="gap-1"
                  >
                    {adding === acc.ig_user_id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Plus className="h-3 w-3" />
                    )}
                    Adicionar
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
