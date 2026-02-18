import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Trash2, Plus } from "lucide-react";
import { toast } from "sonner";

interface CompositionRow {
  item_id: string;
  quantity: number;
}

interface ProductEditSheetProps {
  productId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProductEditSheet({ productId, open, onOpenChange }: ProductEditSheetProps) {
  const queryClient = useQueryClient();
  const [price, setPrice] = useState("");
  const [active, setActive] = useState(true);
  const [composition, setComposition] = useState<CompositionRow[]>([]);

  const { data: product } = useQuery({
    queryKey: ["product-detail", productId],
    queryFn: async () => {
      if (!productId) return null;
      const { data } = await supabase
        .from("products")
        .select("*")
        .eq("id", productId)
        .single();
      return data;
    },
    enabled: !!productId && open,
  });

  const { data: existingComposition } = useQuery({
    queryKey: ["product-composition", productId],
    queryFn: async () => {
      if (!productId) return [];
      const { data } = await supabase
        .from("product_items")
        .select("item_id, quantity")
        .eq("product_id", productId);
      return data || [];
    },
    enabled: !!productId && open,
  });

  const { data: items } = useQuery({
    queryKey: ["items-list"],
    queryFn: async () => {
      const { data } = await supabase.from("items").select("id, name, type").order("name");
      return data || [];
    },
  });

  useEffect(() => {
    if (product) {
      setPrice(String(product.price || ""));
      setActive(product.active);
    }
  }, [product]);

  useEffect(() => {
    if (existingComposition) {
      setComposition(existingComposition.map((c) => ({ item_id: c.item_id, quantity: c.quantity })));
    }
  }, [existingComposition]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!productId) return;

      const numericPrice = parseFloat(price) || 0;
      if (numericPrice < 0 || numericPrice > 999999) {
        throw new Error("Preço inválido");
      }

      await supabase
        .from("products")
        .update({ price: numericPrice, active })
        .eq("id", productId);

      // Replace composition
      await supabase.from("product_items").delete().eq("product_id", productId);

      const validItems = composition.filter((c) => c.item_id && c.quantity > 0);
      if (validItems.length > 0) {
        await supabase.from("product_items").insert(
          validItems.map((c) => ({
            product_id: productId,
            item_id: c.item_id,
            quantity: c.quantity,
          }))
        );
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products-list"] });
      queryClient.invalidateQueries({ queryKey: ["product-detail", productId] });
      queryClient.invalidateQueries({ queryKey: ["product-composition", productId] });
      toast.success("Produto atualizado!");
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast.error(err.message || "Erro ao salvar");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!productId) return;
      await supabase.from("order_items").delete().in(
        "order_id",
        (await supabase.from("orders").select("id").eq("product_id", productId)).data?.map((o) => o.id) || []
      );
      await supabase.from("product_items").delete().eq("product_id", productId);
      await supabase.from("orders").update({ product_id: null }).eq("product_id", productId);
      await supabase.from("products").delete().eq("id", productId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products-list"] });
      toast.success("Produto excluído!");
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast.error(err.message || "Erro ao excluir");
    },
  });

  const addRow = () => setComposition((prev) => [...prev, { item_id: "", quantity: 1 }]);

  const removeRow = (index: number) =>
    setComposition((prev) => prev.filter((_, i) => i !== index));

  const updateRow = (index: number, field: keyof CompositionRow, value: string | number) =>
    setComposition((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [field]: value } : row))
    );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-lg">Editar Produto</SheetTitle>
        </SheetHeader>

        {product && (
          <div className="mt-6 space-y-6">
            {/* Product name (read-only) */}
            <div>
              <Label className="text-muted-foreground text-xs">Nome do Checkout</Label>
              <p className="font-medium mt-1">{product.checkout_name}</p>
            </div>

            <div>
              <Label className="text-muted-foreground text-xs">SKU (Hubla)</Label>
              <p className="font-mono text-sm mt-1">{product.sku || "—"}</p>
            </div>

            {/* Price */}
            <div>
              <Label htmlFor="price">Preço (R$)</Label>
              <Input
                id="price"
                type="number"
                min="0"
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0.00"
                className="mt-1"
              />
            </div>

            {/* Active toggle */}
            <div className="flex items-center justify-between">
              <Label>Ativo</Label>
              <Switch checked={active} onCheckedChange={setActive} />
            </div>

            {/* Composition */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <Label className="text-base font-semibold">Composição de Itens</Label>
                <Button variant="outline" size="sm" onClick={addRow}>
                  <Plus className="h-4 w-4 mr-1" /> Adicionar
                </Button>
              </div>

              {composition.length === 0 && (
                <p className="text-sm text-muted-foreground py-4 text-center border border-dashed rounded-lg">
                  Nenhum item na composição. Clique em "Adicionar".
                </p>
              )}

              <div className="space-y-3">
                {composition.map((row, index) => (
                  <div key={index} className="flex items-end gap-2">
                    <div className="flex-1">
                      {index === 0 && <Label className="text-xs text-muted-foreground">Item</Label>}
                      <Select
                        value={row.item_id}
                        onValueChange={(val) => updateRow(index, "item_id", val)}
                      >
                        <SelectTrigger className="mt-1">
                          <SelectValue placeholder="Selecione..." />
                        </SelectTrigger>
                        <SelectContent>
                          {items?.map((item) => (
                            <SelectItem key={item.id} value={item.id}>
                              {item.name} ({item.type})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="w-20">
                      {index === 0 && <Label className="text-xs text-muted-foreground">Qtd</Label>}
                      <Input
                        type="number"
                        min="1"
                        max="100"
                        value={row.quantity}
                        onChange={(e) =>
                          updateRow(index, "quantity", Math.max(1, parseInt(e.target.value) || 1))
                        }
                        className="mt-1"
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive shrink-0"
                      onClick={() => removeRow(index)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="space-y-2">
              <Button
                className="w-full"
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
              >
                {saveMutation.isPending ? "Salvando..." : "Salvar Alterações"}
              </Button>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" className="w-full" disabled={deleteMutation.isPending}>
                    <Trash2 className="h-4 w-4 mr-2" />
                    {deleteMutation.isPending ? "Excluindo..." : "Excluir Produto"}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Excluir produto?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Essa ação é irreversível. O produto "{product.checkout_name}" será removido permanentemente. Pedidos vinculados perderão a referência ao produto.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={() => deleteMutation.mutate()}>
                      Excluir
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
