import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Trash2, DollarSign, Hash, X } from "lucide-react";
import { toast } from "sonner";

interface BulkActionsToolbarProps {
  selectedIds: string[];
  selectedNames: string[];
  onClear: () => void;
}

export function BulkActionsToolbar({ selectedIds, selectedNames, onClear }: BulkActionsToolbarProps) {
  const queryClient = useQueryClient();
  const [priceDialogOpen, setPriceDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [bulkPrice, setBulkPrice] = useState("");

  const count = selectedIds.length;

  const bulkPriceMutation = useMutation({
    mutationFn: async () => {
      const numericPrice = parseFloat(bulkPrice);
      if (isNaN(numericPrice) || numericPrice < 0 || numericPrice > 999999) {
        throw new Error("Preço inválido");
      }
      for (const id of selectedIds) {
        await supabase.from("products").update({ price: numericPrice }).eq("id", id);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products-list"] });
      toast.success(`Preço atualizado em ${count} produto(s)`);
      setPriceDialogOpen(false);
      setBulkPrice("");
      onClear();
    },
    onError: (err: any) => toast.error(err.message || "Erro ao atualizar preço"),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async () => {
      for (const id of selectedIds) {
        await supabase.from("product_items").delete().eq("product_id", id);
        await supabase.from("orders").update({ product_id: null }).eq("product_id", id);
        await supabase.from("products").delete().eq("id", id);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products-list"] });
      toast.success(`${count} produto(s) excluído(s)`);
      setDeleteDialogOpen(false);
      onClear();
    },
    onError: (err: any) => toast.error(err.message || "Erro ao excluir"),
  });

  if (count === 0) return null;

  return (
    <>
      <div className="flex items-center gap-3 px-4 py-3 bg-primary/10 border border-primary/20 rounded-xl mb-4 animate-in slide-in-from-top-2">
        <span className="text-sm font-semibold text-primary">
          {count} selecionado{count > 1 ? "s" : ""}
        </span>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={() => setPriceDialogOpen(true)}>
          <DollarSign className="h-4 w-4 mr-1" /> Alterar Preço
        </Button>
        <Button variant="destructive" size="sm" onClick={() => setDeleteDialogOpen(true)}>
          <Trash2 className="h-4 w-4 mr-1" /> Excluir
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClear}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Bulk Price Dialog */}
      <Dialog open={priceDialogOpen} onOpenChange={setPriceDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Alterar Preço em Massa</DialogTitle>
            <DialogDescription>
              Definir novo preço para {count} produto(s) selecionado(s).
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="bulk-price">Novo Preço (R$)</Label>
            <Input
              id="bulk-price"
              type="number"
              min="0"
              step="0.01"
              value={bulkPrice}
              onChange={(e) => setBulkPrice(e.target.value)}
              placeholder="0.00"
              className="mt-1"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPriceDialogOpen(false)}>Cancelar</Button>
            <Button onClick={() => bulkPriceMutation.mutate()} disabled={bulkPriceMutation.isPending}>
              {bulkPriceMutation.isPending ? "Salvando..." : "Aplicar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Delete Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir {count} produto(s)?</AlertDialogTitle>
            <AlertDialogDescription>
              Essa ação é irreversível. Os seguintes produtos serão removidos permanentemente:
              <span className="block mt-2 text-foreground font-medium max-h-32 overflow-y-auto text-xs">
                {selectedNames.join(" • ")}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => bulkDeleteMutation.mutate()} disabled={bulkDeleteMutation.isPending}>
              {bulkDeleteMutation.isPending ? "Excluindo..." : "Excluir Todos"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
