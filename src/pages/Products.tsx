import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { DataTable } from "@/components/DataTable";
import { Badge } from "@/components/ui/badge";
import { ProductEditSheet } from "@/components/ProductEditSheet";
import { BulkActionsToolbar } from "@/components/BulkActionsToolbar";

export default function Products() {
  const [editId, setEditId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const { data: products, isLoading } = useQuery({
    queryKey: ["products-list"],
    queryFn: async () => {
      const { data } = await supabase
        .from("products")
        .select("*, product_items(quantity, items(name, type))")
        .order("created_at", { ascending: false });
      return data || [];
    },
  });

  const selectedNames = (products || [])
    .filter((p: any) => selectedIds.has(p.id))
    .map((p: any) => p.checkout_name);

  const columns = [
    { key: "checkout_name", header: "Nome do Checkout" },
    { key: "sku", header: "SKU", render: (row: any) => <span className="font-mono text-xs">{row.sku || "—"}</span> },
    {
      key: "price",
      header: "Preço",
      render: (row: any) =>
        row.price ? `R$ ${Number(row.price).toFixed(2)}` : "—",
    },
    {
      key: "active",
      header: "Status",
      render: (row: any) => (
        <Badge variant={row.active ? "default" : "secondary"}>
          {row.active ? "Ativo" : "Inativo"}
        </Badge>
      ),
    },
    {
      key: "items",
      header: "Composição",
      render: (row: any) =>
        row.product_items?.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {row.product_items.map((pi: any, i: number) => (
              <span key={i} className="inline-flex items-center px-2 py-0.5 rounded-md text-xs bg-accent text-accent-foreground border border-border">
                {pi.quantity}x {pi.items?.name}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-muted-foreground text-xs">Não configurado</span>
        ),
    },
  ];

  return (
    <div>
      <PageHeader title="Produtos" description="Pacotes do checkout e suas composições. Clique para editar." />
      <BulkActionsToolbar
        selectedIds={Array.from(selectedIds)}
        selectedNames={selectedNames}
        onClear={() => setSelectedIds(new Set())}
      />
      <DataTable
        columns={columns}
        data={products || []}
        onRowClick={(row: any) => setEditId(row.id)}
        emptyMessage={isLoading ? "Carregando..." : "Nenhum produto encontrado."}
        selectable
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
      />
      <ProductEditSheet productId={editId} open={!!editId} onOpenChange={(open) => !open && setEditId(null)} />
    </div>
  );
}
