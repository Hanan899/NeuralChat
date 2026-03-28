import React from "react";

import useRBAC from "@/hooks/useRBAC";
import { ROLE_COLORS, ROLE_LABELS } from "@/shared/roles";
import type { Permission, Role } from "@/shared/roles";

interface RoleGateProps {
  minimum: Role;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

export function RoleGate({ minimum, fallback = null, children }: RoleGateProps) {
  const { isLoaded, isAtLeast } = useRBAC();

  if (!isLoaded) {
    return null;
  }

  if (isAtLeast(minimum)) {
    return <>{children}</>;
  }

  return <>{fallback}</>;
}

interface PermissionGateProps {
  permission: Permission;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

export function PermissionGate({ permission, fallback = null, children }: PermissionGateProps) {
  const { isLoaded, can } = useRBAC();

  if (!isLoaded) {
    return null;
  }

  if (can(permission)) {
    return <>{children}</>;
  }

  return <>{fallback}</>;
}

interface RoleBadgeProps {
  role: Role;
  size?: "sm" | "md";
}

export function RoleBadge({ role, size = "md" }: RoleBadgeProps) {
  const palette = ROLE_COLORS[role];
  const isSmall = size === "sm";

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "9999px",
        border: `1px solid ${palette.border}`,
        background: palette.bg,
        color: palette.text,
        fontSize: isSmall ? "11px" : "12px",
        padding: isSmall ? "4px 8px" : "4px 12px",
        fontWeight: 600,
        lineHeight: 1.2,
        whiteSpace: "nowrap",
      }}
    >
      {ROLE_LABELS[role]}
    </span>
  );
}

interface AccessDeniedProps {
  message?: string;
  requiredRole?: Role;
}

export function AccessDenied({
  message = "You do not have permission to access this area.",
  requiredRole,
}: AccessDeniedProps) {
  const { roleLabel } = useRBAC();

  return (
    <div
      style={{
        width: "100%",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        padding: "24px 16px",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "520px",
          padding: "24px",
          borderRadius: "24px",
          border: "1px solid var(--color-border-secondary)",
          background: "var(--color-background-secondary)",
          color: "var(--color-text-primary)",
          textAlign: "center",
          boxShadow: "0 16px 40px rgba(15, 23, 42, 0.08)",
        }}
      >
        <div style={{ fontSize: "32px", lineHeight: 1, marginBottom: "12px" }}>🔒</div>
        <h3
          style={{
            margin: 0,
            fontSize: "22px",
            lineHeight: 1.2,
            fontWeight: 700,
            color: "var(--color-text-primary)",
          }}
        >
          Access denied
        </h3>
        <p
          style={{
            margin: "12px 0 0",
            fontSize: "14px",
            lineHeight: 1.6,
            color: "var(--color-text-secondary)",
          }}
        >
          {message}
        </p>
        {requiredRole ? (
          <p
            style={{
              margin: "14px 0 0",
              fontSize: "14px",
              lineHeight: 1.6,
              color: "var(--color-text-secondary)",
            }}
          >
            This area requires the <strong>{ROLE_LABELS[requiredRole]}</strong> role. Your current role is{" "}
            <strong>{roleLabel}</strong>.
          </p>
        ) : null}
        <p
          style={{
            margin: "16px 0 0",
            fontSize: "13px",
            lineHeight: 1.5,
            color: "var(--color-text-tertiary)",
          }}
        >
          Contact your workspace owner to request access.
        </p>
      </div>
    </div>
  );
}
