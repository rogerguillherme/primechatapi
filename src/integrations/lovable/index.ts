// Migrado do Lovable Cloud para o Supabase Auth nativo.
// Mantém a interface `lovable.auth.signInWithOAuth(...)` para não alterar os callers.
import { supabase } from "../supabase/client";

type SignInOptions = {
  redirect_uri?: string;
  extraParams?: Record<string, string>;
};

export const lovable = {
  auth: {
    signInWithOAuth: async (provider: "google" | "apple", opts?: SignInOptions) => {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo:
            opts?.redirect_uri ??
            (typeof window !== "undefined" ? window.location.origin : undefined),
          queryParams: opts?.extraParams,
        },
      });
      if (error) return { error };
      return { redirected: true, data };
    },
  },
};
