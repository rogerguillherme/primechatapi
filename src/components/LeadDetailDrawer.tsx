import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import {
  User, Mail, Phone, CreditCard, Calendar, ShoppingCart,
  MessageSquare, Package, Hash, RefreshCw, Clock,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { useMemo } from "react";

interface LeadDetailDrawerProps {
  lead: any | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenChat?: (lead: { id: string; name: string; phone: string }) => void;
}

function getAvatarColor(name: string) {
  const colors = [
    "bg-emerald-600", "bg-violet-600", "bg-amber-600",
    "bg-rose-600", "bg-cyan-600", "bg-indigo-600",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function getInitials(name: string) {
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

export function LeadDetailDrawer({ lead, open, onOpenChange, onOpenChat }: LeadDetailDrawerProps) {
  const { data: orders } = useQuery({
    queryKey: ["lead-detail-orders", lead?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("orders")
        .select("*, products(checkout_name)")
        .eq("lead_id", lead!.id)
        .order("created_at", { ascending: false });
      return data || [];
    },
    enabled: !!lead && open,
  });

  const stats = useMemo(() => {
    if (!orders) return { total: 0, approved: 0, revenue: 0, products: new Map<string, number>(), isRecurrent: false };
    const mainOrders = orders.filter(
      (o) => !o.external_order_id?.includes("-offer") && !o.external_order_id?.includes("-tester")
    );
    const approved = mainOrders.filter((o) => o.status === "approved");
    const revenue = approved.reduce((sum, o) => sum + Number(o.amount || 0), 0);
    const products = new Map<string, number>();
    for (const o of approved) {
      const name = (o as any).products?.checkout_name;
      if (name) products.set(name, (products.get(name) || 0) + 1);
    }
    return {
      total: mainOrders.length,
      approved: approved.length,
      revenue,
      products,
      isRecurrent: approved.length > 1,
    };
  }, [orders]);

  const sortedProducts = useMemo(
    () => Array.from(stats.products.entries()).sort((a, b) => b[1] - a[1]),
    [stats.products]
  );

  if (!lead) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[440px] sm:max-w-[440px] flex flex-col p-0 gap-0">
        <SheetHeader className="p-0">
          {/* Hero header */}
          <div className="px-6 pt-6 pb-4 bg-muted/30">
            <div className="flex items-center gap-4">
              <div className={cn(
                "w-16 h-16 rounded-full flex items-center justify-center text-white font-semibold text-xl flex-shrink-0",
                getAvatarColor(lead.name)
              )}>
                {getInitials(lead.name)}
              </div>
              <div className="min-w-0 flex-1">
                <SheetTitle className="text-lg truncate">{lead.name}</SheetTitle>
                {stats.isRecurrent && (
                  <Badge variant="secondary" className="mt-1 text-xs gap-1">
                    <RefreshCw size={10} /> Recorrente
                  </Badge>
                )}
              </div>
            </div>

            {/* Quick stats */}
            <div className="grid grid-cols-3 gap-3 mt-4">
              <div className="bg-card rounded-lg p-3 text-center border border-border">
                <p className="text-lg font-bold text-primary">{stats.approved}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Compras</p>
              </div>
              <div className="bg-card rounded-lg p-3 text-center border border-border">
                <p className="text-lg font-bold text-primary">
                  {stats.revenue.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                </p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Receita</p>
              </div>
              <div className="bg-card rounded-lg p-3 text-center border border-border">
                <p className="text-lg font-bold text-primary">{stats.products.size}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Produtos</p>
              </div>
            </div>
          </div>
        </SheetHeader>

        <ScrollArea className="flex-1">
          <div className="px-6 py-4 space-y-5">
            {/* Contact info */}
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Informações</h3>
              <div className="space-y-0">
                <InfoRow icon={Phone} label="Telefone" value={lead.phone} />
                <InfoRow icon={Mail} label="E-mail" value={lead.email} />
                <InfoRow icon={CreditCard} label="CPF" value={lead.cpf} />
                <InfoRow icon={Hash} label="Hubla ID" value={lead.hubla_id} />
                <InfoRow icon={Calendar} label="Cadastrado em" value={format(new Date(lead.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })} />
                <InfoRow icon={Clock} label="Origem" value={
                  <Badge variant="outline" className="text-xs">{lead.origin || "hubla"}</Badge>
                } />
              </div>
            </div>

            <Separator />

            {/* Products bought */}
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Produtos comprados</h3>
              {sortedProducts.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma compra registrada</p>
              ) : (
                <div className="space-y-2">
                  {sortedProducts.map(([name, qty]) => (
                    <div key={name} className="flex items-center justify-between bg-muted/40 rounded-lg px-3 py-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Package size={14} className="text-muted-foreground flex-shrink-0" />
                        <span className="text-sm truncate">{name}</span>
                      </div>
                      <Badge variant="secondary" className="text-xs flex-shrink-0">
                        {qty}x
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <Separator />

            {/* Order history */}
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Histórico de pedidos</h3>
              {!orders || orders.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum pedido encontrado</p>
              ) : (
                <div className="space-y-2">
                  {orders
                    .filter((o) => !o.external_order_id?.includes("-tester"))
                    .map((order) => {
                      const isOffer = order.external_order_id?.includes("-offer");
                      const productName = (order as any).products?.checkout_name;
                      return (
                        <div
                          key={order.id}
                          className={cn(
                            "rounded-lg border border-border p-3",
                            isOffer ? "bg-muted/20 ml-4" : "bg-card"
                          )}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-2">
                              <Badge
                                variant={order.status === "approved" ? "default" : "secondary"}
                                className="text-[10px]"
                              >
                                {order.status === "approved" ? "Aprovado" : order.status === "refunded" ? "Reembolsado" : order.status}
                              </Badge>
                              {isOffer && (
                                <Badge variant="outline" className="text-[10px]">Order bump</Badge>
                              )}
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {format(new Date(order.created_at), "dd/MM/yy HH:mm")}
                            </span>
                          </div>
                          {productName && (
                            <p className="text-sm truncate">{productName}</p>
                          )}
                          <div className="flex items-center justify-between mt-1">
                            <span className="text-xs text-muted-foreground font-mono truncate max-w-[180px]">
                              {order.external_order_id}
                            </span>
                            <span className="text-sm font-semibold">
                              {Number(order.amount).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          </div>
        </ScrollArea>

        {/* Footer with chat button */}
        <div className="px-6 py-3 border-t border-border">
          <Button
            className="w-full gap-2"
            onClick={() => {
              onOpenChange(false);
              onOpenChat?.({ id: lead.id, name: lead.name, phone: lead.phone });
            }}
          >
            <MessageSquare size={16} />
            Abrir conversa
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
