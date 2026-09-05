import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { DataTable } from "@/components/DataTable";
import { DateRangeFilter, type DateRange } from "@/components/DateRangeFilter";
import { LeadChatDrawer } from "@/components/LeadChatDrawer";
import { LeadDetailDrawer } from "@/components/LeadDetailDrawer";
import { ExportButton } from "@/components/ExportButton";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, ShoppingCart, MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";

export default function Leads() {
  const [search, setSearch] = useState("");
  const [dateRange, setDateRange] = useState<DateRange>({ from: undefined, to: undefined });
  const [chatLead, setChatLead] = useState<{ id: string; name: string; phone: string } | null>(null);
  const [detailLead, setDetailLead] = useState<any | null>(null);
  const queryClient = useQueryClient();

  const { data: leads, isLoading } = useQuery({
    queryKey: ["leads", search, dateRange.from?.toISOString(), dateRange.to?.toISOString()],
    queryFn: async () => {
      // First get lead IDs that have at least 1 order
      const { data: orderLeads } = await supabase
        .from("orders")
        .select("lead_id");
      const buyerIds = new Set((orderLeads || []).map((o) => o.lead_id));

      let query = supabase.from("leads").select("*").order("created_at", { ascending: false });
      if (search) query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`);
      if (dateRange.from) query = query.gte("created_at", dateRange.from.toISOString());
      if (dateRange.to) query = query.lte("created_at", dateRange.to.toISOString());
      const { data } = await query;
      return (data || []).filter((lead) => buyerIds.has(lead.id));
    },
  });

  // Fetch all approved orders with product names to compute per-lead stats
  const { data: allOrders } = useQuery({
    queryKey: ["leads-orders-stats"],
    queryFn: async () => {
      const { data } = await supabase
        .from("orders")
        .select("lead_id, product_id, external_order_id, status, products(checkout_name)")
        .eq("status", "approved");
      return data || [];
    },
  });

  // Pre-compute stats per lead
  const leadStats = useMemo(() => {
    const map = new Map<string, { count: number; products: Map<string, number> }>();
    for (const o of allOrders || []) {
      if (o.external_order_id?.includes("-offer") || o.external_order_id?.includes("-tester")) continue;
      const entry = map.get(o.lead_id) || { count: 0, products: new Map() };
      entry.count++;
      const prodName = (o as any).products?.checkout_name;
      if (prodName) {
        entry.products.set(prodName, (entry.products.get(prodName) || 0) + 1);
      }
      map.set(o.lead_id, entry);
    }
    return map;
  }, [allOrders]);

  const columns = [
    { key: "hubla_id", header: "ID", render: (row: any) => <span className="font-mono text-muted-foreground">{row.hubla_id || "—"}</span> },
    { key: "name", header: "Nome" },
    { key: "email", header: "E-mail", render: (row: any) => row.email || "—" },
    { key: "phone", header: "Telefone" },
    {
      key: "purchases",
      header: "Compras",
      render: (row: any) => {
        const stats = leadStats.get(row.id);
        const count = stats?.count || 0;
        return (
          <div className="flex items-center gap-1.5">
            <ShoppingCart size={14} className="text-muted-foreground" />
            <span className={count > 1 ? "font-semibold text-primary" : "text-muted-foreground"}>
              {count}
            </span>
            {count > 1 && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                recorrente
              </Badge>
            )}
          </div>
        );
      },
    },
    {
      key: "top_products",
      header: "Produtos mais comprados",
      render: (row: any) => {
        const stats = leadStats.get(row.id);
        if (!stats || stats.products.size === 0) return <span className="text-muted-foreground">—</span>;
        const sorted = Array.from(stats.products.entries()).sort((a, b) => b[1] - a[1]);
        const top3 = sorted.slice(0, 3);
        return (
          <TooltipProvider>
            <div className="flex flex-wrap gap-1">
              {top3.map(([name, qty]) => (
                <Tooltip key={name}>
                  <TooltipTrigger>
                    <Badge variant="outline" className="text-[10px] max-w-[140px] truncate">
                      {name} {qty > 1 && `(${qty}x)`}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>{name} — {qty} compra{qty > 1 ? "s" : ""}</TooltipContent>
                </Tooltip>
              ))}
              {sorted.length > 3 && (
                <Badge variant="outline" className="text-[10px]">+{sorted.length - 3}</Badge>
              )}
            </div>
          </TooltipProvider>
        );
      },
    },
    {
      key: "created_at",
      header: "Cadastrado em",
      render: (row: any) => format(new Date(row.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR }),
    },
    {
      key: "actions",
      header: "",
      render: (row: any) => (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={(e) => {
            e.stopPropagation();
            setChatLead({ id: row.id, name: row.name, phone: row.phone });
          }}
        >
          <MessageSquare size={14} />
        </Button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="Leads" description="Todos os compradores cadastrados" onRefresh={() => queryClient.invalidateQueries({ queryKey: ["leads"] })} />
      <div className="flex items-center gap-4 mb-4 flex-wrap">
        <div className="max-w-sm relative flex-shrink-0">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Buscar por nome, telefone ou e-mail..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <DateRangeFilter value={dateRange} onChange={setDateRange} />
        <ExportButton
          table="leads"
          filename="leads"
          columns={[
            { key: "name", header: "Nome" },
            { key: "phone", header: "Telefone" },
            { key: "email", header: "E-mail" },
            { key: "created_at", header: "Data" },
          ]}
        />
      </div>
      <DataTable columns={columns} data={leads || []} emptyMessage={isLoading ? "Carregando..." : "Nenhum lead encontrado."} onRowClick={(row) => setDetailLead(row)} />
      <LeadDetailDrawer
        lead={detailLead}
        open={!!detailLead}
        onOpenChange={(open) => { if (!open) setDetailLead(null); }}
        onOpenChat={(lead) => setChatLead(lead)}
      />
      <LeadChatDrawer lead={chatLead} open={!!chatLead} onOpenChange={(open) => { if (!open) setChatLead(null); }} />
    </div>
  );
}
