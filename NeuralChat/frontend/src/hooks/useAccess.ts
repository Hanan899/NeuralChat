import { useAuth, useUser } from "@clerk/clerk-react";
import { useEffect, useMemo, useState } from "react";

import { getMe } from "../api";
import type { EffectiveAccessProfile, AppFeaturePermission, AppRole } from "../access";
import { ROLE_LABELS, isAppFeaturePermission, isAppRole } from "../access";
import { useApiQuery } from "./useApi";

const DEFAULT_ACCESS: EffectiveAccessProfile = {
  role: "user",
  role_label: ROLE_LABELS.user,
  is_owner: false,
  feature_overrides: {},
  effective_features: ["chat:create", "usage:read"],
  usage_limits: {
    daily_limit_usd: 1,
    monthly_limit_usd: 30,
  },
};

export interface UseAccessResult {
  role: AppRole;
  roleLabel: string;
  access: EffectiveAccessProfile;
  can: (feature: AppFeaturePermission) => boolean;
  isOwner: boolean;
  isLoaded: boolean;
  isFetching: boolean;
  userId: string | null;
  refetch: () => Promise<unknown>;
}

export function useAccess(): UseAccessResult {
  const { getToken, userId } = useAuth();
  const { isLoaded: isUserLoaded } = useUser();
  const [authToken, setAuthToken] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function resolveToken() {
      if (!userId) {
        setAuthToken(null);
        return;
      }
      const token = await getToken();
      if (!cancelled) {
        setAuthToken(token);
      }
    }

    void resolveToken();
    return () => {
      cancelled = true;
    };
  }, [getToken, userId]);

  const meQuery = useApiQuery(["me", userId ?? "anonymous"], "/api/me", {
    authToken,
    enabled: isUserLoaded && Boolean(userId) && Boolean(authToken),
    queryFn: async () => {
      if (!authToken) {
        throw new Error("Authentication token unavailable. Please sign in again.");
      }
      return await getMe(authToken);
    },
  });

  const access = useMemo<EffectiveAccessProfile>(() => {
    const rawAccess = meQuery.data?.access;
    if (!rawAccess || !isAppRole(rawAccess.role)) {
      return DEFAULT_ACCESS;
    }

    const effectiveFeatures = Array.isArray(rawAccess.effective_features)
      ? rawAccess.effective_features.filter(isAppFeaturePermission)
      : DEFAULT_ACCESS.effective_features;

    return {
      role: rawAccess.role,
      role_label: rawAccess.role_label || ROLE_LABELS[rawAccess.role],
      is_owner: rawAccess.is_owner === true || rawAccess.role === "owner",
      feature_overrides: rawAccess.feature_overrides ?? {},
      effective_features: effectiveFeatures,
      usage_limits: rawAccess.usage_limits ?? DEFAULT_ACCESS.usage_limits,
      email: rawAccess.email ?? null,
      display_name: rawAccess.display_name ?? null,
      seeded_owner: rawAccess.seeded_owner === true,
    };
  }, [meQuery.data?.access]);

  return useMemo(
    () => ({
      role: access.role,
      roleLabel: access.role_label,
      access,
      can: (feature: AppFeaturePermission) => access.is_owner || access.effective_features.includes(feature),
      isOwner: access.is_owner,
      isLoaded: isUserLoaded && (!userId || (!meQuery.isLoading && !meQuery.isFetching)),
      isFetching: meQuery.isFetching,
      userId: userId ?? null,
      refetch: async () => await meQuery.refetch(),
    }),
    [access, isUserLoaded, meQuery, userId]
  );
}
