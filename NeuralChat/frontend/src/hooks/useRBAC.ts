import { useUser } from "@clerk/clerk-react";
import { useMemo } from "react";

import {
  type Permission,
  type Role,
  DEFAULT_ROLE,
  ROLE_DESCRIPTIONS,
  ROLE_HIERARCHY,
  ROLE_LABELS,
  hasMinimumRole,
  hasPermission,
} from "@/shared/roles";

export { DEFAULT_ROLE, ROLE_DESCRIPTIONS, ROLE_LABELS };
export type { Permission, Role };

export interface RBACContext {
  role: Role;
  roleLabel: string;
  can: (permission: Permission) => boolean;
  isAtLeast: (minimum: Role) => boolean;
  isSuperAdmin: boolean;
  isOwner: boolean;
  isMember: boolean;
  isViewer: boolean;
  isGuest: boolean;
  isLoaded: boolean;
}

function isKnownRole(value: unknown): value is Role {
  return typeof value === "string" && value in ROLE_HIERARCHY;
}

export function useRBAC(): RBACContext {
  const { user, isLoaded } = useUser();

  const role = useMemo<Role>(() => {
    const candidateRole = user?.publicMetadata?.role;
    return isKnownRole(candidateRole) ? candidateRole : DEFAULT_ROLE;
  }, [user]);

  return useMemo<RBACContext>(() => {
    const isSuperAdmin = role === "super_admin";
    const isOwner = ROLE_HIERARCHY[role] >= ROLE_HIERARCHY.owner;
    const isMember = ROLE_HIERARCHY[role] >= ROLE_HIERARCHY.member;
    const isViewer = ROLE_HIERARCHY[role] >= ROLE_HIERARCHY.viewer;
    const isGuest = role === "guest";

    return {
      role,
      roleLabel: ROLE_LABELS[role],
      can: (permission: Permission) => hasPermission(role, permission),
      isAtLeast: (minimum: Role) => hasMinimumRole(role, minimum),
      isSuperAdmin,
      isOwner,
      isMember,
      isViewer,
      isGuest,
      isLoaded,
    };
  }, [isLoaded, role]);
}
