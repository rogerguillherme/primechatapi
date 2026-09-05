import { useAuth } from "@/contexts/AuthContext";
import type { PlanTier } from "@/components/premium/PlanLock";

const ADMIN_EMAIL = "admin@primechat.com";

const tierOrder: Record<PlanTier, number> = {
  starter: 0,
  pro: 1,
  scale: 2,
  white_label: 3,
};

/**
 * Returns the current user's plan tier and a helper to check feature access.
 * The super-admin (`admin@primechat.com`) always gets `white_label` — every
 * premium feature is unlocked.
 */
export function useUserPlan() {
  const { user, loading } = useAuth();

  const isSuperAdmin = user?.email === ADMIN_EMAIL;
  const plan: PlanTier = isSuperAdmin ? "white_label" : "starter";

  const hasAccess = (required: PlanTier) =>
    tierOrder[plan] >= tierOrder[required];

  const isLocked = (required: PlanTier) => !hasAccess(required);

  return { plan, isSuperAdmin, hasAccess, isLocked, loading };
}
