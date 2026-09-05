import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { DataTable } from "@/components/DataTable";
import { Badge } from "@/components/ui/badge";

export default function Items() {
  const { data: items, isLoading } = useQuery({
    queryKey: ["items-list"],
    queryFn: async () => {
      const { data } = await supabase.from("items").select("*").order("created_at", { ascending: false });
      return data || [];
    },
  });

  const columns = [
    { key: "name", header: "Nome" },
    {
      key: "type",
      header: "Tipo",
      render: (row: any) => (
        <Badge variant={row.type === "kit" ? "default" : "secondary"}>
          {row.type === "kit" ? "Kit" : "Suplemento"}
        </Badge>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="Itens Físicos" description="Kits e suplementos que compõem os pacotes" />
      <DataTable columns={columns} data={items || []} emptyMessage={isLoading ? "Carregando..." : "Nenhum item encontrado."} />
    </div>
  );
}
