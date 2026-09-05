import { cn } from "@/lib/utils";

const statusConfig: Record<string, { label: string; className: string }> = {
  pending: { label: "Pendente", className: "bg-warning/15 text-warning border-warning/30" },
  approved: { label: "Aprovado", className: "bg-success/15 text-success border-success/30" },
  paid: { label: "Pago", className: "bg-success/15 text-success border-success/30" },
  refunded: { label: "Reembolsado", className: "bg-destructive/15 text-destructive border-destructive/30" },
  chargeback: { label: "Chargeback", className: "bg-destructive/15 text-destructive border-destructive/30" },
  cancelled: { label: "Cancelado", className: "bg-muted text-muted-foreground border-border" },
};

export function StatusBadge({ status }: { status: string }) {
  const config = statusConfig[status] || { label: status, className: "bg-muted text-muted-foreground border-border" };
  return (
    <span className={cn("inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border", config.className)}>
      {config.label}
    </span>
  );
}
