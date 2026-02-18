import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";

interface StatCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  trend?: string;
  className?: string;
  accentColor?: string;
}

export function StatCard({ title, value, icon: Icon, trend, className, accentColor }: StatCardProps) {
  return (
    <div className={cn(
      "relative overflow-hidden bg-card rounded-xl p-5 shadow-card hover:shadow-card-hover transition-all duration-300 border border-border group",
      className
    )}>
      {/* Subtle gradient accent at top */}
      <div className={cn("absolute top-0 left-0 right-0 h-1 rounded-t-xl", accentColor || "gradient-primary")} />
      
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">{title}</p>
          <p className="text-2xl font-display font-bold text-card-foreground">{value}</p>
          {trend && <p className="text-xs text-success font-medium">{trend}</p>}
        </div>
        <div className={cn(
          "p-2.5 rounded-xl transition-colors duration-300",
          "bg-accent group-hover:bg-primary/10"
        )}>
          <Icon size={20} className="text-accent-foreground group-hover:text-primary transition-colors duration-300" />
        </div>
      </div>
    </div>
  );
}
