import { Handle, Position, useReactFlow } from "@xyflow/react";
import { Zap, ShoppingCart, CreditCard, QrCode, PackageCheck, RotateCcw, XCircle, Users } from "lucide-react";

const TRIGGER_OPTIONS = [
  { value: "", label: "Selecione o gatilho...", icon: Zap },
  { value: "carrinho_abandonado", label: "Carrinho Abandonado", icon: ShoppingCart },
  { value: "pix", label: "Pix", icon: QrCode },
  { value: "cartao", label: "Cartão", icon: CreditCard },
  { value: "compra_aprovada", label: "Compra Aprovada", icon: PackageCheck },
  { value: "reembolso", label: "Reembolso", icon: RotateCcw },
  { value: "cancelamento", label: "Cancelamento", icon: XCircle },
  { value: "group_join", label: "Lead entrou no grupo (WhatsApp)", icon: Users },
];

export function TriggerNode({ id, data }: { id: string; data: Record<string, unknown> }) {
  const { setNodes } = useReactFlow();
  const triggerType = (data.trigger_type as string) || "";
  const selected = TRIGGER_OPTIONS.find((o) => o.value === triggerType) || TRIGGER_OPTIONS[0];
  const Icon = selected.icon;

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    setNodes((nds) =>
      nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, trigger_type: value } } : n))
    );
  };

  return (
    <div className="bg-background border-2 border-dashed border-primary/40 rounded-xl p-4 min-w-[220px] shadow-sm">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center">
          <Icon size={14} className="text-primary" />
        </div>
        <span className="text-sm font-semibold text-foreground">Quando...</span>
      </div>
      <select
        value={triggerType}
        onChange={handleChange}
        className="w-full text-xs rounded-md border border-input bg-background px-2 py-1.5 text-foreground"
      >
        {TRIGGER_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <Handle type="source" position={Position.Right} className="!w-3 !h-3 !bg-primary !border-2 !border-background" />
    </div>
  );
}
