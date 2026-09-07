import { useState, type ReactNode } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";

interface CollapsibleSettingsCardProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Ex.: switch de liga/desliga — fica no cabeçalho, fora da área que abre/fecha. */
  headerAction?: ReactNode;
  defaultOpen?: boolean;
  cardClassName?: string;
  contentClassName?: string;
  children: ReactNode;
}

export function CollapsibleSettingsCard({
  icon,
  title,
  description,
  headerAction,
  defaultOpen = false,
  cardClassName,
  contentClassName,
  children,
}: CollapsibleSettingsCardProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Card className={cardClassName}>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CollapsibleTrigger asChild>
            <button type="button" className="flex flex-1 items-start gap-2 text-left min-w-0">
              <ChevronDown
                className={`h-4 w-4 mt-1 shrink-0 text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`}
              />
              <div className="min-w-0">
                <div className="flex items-center gap-2 font-semibold leading-none tracking-tight">
                  {icon}
                  {title}
                </div>
                {description && (
                  <p className="text-sm text-muted-foreground mt-1.5">{description}</p>
                )}
              </div>
            </button>
          </CollapsibleTrigger>
          {headerAction && (
            <div onClick={(e) => e.stopPropagation()} className="shrink-0">
              {headerAction}
            </div>
          )}
        </CardHeader>
        <CollapsibleContent>
          <CardContent className={contentClassName}>{children}</CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
