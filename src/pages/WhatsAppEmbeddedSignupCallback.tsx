import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function WhatsAppEmbeddedSignupCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const ran = useRef(false);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [message, setMessage] = useState<string>("Conectando sua conta WhatsApp via Meta…");
  const [details, setDetails] = useState<any>(null);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const code = params.get("code");
    const state = params.get("state");
    const error = params.get("error_description") || params.get("error");

    if (error) {
      setStatus("error");
      setMessage(error);
      return;
    }
    if (!code || !state) {
      setStatus("error");
      setMessage("Parâmetros ausentes no retorno da Meta.");
      return;
    }

    (async () => {
      const { data, error: invokeErr } = await supabase.functions.invoke(
        "whatsapp-embedded-signup-callback",
        { body: { code, state } }
      );
      if (invokeErr || (data as any)?.error) {
        setStatus("error");
        setMessage((data as any)?.error || invokeErr?.message || "Falha ao finalizar onboarding.");
        setDetails((data as any)?.details || null);
        return;
      }
      setStatus("ok");
      setDetails(data);
      setMessage(
        `Conectado! ${((data as any)?.provisioned || []).length} número(s) provisionado(s) via Embedded Signup.`
      );
      setTimeout(() => navigate("/"), 2500);
    })();
  }, [params, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardContent className="p-8 text-center space-y-4">
          {status === "loading" && <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />}
          {status === "ok" && <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto" />}
          {status === "error" && <AlertCircle className="h-10 w-10 text-destructive mx-auto" />}
          <h2 className="text-xl font-display font-semibold">WhatsApp Cloud API</h2>
          <p className="text-sm text-muted-foreground">{message}</p>
          {details && (
            <pre className="text-[10px] text-left bg-muted p-2 rounded max-h-48 overflow-auto">
              {JSON.stringify(details, null, 2)}
            </pre>
          )}
          {status !== "loading" && (
            <Button onClick={() => navigate("/")} variant="outline" className="w-full">
              Voltar
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
