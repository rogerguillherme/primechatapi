import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export function ThemeToggle({ collapsed }: { collapsed?: boolean }) {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);

  useEffect(() => {
    const saved = localStorage.getItem("theme");
    if (saved === "dark") setDark(true);
    else if (saved === "light") setDark(false);
    else if (window.matchMedia("(prefers-color-scheme: dark)").matches) setDark(true);
  }, []);

  return (
    <button
      onClick={() => setDark(!dark)}
      className={cn(
        "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
        "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent"
      )}
    >
      {dark ? <Sun size={18} /> : <Moon size={18} />}
      {!collapsed && <span>{dark ? "Modo Claro" : "Modo Escuro"}</span>}
    </button>
  );
}
