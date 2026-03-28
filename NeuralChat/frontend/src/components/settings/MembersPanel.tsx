import React, { useState } from "react";

import useRBAC from "@/hooks/useRBAC";
import { AccessDenied, RoleBadge, RoleGate } from "@/components/auth/RoleGate";
import {
  ROLE_COLORS,
  ROLE_DESCRIPTIONS,
  ROLE_HIERARCHY,
  ROLE_LABELS,
  ROLES,
  type Role,
} from "@/shared/roles";

type MemberItem = {
  id: string;
  name: string;
  email: string;
  role: Role;
  joinedAt: string;
};

const MOCK_CURRENT_USER_ID = "user-owner";

const MOCK_MEMBERS: MemberItem[] = [
  { id: "user-owner", name: "Abdul Hanan", email: "owner@neuralchat.app", role: ROLES.OWNER, joinedAt: "Joined Mar 12, 2026" },
  { id: "user-member-1", name: "Sarah Chen", email: "sarah@neuralchat.app", role: ROLES.MEMBER, joinedAt: "Joined Mar 16, 2026" },
  { id: "user-member-2", name: "Ali Raza", email: "ali@neuralchat.app", role: ROLES.MEMBER, joinedAt: "Joined Mar 18, 2026" },
  { id: "user-viewer", name: "Emma Stone", email: "emma@neuralchat.app", role: ROLES.VIEWER, joinedAt: "Joined Mar 21, 2026" },
  { id: "user-guest", name: "Noah Kim", email: "noah@neuralchat.app", role: ROLES.GUEST, joinedAt: "Joined Mar 24, 2026" },
];

function RoleInfoGrid() {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
        gap: "8px",
      }}
    >
      {Object.values(ROLES).map((role) => (
        <div
          key={role}
          style={{
            padding: "10px 12px",
            borderRadius: "8px",
            border: `1px solid ${ROLE_COLORS[role].border}`,
            background: ROLE_COLORS[role].bg,
            display: "flex",
            flexDirection: "column",
            gap: "8px",
          }}
        >
          <RoleBadge role={role} />
          <p
            style={{
              margin: 0,
              fontSize: "13px",
              lineHeight: 1.55,
              color: "var(--color-text-secondary)",
            }}
          >
            {ROLE_DESCRIPTIONS[role]}
          </p>
        </div>
      ))}
    </div>
  );
}

function RoleSelector({
  currentRole,
  maxRole,
  onChange,
}: {
  currentRole: Role;
  maxRole: Role;
  onChange: (r: Role) => void;
}) {
  return (
    <select
      value={currentRole}
      onChange={(event) => onChange(event.target.value as Role)}
      style={{
        minWidth: "152px",
        padding: "8px 10px",
        borderRadius: "8px",
        border: "1px solid var(--color-border-secondary)",
        background: "var(--color-background-secondary)",
        color: "var(--color-text-primary)",
        fontSize: "13px",
        fontWeight: 500,
        outline: "none",
      }}
    >
      {Object.values(ROLES).map((role) => {
        const isUnavailable = ROLE_HIERARCHY[role] >= ROLE_HIERARCHY[maxRole];
        return (
          <option key={role} value={role} disabled={isUnavailable}>
            {ROLE_LABELS[role]}{isUnavailable ? " (unavailable)" : ""}
          </option>
        );
      })}
    </select>
  );
}

function MemberRow({
  member,
  myRole,
  onRoleChange,
  onRemove,
}: {
  member: MemberItem;
  myRole: Role;
  onRoleChange: (memberId: string, nextRole: Role) => void;
  onRemove: (memberId: string) => void;
}) {
  const [isHovering, setIsHovering] = useState(false);
  const rolePalette = ROLE_COLORS[member.role];
  const canEdit =
    member.id !== MOCK_CURRENT_USER_ID &&
    ROLE_HIERARCHY[myRole] > ROLE_HIERARCHY[member.role];

  return (
    <div
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "12px",
        padding: "12px 14px",
        borderRadius: "8px",
        border: `1px solid ${isHovering ? rolePalette.border : "var(--color-border-secondary)"}`,
        background: "var(--color-background-secondary)",
        transition: "border-color 140ms ease, transform 140ms ease",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0, flex: 1 }}>
        <div
          style={{
            width: "36px",
            height: "36px",
            borderRadius: "9999px",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background: rolePalette.bg,
            color: rolePalette.text,
            border: `1px solid ${rolePalette.border}`,
            fontSize: "14px",
            fontWeight: 700,
            flex: "0 0 auto",
          }}
        >
          {member.name.trim().charAt(0).toUpperCase()}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 }}>
          <span
            style={{
              fontSize: "14px",
              fontWeight: 600,
              color: "var(--color-text-primary)",
            }}
          >
            {member.name}
          </span>
          <span
            style={{
              fontSize: "12px",
              color: "var(--color-text-secondary)",
              overflowWrap: "anywhere",
            }}
          >
            {member.email}
          </span>
          <span
            style={{
              fontSize: "12px",
              color: "var(--color-text-tertiary)",
            }}
          >
            {member.joinedAt}
          </span>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", justifyContent: "flex-end" }}>
        {canEdit ? (
          <>
            <RoleSelector currentRole={member.role} maxRole={myRole} onChange={(nextRole) => onRoleChange(member.id, nextRole)} />
            <button
              type="button"
              onClick={() => onRemove(member.id)}
              style={{
                border: "1px solid transparent",
                background: "transparent",
                color: "#c24141",
                fontSize: "12px",
                fontWeight: 600,
                padding: "6px 8px",
                borderRadius: "8px",
                cursor: "pointer",
              }}
            >
              Remove
            </button>
          </>
        ) : (
          <RoleBadge role={member.role} />
        )}
      </div>
    </div>
  );
}

