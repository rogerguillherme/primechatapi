import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ExportButtonProps {
  table: string;
  filename: string;
  columns: { key: string; header: string }[];
  filters?: Record<string, any>;
  label?: string;
}

export function ExportButton({ table, filename, columns, filters, label = "Exportar CSV" }: ExportButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleExport = async () => {
    setLoading(true);
    try {
      let query = supabase.from(table as any).select(columns.map((c) => c.key).join(","));
      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          query = query.eq(key, value);
        }
      }
      const { data, error } = await query.limit(10000);
      if (error) throw error;
      if (!data || data.length === 0) {
        toast.info("Nenhum dado para exportar.");
        return;
      }

      const headers = columns.map((c) => c.header).join(",");
      const rows = data.map((row: any) =>
        columns.map((c) => {
          const val = row[c.key];
          if (val === null || val === undefined) return "";
          const str = String(val).replace(/"/g, '""');
          return str.includes(",") || str.includes('"') || str.includes("\n") ? `"${str}"` : str;
        }).join(",")
      );
      const csv = [headers, ...rows].join("\n");
      const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${filename}_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Exportação concluída!");
    } catch (err) {
      toast.error("Erro ao exportar dados.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button variant="outline" size="sm" onClick={handleExport} disabled={loading} className="gap-1.5 text-xs">
      {loading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
      {label}
    </Button>
  );
}
