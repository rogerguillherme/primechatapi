import { useState, useEffect, useRef } from "react";
import { Search, X, User, FileText, MessageCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";

interface SearchResult {
  type: "lead" | "template";
  id: string;
  title: string;
  subtitle: string;
}

export function GlobalSearch() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (!query.trim() || query.length < 2) {
      setResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setLoading(true);
      const searchTerm = `%${query}%`;
      const [leadsRes, templatesRes] = await Promise.all([
        supabase.from("leads").select("id, name, phone").ilike("name", searchTerm).limit(5),
        supabase.from("chat_templates").select("id, name, template_name").ilike("name", searchTerm).limit(5),
      ]);

      const items: SearchResult[] = [];
      (leadsRes.data || []).forEach((l) =>
        items.push({ type: "lead", id: l.id, title: l.name, subtitle: l.phone })
      );
      (templatesRes.data || []).forEach((t) =>
        items.push({ type: "template", id: t.id, title: t.name, subtitle: t.template_name || "Template" })
      );
      setResults(items);
      setOpen(items.length > 0);
      setLoading(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const handleSelect = (r: SearchResult) => {
    setOpen(false);
    setQuery("");
    if (r.type === "lead") navigate("/whatsapp?tab=chat&leadId=" + r.id);
    if (r.type === "template") navigate("/whatsapp?tab=templates");
  };

  const icons = { lead: User, template: FileText };

  return (
    <div ref={ref} className="relative hidden sm:block">
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/40" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="Buscar leads, templates..."
          className="w-48 lg:w-64 h-8 pl-8 pr-8 rounded-lg bg-white/10 border-none text-xs text-white placeholder:text-white/40 focus:outline-none focus:ring-1 focus:ring-white/30"
        />
        {query && (
          <button onClick={() => { setQuery(""); setResults([]); setOpen(false); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 hover:text-white">
            <X size={12} />
          </button>
        )}
      </div>
      {open && (
        <div className="absolute top-full mt-1 left-0 w-80 bg-popover border border-border rounded-lg shadow-lg z-50 overflow-hidden">
          {results.map((r) => {
            const Icon = icons[r.type];
            return (
              <button
                key={r.type + r.id}
                onClick={() => handleSelect(r)}
                className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-muted/50 text-left transition-colors"
              >
                <Icon size={14} className="text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{r.title}</p>
                  <p className="text-xs text-muted-foreground truncate">{r.subtitle}</p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
