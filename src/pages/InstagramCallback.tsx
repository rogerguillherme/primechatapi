import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

const REDIRECT_URI = "https://primechatapi.lovable.app/auth/instagram/callback";

export default function InstagramCallbackPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [isProcessing, setIsProcessing] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const code = searchParams.get("code");
    if (code && !isProcessing) {
      setIsProcessing(true);
      searchParams.delete("code");
      setSearchParams(searchParams, { replace: true });

      (async () => {
        try {
          const { data, error } = await supabase.functions.invoke("instagram-oauth-callback", {
            body: { code, redirect_uri: REDIRECT_URI },
          });
          if (error) throw error;
          if (data?.error) throw new Error(data.error);
          toast.success(`Instagram conectado! @${data.instagram_username}`);
        } catch (err: any) {
          toast.error(err.message || "Erro ao conectar Instagram");
        } finally {
          setIsProcessing(false);
          navigate("/instagram?tab=settings", { replace: true });
        }
      })();
    }
  }, [searchParams]);

  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader />
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
          <p className="text-muted-foreground">Conectando Instagram...</p>
        </div>
      </div>
    </div>
  );
}
