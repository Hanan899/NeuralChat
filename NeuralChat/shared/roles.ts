export const ROLES = {
  SUPER_ADMIN: "super_admin",
  OWNER: "owner",
  MEMBER: "member",
  VIEWER: "viewer",
  GUEST: "guest",
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const ROLE_HIERARCHY: Record<Role, number> = {
  super_admin: 100,
  owner: 80,
  member: 50,
  viewer: 20,
  guest: 10,
};

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: "Super Admin",
  owner: "Owner",
  member: "Member",
  viewer: "Viewer",
  guest: "Guest",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  super_admin: "Has platform-wide authority to manage workspaces, billing, members, and administrative controls.",
  owner: "Leads a workspace and can manage projects, members, memory, files, usage, and billing settings.",
  member: "Actively works inside the workspace and can create chats, projects, uploads, and run agents.",
  viewer: "Can review workspace content and usage without making changes to projects or memory.",
  guest: "Has limited read-only access for lightweight collaboration inside shared workspace areas.",
};

export const ROLE_COLORS: Record<Role, { bg: string; text: string; border: string }> = {
  super_admin: {
    bg: "#FFF7E6",
    text: "#B45309",
    border: "#F6C86B",
  },
  owner: {
    bg: "#F3EFFF",
    text: "#6D28D9",
    border: "#C4B5FD",
  },
  member: {
    bg: "#ECFDF3",
    text: "#15803D",
    border: "#86EFAC",
  },
  viewer: {
    bg: "#EFF6FF",
    text: "#1D4ED8",
    border: "#93C5FD",
  },
  guest: {
    bg: "#F4F4F5",
    text: "#52525B",
    border: "#D4D4D8",
  },
};

export type Permission =
  | "chat:create"
  | "chat:read"
  | "project:create"
  | "project:read"
  | "project:delete"
  | "agent:run"
  | "file:upload"
  | "file:read"
  | "memory:read"
  | "memory:write"
  | "member:manage"
  | "billing:read"
  | "billing:manage"
  | "usage:read"
  | "usage:manage"
  | "user:impersonate"
  | "platform:manage";

const ALL_PERMISSIONS: Permission[] = [
  "chat:create",
  "chat:read",
  "project:create",
  "project:read",
  "project:delete",
  "agent:run",
  "file:upload",
  "file:read",
  "memory:read",
  "memory:write",
  "member:manage",
  "billing:read",
  "billing:manage",
  "usage:read",
  "usage:manage",
  "user:impersonate",
  "platform:manage",
];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  super_admin: [...ALL_PERMISSIONS],
  owner: ALL_PERMISSIONS.filter(
    (permission) => permission !== "user:impersonate" && permission !== "platform:manage"
  ),
  member: [
    "chat:create",
    "chat:read",
    "project:create",
    "project:read",
    "agent:run",
    "file:upload",
    "file:read",
    "memory:read",
    "memory:write",
    "usage:read",
  ],
  viewer: [
    "chat:read",
    "project:read",
    "file:read",
    "usage:read",
  ],
  guest: [
    "chat:read",
    "project:read",
    "file:read",
  ],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function hasMinimumRole(userRole: Role, minimumRole: Role): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[minimumRole];
}

export const DEFAULT_ROLE: Role = "member";
