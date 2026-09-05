import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { DataTable } from "@/components/DataTable";
import { DateRangeFilter, type DateRange } from "@/components/DateRangeFilter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { format, addDays, differenceInDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { Download } from "lucide-react";
import { toast } from "sonner";

const PERIOD_OPTIONS = [
  { label: "Vencidos", value: 0, min: -Infinity, max: -1 },
  { label: "7 dias", value: 7, min: 0, max: 7 },
  { label: "15 dias", value: 15, min: 8, max: 15 },
  { label: "30 dias", value: 30, min: 16, max: 30 },
  { label: "60 dias", value: 60, min: 31, max: 60 },
  { label: "Todos", value: -1, min: -Infinity, max: Infinity },
];

export default function Expirations() {
  const [period, setPeriod] = useState(30);
  const [dateRange, setDateRange] = useState<DateRange>({ from: undefined, to: undefined });

  const handlePeriodChange = (value: number) => {
    setPeriod(value);
  };
  const queryClient = useQueryClient();

  const { data: expirations, isLoading } = useQuery({
    queryKey: ["expirations", dateRange.from?.toISOString(), dateRange.to?.toISOString()],
    queryFn: async () => {
      // Fetch approved orders with product info
      let query = supabase
        .from("orders")
        .select("*, leads(hubla_id, name, phone, email), products(checkout_name)")
        .eq("status", "approved")
        .order("created_at", { ascending: true });
      if (dateRange.from) query = query.gte("created_at", dateRange.from.toISOString());
      if (dateRange.to) query = query.lte("created_at", dateRange.to.toISOString());
      const { data: orders } = await query;

      if (!orders) return [];

      // Fetch product compositions with item_id to group by item type
      const productIds = [...new Set(orders.map((o) => o.product_id).filter(Boolean))] as string[];
      const { data: productItems } = await supabase
        .from("product_items")
        .select("product_id, item_id, quantity")
        .in("product_id", productIds);

      // Map product_id -> list of { item_id, quantity }
      const productCompositionMap = new Map<string, { item_id: string; quantity: number }[]>();
      for (const pi of productItems || []) {
        if (!productCompositionMap.has(pi.product_id)) productCompositionMap.set(pi.product_id, []);
        productCompositionMap.get(pi.product_id)!.push({ item_id: pi.item_id, quantity: pi.quantity });
      }

      // Group by lead
      const leadMap = new Map<string, {
        earliestOrder: any;
        itemQtyMap: Map<string, number>; // item_id -> total qty
        productNames: Set<string>;
      }>();

      for (const order of orders) {
        if (!leadMap.has(order.lead_id)) {
          leadMap.set(order.lead_id, {
            earliestOrder: order,
            itemQtyMap: new Map(),
            productNames: new Set(),
          });
        }

        const entry = leadMap.get(order.lead_id)!;
        const productName = order.products?.checkout_name;
        if (productName) entry.productNames.add(productName);

        // Add item quantities from product composition
        const composition = order.product_id ? productCompositionMap.get(order.product_id) : null;
        if (composition) {
          for (const { item_id, quantity } of composition) {
            entry.itemQtyMap.set(item_id, (entry.itemQtyMap.get(item_id) || 0) + quantity);
          }
        } else {
          // Fallback: count as 1 unit of unknown item
          entry.itemQtyMap.set("unknown", (entry.itemQtyMap.get("unknown") || 0) + 1);
        }
      }

      // Calculate expiration per lead
      // Different item types are consumed in parallel → use MAX qty across item types
      // Each unit = 30 days of supply
      return Array.from(leadMap.values())
        .map(({ earliestOrder, itemQtyMap, productNames }) => {
          const maxQty = Math.max(...Array.from(itemQtyMap.values()), 1);
          const totalQty = Array.from(itemQtyMap.values()).reduce((a, b) => a + b, 0);
          const expirationDate = addDays(new Date(earliestOrder.created_at), maxQty * 30);
          const daysLeft = differenceInDays(expirationDate, new Date());
          return {
            ...earliestOrder,
            total_qty: totalQty,
            max_qty: maxQty,
            product_list: Array.from(productNames).join(", "),
            expiration_date: expirationDate,
            days_left: daysLeft,
          };
        })
        .sort((a, b) => a.days_left - b.days_left);
    },
  });

  const activeOption = PERIOD_OPTIONS.find((o) => o.value === period)!;
  const filtered = (expirations || []).filter((item: any) => {
    return item.days_left >= activeOption.min && item.days_left <= activeOption.max;
  });

  const getUrgencyBadge = (daysLeft: number) => {
    if (daysLeft < 0)
      return <Badge variant="destructive">Vencido há {Math.abs(daysLeft)}d</Badge>;
    if (daysLeft <= 7)
      return <Badge variant="destructive">Vence em {daysLeft}d</Badge>;
    if (daysLeft <= 15)
      return <Badge className="bg-orange-500/15 text-orange-600 border-orange-500/30 hover:bg-orange-500/20">Vence em {daysLeft}d</Badge>;
    if (daysLeft <= 30)
      return <Badge className="bg-yellow-500/15 text-yellow-600 border-yellow-500/30 hover:bg-yellow-500/20">Vence em {daysLeft}d</Badge>;
    return <Badge variant="secondary">Vence em {daysLeft}d</Badge>;
  };

  const columns = [
    {
      key: "lead",
      header: "Cliente",
      render: (row: any) => (
        <div>
          <p className="font-medium">
            {row.leads?.hubla_id && <span className="text-muted-foreground text-xs mr-1.5">{row.leads.hubla_id}</span>}
            {row.leads?.name || "—"}
          </p>
          <p className="text-xs text-muted-foreground">{row.leads?.phone}</p>
        </div>
      ),
    },
    {
      key: "product",
      header: "Produto",
      render: (row: any) => (
        <div className="max-w-xs">
          <span className="text-sm">{row.product_list || row.products?.checkout_name || "—"}</span>
        </div>
      ),
    },
    {
      key: "total_qty",
      header: "Qtd",
      render: (row: any) => (
        <span className="font-semibold">{row.max_qty}</span>
      ),
    },
    {
      key: "created_at",
      header: "Data da Compra",
      render: (row: any) =>
        format(new Date(row.created_at), "dd/MM/yyyy", { locale: ptBR }),
    },
    {
      key: "expiration_date",
      header: "Vencimento",
      render: (row: any) =>
        format(row.expiration_date, "dd/MM/yyyy", { locale: ptBR }),
    },
    {
      key: "days_left",
      header: "Status",
      render: (row: any) => getUrgencyBadge(row.days_left),
    },
  ];

  const exportCsv = () => {
    if (!filtered.length) {
      toast.error("Nenhum dado para exportar.");
      return;
    }
    const headers = ["ID Hubla", "Cliente", "Telefone", "E-mail", "Produto", "Qtd", "Data Compra", "Vencimento", "Dias Restantes"];
    const rows = filtered.map((row: any) => [
      row.leads?.hubla_id || "",
      row.leads?.name || "",
      row.leads?.phone || "",
      row.leads?.email || "",
      row.product_list || row.products?.checkout_name || "",
      row.max_qty,
      format(new Date(row.created_at), "dd/MM/yyyy", { locale: ptBR }),
      format(row.expiration_date, "dd/MM/yyyy", { locale: ptBR }),
      row.days_left,
    ]);
    const csv = [headers, ...rows].map((r) => r.map((c: any) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vencimentos-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV exportado com sucesso!");
  };

  return (
    <div>
      <PageHeader
        title="Vencimentos"
        description="Controle de vencimento dos suplementos por cliente (duração: 1 mês)"
        onRefresh={() => queryClient.invalidateQueries({ queryKey: ["expirations"] })}
      />

      <div className="mb-4">
        <DateRangeFilter value={dateRange} onChange={setDateRange} />
      </div>

      <div className="flex items-center justify-between mb-4">
        <div className="flex flex-wrap gap-2">
        {PERIOD_OPTIONS.map((opt) => (
          <Button
            key={opt.value}
            variant={period === opt.value ? "default" : "outline"}
            size="sm"
            onClick={() => handlePeriodChange(opt.value)}
          >
            {opt.label}
            {opt.value !== -1 && expirations && (
              <span className="ml-1.5 text-xs opacity-70">
                ({(expirations || []).filter((i: any) =>
                  i.days_left >= opt.min && i.days_left <= opt.max
                ).length})
              </span>
            )}
          </Button>
        ))}
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv}>
          <Download size={14} className="mr-1.5" />
          Exportar CSV
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={filtered}
        emptyMessage={isLoading ? "Carregando..." : "Nenhum vencimento encontrado para este período."}
      />
    </div>
  );
}
