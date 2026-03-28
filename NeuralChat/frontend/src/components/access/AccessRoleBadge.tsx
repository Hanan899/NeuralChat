import type { AppRole } from "../../access";
import { ROLE_COLORS, ROLE_LABELS } from "../../access";

interface AccessRoleBadgeProps {
  role: AppRole;
}

export function AccessRoleBadge({ role }: AccessRoleBadgeProps) {
  const palette = ROLE_COLORS[role];

  return (
    <span
      className="nc-access-role-badge"
      style={{
        background: palette.bg,
        color: palette.text,
        borderColor: palette.border,
      }}
    >
      {ROLE_LABELS[role]}
    </span>
  );
}
