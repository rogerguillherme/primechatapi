import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";

interface PageHeaderProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
  onRefresh?: () => void;
}

export function PageHeader({ title, description, action, onRefresh }: PageHeaderProps) {
  const [spinning, setSpinning] = useState(false);

  const handleRefresh = () => {
    if (!onRefresh) return;
    setSpinning(true);
    onRefresh();
    setTimeout(() => setSpinning(false), 600);
  };

  return (
    <div className="flex items-center justify-between mb-8">
      <div className="flex items-center gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-display font-bold text-foreground tracking-tight">{title}</h1>
          {description && <p className="text-sm text-muted-foreground mt-1.5 max-w-lg">{description}</p>}
        </div>
        {onRefresh && (
          <Button variant="ghost" size="icon" onClick={handleRefresh} className="h-8 w-8">
            <RefreshCw size={16} className={spinning ? "animate-spin" : ""} />
          </Button>
        )}
      </div>
      {action}
    </div>
  );
}
