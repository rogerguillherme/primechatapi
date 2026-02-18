import { MessageCircle } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";

export function AppHeader() {
  return (
    <header className="gradient-header text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-whatsapp/20 flex items-center justify-center">
              <MessageCircle size={20} className="text-whatsapp" />
            </div>
            <div>
              <h1 className="text-base font-display font-bold tracking-tight">Meno API</h1>
              <p className="text-[11px] text-white/50 leading-none">WhatsApp Business Platform</p>
            </div>
          </div>
          <ThemeToggle collapsed={true} />
        </div>
      </div>
    </header>);

}