function InviteForm({ myRole }: { myRole: Role }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>(ROLES.MEMBER);
  const [successText, setSuccessText] = useState("");

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim()) {
      return;
    }

    // TODO: replace with POST /members/invite once backend member invitation wiring is active.
    console.log("Invite member", { email: email.trim(), role });
    setSuccessText("Invitation sent ✓");
    setEmail("");
    setRole(ROLES.MEMBER);
    window.setTimeout(() => {
      setSuccessText("");
    }, 2500);
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "10px",
        padding: "14px",
        borderRadius: "12px",
        background: "var(--color-background-secondary)",
        border: "1px solid var(--color-border-secondary)",
      }}
    >
      <input
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="colleague@company.com"
        style={{
          flex: "1 1 240px",
          minWidth: "220px",
          padding: "10px 12px",
          borderRadius: "8px",
          border: "1px solid var(--color-border-secondary)",
          background: "var(--color-background-primary, var(--color-background-secondary))",
          color: "var(--color-text-primary)",
          fontSize: "14px",
          outline: "none",
        }}
      />

      <RoleSelector currentRole={role} maxRole={myRole} onChange={setRole} />

      <button
        type="submit"
        style={{
          padding: "10px 14px",
          borderRadius: "10px",
          border: "1px solid transparent",
          background: "linear-gradient(135deg, var(--accent-primary, #7f77dd), var(--accent-secondary, #9f97ff))",
          color: "#fff",
          fontSize: "13px",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Send invite
      </button>

      {successText ? (
        <span
          style={{
            width: "100%",
            fontSize: "13px",
            color: "#15803D",
          }}
        >
          {successText}
        </span>
      ) : null}
    </form>
  );
}

export function MembersPanel() {
  const { role, roleLabel } = useRBAC();
  const [members, setMembers] = useState<MemberItem[]>(MOCK_MEMBERS);

  function handleRoleChange(memberId: string, nextRole: Role) {
    setMembers((previous) =>
      previous.map((member) => (member.id === memberId ? { ...member, role: nextRole } : member))
    );
  }

  function handleRemove(memberId: string) {
    setMembers((previous) => previous.filter((member) => member.id !== memberId));
  }

  return (
    <RoleGate minimum="owner" fallback={<AccessDenied requiredRole="owner" />}>
      <section
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "18px",
        }}
      >
        <header style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <h4
            style={{
              margin: 0,
              fontSize: "28px",
              lineHeight: 1.15,
              color: "var(--color-text-primary)",
            }}
          >
            Members
          </h4>
          <p
            style={{
              margin: 0,
              fontSize: "15px",
              lineHeight: 1.6,
              color: "var(--color-text-secondary)",
            }}
          >
            Manage who can access this workspace, what role they hold, and how much control they have over projects, files, and usage settings.
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            <RoleBadge role={role} />
            <span style={{ fontSize: "13px", color: "var(--color-text-tertiary)" }}>
              Signed in as {roleLabel}
            </span>
          </div>
        </header>

        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <h5 style={{ margin: 0, fontSize: "16px", color: "var(--color-text-primary)" }}>Role reference</h5>
          <RoleInfoGrid />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <h5 style={{ margin: 0, fontSize: "16px", color: "var(--color-text-primary)" }}>Invite a new member</h5>
          <InviteForm myRole={role} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <h5 style={{ margin: 0, fontSize: "16px", color: "var(--color-text-primary)" }}>
            Current members ({members.length})
          </h5>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {/* TODO: replace mock members with React Query data from the backend members endpoints. */}
            {members.map((member) => (
              <MemberRow
                key={member.id}
                member={member}
                myRole={role}
                onRoleChange={handleRoleChange}
                onRemove={handleRemove}
              />
            ))}
          </div>
        </div>
      </section>
    </RoleGate>
  );
}

export default MembersPanel;
