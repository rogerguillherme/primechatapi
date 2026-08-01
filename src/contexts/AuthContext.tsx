import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface AuthContextType {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  loading: true,
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();
  const lastUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    const currentUserId = session?.user?.id ?? null;
    if (lastUserIdRef.current !== null && lastUserIdRef.current !== currentUserId) {
      // User switched (login as different user, or signed out). Clear all cached queries.
      queryClient.clear();
    }
    lastUserIdRef.current = currentUserId;
  }, [session?.user?.id, queryClient]);


  useEffect(() => {
    let isMounted = true;

    const applySession = (nextSession: Session | null) => {
      if (!isMounted) return;
      setSession(nextSession);
      setLoading(false);
    };

    const clearLocalSession = async () => {
      await supabase.auth.signOut({ scope: "local" });
    };

    const initializeAuth = async () => {
      try {
        const {
          data: { session: storedSession },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (sessionError) {
          console.error("Failed to restore auth session", sessionError);
          await clearLocalSession();
          applySession(null);
          return;
        }

        if (!storedSession) {
          applySession(null);
          return;
        }

        // Trust the stored session right away so the app can render/query,
        // then validate it in the background (never block the UI on network).
        applySession(storedSession);

        try {
          const validation = await Promise.race([
            supabase.auth.getUser(),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
          ]);
          if (!validation) return; // timed out — keep the stored session
          const { data, error: userError } = validation as Awaited<ReturnType<typeof supabase.auth.getUser>>;
          if (userError?.status === 401 || userError?.status === 403) {
            console.warn("Clearing invalid local auth session", userError);
            await clearLocalSession();
            applySession(null);
          } else if (data?.user) {
            void data.user;
          }
        } catch (validationError) {
          // Network hiccup — keep the stored session instead of logging the user out.
          console.warn("Auth validation skipped", validationError);
        }
      } catch (error) {
        console.error("Unexpected auth bootstrap error", error);
        await clearLocalSession();
        applySession(null);
      }
    };


    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === "INITIAL_SESSION") return;
      applySession(nextSession);
    });

    void initializeAuth();

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
