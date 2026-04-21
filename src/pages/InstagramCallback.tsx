import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { Loader2, Instagram, Users, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

const REDIRECT_URI = "https://primechatapi.lovable.app/auth/instagram/callback";

interface IgAccount {
  ig_user_id: string;
  ig_username: string;
  ig_avatar?: string;
  ig_followers?: number;
  page_id: string;
  page_name: string;
}

export default function InstagramCallbackPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [isProcessing, setIsProcessing] = useState(false);
  const [accounts, setAccounts] = useState<IgAccount[] | null>(null);
  const [userToken, setUserToken] = useState<string | null>(null);
  const [selecting, setSelecting] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const code = searchParams.get("code");
    if (code && !isProcessing && !accounts) {
      setIsProcessing(true);
      searchParams.delete("code");
      searchParams.delete("state");
      setSearchParams(searchParams, { replace: true });

      (async () => {
        try {
          const { data, error } = await supabase.functions.invoke("instagram-oauth-callback", {
            body: { code, redirect_uri: REDIRECT_URI },
          });
          if (error) throw error;
          if (data?.error) throw new Error(data.error);

          if (data?.multiple) {
            setAccounts(data.accounts);
            setUserToken(data.user_access_token);
            setIsProcessing(false);
            return;
          }

          toast.success(`Instagram conectado! @${data.instagram_username}`);
          navigate("/instagram?tab=metrics", { replace: true });
        } catch (err: any) {
          toast.error(err.message || "Erro ao conectar Instagram");
          navigate("/instagram?tab=settings", { replace: true });
        }
      })();
    }
  }, [searchParams]);

  const handleSelectAccount = async (acc: IgAccount) => {
    if (!userToken) return;
    setSelecting(acc.ig_user_id);
    try {
      const { data, error } = await supabase.functions.invoke("instagram-oauth-callback", {
        body: { selected_ig_user_id: acc.ig_user_id, user_access_token: userToken },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`Instagram conectado! @${data.instagram_username}`);
      navigate("/instagram?tab=metrics", { replace: true });
    } catch (err: any) {
      toast.error(err.message || "Erro ao vincular conta");
      setSelecting(null);
    }
  };

  if (accounts && accounts.length > 0) {
    return (
      <div className="min-h-screen flex flex-col">
        <AppHeader />
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-2xl w-full space-y-6">
            <div className="text-center space-y-2">
              <div className="inline-flex w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 items-center justify-center">
                <Instagram className="h-6 w-6 text-purple-500" />
              </div>
              <h1 className="text-2xl font-bold">Escolha qual conta conectar</h1>
              <p className="text-muted-foreground text-sm">
                Encontramos {accounts.length} contas Instagram Business no seu Facebook. Selecione a que deseja vincular a este login.
              </p>
            </div>

            <div className="grid gap-3">
              {accounts.map((acc) => (
                <Card
                  key={acc.ig_user_id}
                  className="p-4 hover:border-purple-500/40 hover:shadow-md transition cursor-pointer"
                  onClick={() => !selecting && handleSelectAccount(acc)}
                >
                  <div className="flex items-center gap-4">
                    {acc.ig_avatar ? (
                      <img src={acc.ig_avatar} alt={acc.ig_username} className="w-12 h-12 rounded-full object-cover" />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                        <Instagram className="h-6 w-6 text-muted-foreground" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold truncate">@{acc.ig_username || "—"}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        Página: {acc.page_name}
                        {typeof acc.ig_followers === "number" && (
                          <span className="ml-2 inline-flex items-center gap-1">
                            <Users className="h-3 w-3" />
                            {acc.ig_followers.toLocaleString("pt-BR")}
                          </span>
                        )}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      disabled={!!selecting}
                      className="gap-1 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
                    >
                      {selecting === acc.ig_user_id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <Check className="h-4 w-4" /> Conectar
                        </>
                      )}
                    </Button>
                  </div>
                </Card>
              ))}
            </div>

            <p className="text-xs text-center text-muted-foreground">
              Para conectar outra conta no mesmo login, repita o processo após esta vinculação.
            </p>
          </div>
        </div>
      </div>
    );
  }

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
