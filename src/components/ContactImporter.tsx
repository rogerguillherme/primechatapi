import { useState, useRef, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Upload, Search, UserPlus, Trash2, FileSpreadsheet,
  Users, Loader2, Download, Plus, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import * as XLSX from "xlsx";

function getInitials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

function getAvatarColor(name: string) {
  const colors = ["bg-emerald-600", "bg-violet-600", "bg-amber-600", "bg-rose-600", "bg-cyan-600", "bg-indigo-600"];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

interface ImportedContact {
  name: string;
  phone: string;
  email?: string;
}

export function ContactImporter() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [search, setSearch] = useState("");
  const [contacts, setContacts] = useState<ImportedContact[]>([]);
  const [listName, setListName] = useState("");

  // Column mapping modal
  const [columnMapOpen, setColumnMapOpen] = useState(false);
  const [sheetColumns, setSheetColumns] = useState<string[]>([]);
  const [sheetRows, setSheetRows] = useState<Record<string, any>[]>([]);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});

  // Manual add
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newEmail, setNewEmail] = useState("");

  const normalizePhone = (raw: any): string => String(raw ?? "").replace(/\D/g, "");

  const rawToPhone = (value: any): string => {
    if (value === null || value === undefined || value === "") return "";
    if (typeof value === "number") return value.toFixed(0);
    const str = String(value).trim();
    if (/\d+\.?\d*[eE][+\-]\d+/.test(str)) return parseFloat(str).toFixed(0);
    return str;
  };

  const autoDetectMapping = (cols: string[]): Record<string, string> => {
    const mapping: Record<string, string> = {};
    for (const col of cols) {
      const lower = col.toLowerCase();
      if (/tel|phone|fone|celular|whatsapp|numero|n[uú]mero/.test(lower)) {
        mapping[col] = "phone";
      } else if (/nome|name|cliente/.test(lower)) {
        mapping[col] = "name";
      } else if (/email|e-mail/.test(lower)) {
        mapping[col] = "email";
      } else {
        mapping[col] = "ignore";
      }
    }
    return mapping;
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const isExcel = /\.(xlsx?|xls)$/i.test(file.name);
    const isCsv = /\.csv$/i.test(file.name);
    const reader = new FileReader();

    reader.onload = (ev) => {
      if (isExcel) {
        try {
          const buffer = ev.target?.result as ArrayBuffer;
          const workbook = XLSX.read(buffer, { type: "array" });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { raw: true, defval: "" });
          openColumnMap(rows);
        } catch (err: any) {
          toast.error(`Erro ao ler Excel: ${err?.message}`);
        }
      } else if (isCsv) {
        const text = ev.target?.result as string;
        if (!text) return;
        const lines = text.split(/\r?\n/).filter((l) => l.trim());
        if (lines.length < 2) { toast.error("CSV sem dados."); return; }
        const sep = lines[0].includes(";") ? ";" : ",";
        const headers = lines[0].split(sep).map((h) => h.trim().replace(/^["']|["']$/g, ""));
        const rows: Record<string, any>[] = [];
        for (let i = 1; i < lines.length; i++) {
          const vals = lines[i].split(sep).map((v) => v.trim().replace(/^["']|["']$/g, ""));
          if (vals.every((v) => !v)) continue;
          const row: Record<string, any> = {};
          headers.forEach((h, idx) => { row[h] = vals[idx] ?? ""; });
          rows.push(row);
        }
        openColumnMap(rows);
      } else {
        // Plain text: one phone per line
        const text = ev.target?.result as string;
        if (!text) return;
        const phones = text.split(/[\r\n,;]+/).map((l) => normalizePhone(l.trim())).filter((p) => p.length >= 10);
        const newContacts = phones.map((p) => ({ name: `Contato ${p.slice(-4)}`, phone: p }));
        setContacts((prev) => dedup([...prev, ...newContacts]));
        toast.success(`${newContacts.length} contato(s) adicionado(s)`);
      }
    };

    if (isExcel) reader.readAsArrayBuffer(file);
    else reader.readAsText(file, "utf-8");
    e.target.value = "";
  };

  const openColumnMap = (rows: Record<string, any>[]) => {
    if (rows.length === 0) { toast.error("Arquivo sem dados."); return; }
    const cols = Object.keys(rows[0]);
    setSheetColumns(cols);
    setSheetRows(rows);
    setColumnMapping(autoDetectMapping(cols));
    setColumnMapOpen(true);
  };

  const handleConfirmColumnMap = () => {
    const phoneCol = Object.entries(columnMapping).find(([, v]) => v === "phone")?.[0];
    const nameCol = Object.entries(columnMapping).find(([, v]) => v === "name")?.[0];
    const emailCol = Object.entries(columnMapping).find(([, v]) => v === "email")?.[0];
    if (!phoneCol) { toast.error("Selecione a coluna de Telefone."); return; }

    const newContacts: ImportedContact[] = [];
    for (const row of sheetRows) {
      const phone = normalizePhone(rawToPhone(row[phoneCol]));
      if (phone.length < 10) continue;
      const name = nameCol ? String(row[nameCol] ?? "").trim() || `Contato ${phone.slice(-4)}` : `Contato ${phone.slice(-4)}`;
      const email = emailCol ? String(row[emailCol] ?? "").trim() : undefined;
      newContacts.push({ name, phone, email: email || undefined });
    }

    setColumnMapOpen(false);
    setContacts((prev) => dedup([...prev, ...newContacts]));
    toast.success(`${newContacts.length} contato(s) importado(s)`);
  };

  const dedup = (list: ImportedContact[]): ImportedContact[] => {
    const seen = new Set<string>();
    return list.filter((c) => {
      const key = c.phone.slice(-8);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const handleAddManual = () => {
    if (!newName.trim() || !newPhone.trim()) { toast.error("Preencha nome e telefone."); return; }
    const phone = normalizePhone(newPhone);
    if (phone.length < 10) { toast.error("Telefone inválido."); return; }
    setContacts((prev) => dedup([...prev, { name: newName.trim(), phone, email: newEmail.trim() || undefined }]));
    setNewName(""); setNewPhone(""); setNewEmail(""); setShowAdd(false);
    toast.success("Contato adicionado!");
  };

  const removeContact = (idx: number) => {
    setContacts((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSaveToDatabase = async () => {
    if (contacts.length === 0) { toast.error("Nenhum contato na lista."); return; }
    setImporting(true);

    try {
      const entries = contacts.map((c) => ({
        name: c.name,
        phone: c.phone.length <= 11 ? `55${c.phone}` : c.phone,
        email: c.email || null,
        origin: "import_list",
        user_id: user?.id,
      }));

      const BATCH = 50;
      let created = 0;
      for (let i = 0; i < entries.length; i += BATCH) {
        const batch = entries.slice(i, i + BATCH);
        const { data, error } = await supabase
          .from("leads")
          .upsert(batch, { onConflict: "phone,user_id", ignoreDuplicates: false })
          .select("id");
        if (error) throw error;
        created += (data?.length || 0);
      }

      queryClient.invalidateQueries({ queryKey: ["broadcast-leads"] });
      toast.success(`${created} lead(s) salvos no banco de dados!`);
      setContacts([]);
      setListName("");
    } catch (e: any) {
      toast.error(`Erro ao salvar: ${e.message}`);
    } finally {
      setImporting(false);
    }
  };

  const filteredContacts = useMemo(() => {
    if (!search) return contacts;
    const s = search.toLowerCase();
    return contacts.filter(
      (c) => c.name.toLowerCase().includes(s) || c.phone.includes(s) || c.email?.toLowerCase().includes(s)
    );
  }, [contacts, search]);

  const availableFields = [
    { value: "ignore", label: "— Ignorar" },
    { value: "phone", label: "📞 Telefone" },
    { value: "name", label: "👤 Nome" },
    { value: "email", label: "📧 Email" },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Users size={16} /> Importação de Contatos
          </h3>
          <p className="text-xs text-muted-foreground">
            Importe contatos de arquivos ou adicione manualmente para criar listas de disparo.
          </p>
        </div>
        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.txt,.xls,.xlsx"
            className="hidden"
            onChange={handleFileChange}
          />
          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
            <Upload size={14} className="mr-1" /> Importar Arquivo
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowAdd(true)}>
            <UserPlus size={14} className="mr-1" /> Adicionar Manual
          </Button>
        </div>
      </div>

      {/* Manual add form */}
      {showAdd && (
        <Card>
          <CardContent className="pt-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Nome *</Label>
                <Input placeholder="João Silva" value={newName} onChange={(e) => setNewName(e.target.value)} className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Telefone *</Label>
                <Input placeholder="5511999998888" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Email</Label>
                <Input placeholder="email@exemplo.com" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} className="h-8 text-sm" />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={() => setShowAdd(false)}>Cancelar</Button>
              <Button size="sm" onClick={handleAddManual}><Plus size={14} className="mr-1" /> Adicionar</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Contact list */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <FileSpreadsheet size={16} /> Lista de Contatos
              <Badge variant="secondary" className="text-xs">{contacts.length}</Badge>
            </CardTitle>
            {contacts.length > 0 && (
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive" onClick={() => setContacts([])}>
                  <Trash2 size={12} className="mr-1" /> Limpar
                </Button>
              </div>
            )}
          </div>
          {contacts.length > 0 && (
            <div className="relative mt-2">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar contato..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-8 text-sm"
              />
            </div>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {contacts.length === 0 ? (
            <div className="py-12 text-center">
              <Upload size={32} className="mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">
                Nenhum contato importado ainda.
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Importe um arquivo CSV, XLS ou XLSX, ou adicione manualmente.
              </p>
            </div>
          ) : (
            <ScrollArea className="max-h-[400px]">
              <div className="divide-y divide-border">
                {filteredContacts.map((c, idx) => (
                  <div key={idx} className="flex items-center gap-3 px-4 py-2.5">
                    <Avatar className="w-7 h-7">
                      <AvatarFallback className={cn(getAvatarColor(c.name), "text-white text-[10px]")}>
                        {getInitials(c.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium truncate">{c.name}</p>
                      <p className="text-[10px] text-muted-foreground">{c.phone}{c.email ? ` · ${c.email}` : ""}</p>
                    </div>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeContact(idx)}>
                      <X size={12} />
                    </Button>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Save to database */}
      {contacts.length > 0 && (
        <Button onClick={handleSaveToDatabase} disabled={importing} className="w-full" size="lg">
          {importing ? (
            <><Loader2 size={16} className="animate-spin" /> Salvando...</>
          ) : (
            <><Download size={16} /> Salvar {contacts.length} contato(s) como leads</>
          )}
        </Button>
      )}

      {/* Column mapping dialog */}
      <Dialog open={columnMapOpen} onOpenChange={setColumnMapOpen}>
        <DialogContent className="sm:max-w-lg" aria-describedby="import-col-desc">
          <DialogHeader>
            <DialogTitle>Mapear colunas do arquivo</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1" id="import-col-desc">
            <p className="text-xs text-muted-foreground">
              Selecione qual campo cada coluna representa. <strong>Telefone</strong> é obrigatório.
            </p>
            <div className="rounded-md border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground w-1/2">Coluna</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground w-1/2">Representa</th>
                  </tr>
                </thead>
                <tbody>
                  {sheetColumns.map((col, idx) => (
                    <tr key={col} className={cn("border-t", idx % 2 === 0 ? "bg-background" : "bg-muted/20")}>
                      <td className="px-3 py-2">
                        <p className="font-medium text-sm truncate max-w-[180px]">{col}</p>
                        {sheetRows[0] && (
                          <p className="text-[10px] text-muted-foreground truncate max-w-[180px]">
                            ex: {rawToPhone(sheetRows[0][col]) || String(sheetRows[0][col] ?? "—")}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <Select
                          value={columnMapping[col] ?? "ignore"}
                          onValueChange={(val) => setColumnMapping((prev) => ({ ...prev, [col]: val }))}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {availableFields.map((f) => (
                              <SelectItem key={f.value} value={f.value} className="text-xs">{f.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-muted-foreground">{sheetRows.length} linha(s) encontrada(s).</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setColumnMapOpen(false)}>Cancelar</Button>
            <Button onClick={handleConfirmColumnMap} disabled={!Object.values(columnMapping).includes("phone")}>
              Importar Contatos
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
