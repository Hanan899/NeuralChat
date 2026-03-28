import { useEffect, useMemo, useState } from "react";

import useRBAC from "@/hooks/useRBAC";
import { MembersPanel } from "@/components/settings/MembersPanel";

import type { RequestNamingContext } from "../api";
import type { UsageStatusResponse } from "../types";
import { CostDashboardContent } from "./CostDashboard";

export type SettingsSectionId = "general" | "cost" | "account" | "members";

interface SettingsPanelProps {
  getAuthToken: () => Promise<string | null>;
  naming?: RequestNamingContext;
  onShowToast: (message: string, tone?: "success" | "info" | "error") => void;
  onUsageStateChange?: (summary: UsageStatusResponse) => void;
  onOpenAccountSettings: () => void;
  onCloseSettings?: () => void;
  initialSection?: SettingsSectionId;
}

interface SettingsNavItem {
  id: SettingsSectionId;
  label: string;
  description: string;
}

const SETTINGS_NAV_ITEMS: SettingsNavItem[] = [
  { id: "general", label: "General", description: "Product behavior and workspace defaults" },
  { id: "cost", label: "Cost monitoring", description: "Budgets, usage, and spend tracking" },
  { id: "account", label: "Account", description: "Profile and sign-in settings" },
  { id: "members", label: "Members", description: "Workspace access, roles, and invitations" },
];

function SettingsSectionIcon({ sectionId }: { sectionId: SettingsSectionId }) {
  if (sectionId === "general") {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 4V7M12 17V20M4 12H7M17 12H20M6.3 6.3L8.5 8.5M15.5 15.5L17.7 17.7M17.7 6.3L15.5 8.5M8.5 15.5L6.3 17.7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="1.7" />
      </svg>
    );
  }

  if (sectionId === "cost") {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <ellipse cx="12" cy="12" rx="7.5" ry="9" stroke="currentColor" strokeWidth="1.7" />
        <path d="M12 7V17" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        <path
          d="M14.8 8.8C14.1 8.1 13.2 7.75 12.1 7.75C10.3 7.75 9.15 8.68 9.15 10.02C9.15 11.24 10.08 11.9 11.94 12.31C13.81 12.71 14.74 13.36 14.74 14.64C14.74 16 13.56 16.95 11.74 16.95C10.54 16.95 9.42 16.5 8.58 15.61"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (sectionId === "members") {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="9" cy="9" r="3" stroke="currentColor" strokeWidth="1.7" />
        <circle cx="16.5" cy="10.5" r="2.5" stroke="currentColor" strokeWidth="1.5" opacity="0.9" />
        <path d="M4.8 18.5C5.9 15.8 8.1 14.5 10.8 14.5C13.6 14.5 15.7 15.8 16.9 18.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M14.4 17.6C15.1 15.9 16.5 15 18.3 15C20 15 21.1 15.8 21.7 17.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.9" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="8.5" r="3.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M5.5 19C6.7 15.9 9.1 14.5 12 14.5C14.9 14.5 17.3 15.9 18.5 19" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export function SettingsPanel({
  getAuthToken,
  naming,
  onShowToast,
  onUsageStateChange,
  onOpenAccountSettings,
  onCloseSettings,
  initialSection = "general",
}: SettingsPanelProps) {
  const { isAtLeast } = useRBAC();
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(initialSection);
  const availableSections = useMemo(
    () => SETTINGS_NAV_ITEMS.filter((item) => item.id !== "members" || isAtLeast("owner")),
    [isAtLeast]
  );

  useEffect(() => {
    if (availableSections.some((item) => item.id === initialSection)) {
      setActiveSection(initialSection);
      return;
    }
    setActiveSection("general");
  }, [availableSections, initialSection]);

  const activeSectionMeta = useMemo(
    () => availableSections.find((item) => item.id === activeSection) ?? availableSections[0],
    [activeSection, availableSections]
  );

  return (
    <section className="nc-settings-page" aria-label="Settings" data-testid="settings-panel">
      <div className="nc-settings-panel__layout">
        <nav className="nc-settings-nav" aria-label="Settings sections">
          {availableSections.map((item) => {
            const isActive = item.id === activeSection;

            return (
              <button
                key={item.id}
                type="button"
                className={`nc-settings-nav__item ${isActive ? "nc-settings-nav__item--active" : ""}`}
                onClick={() => setActiveSection(item.id)}
              >
                <span className="nc-settings-nav__icon">
                  <SettingsSectionIcon sectionId={item.id} />
                </span>
                <span className="nc-settings-nav__copy">
                  <span className="nc-settings-nav__label">{item.label}</span>
                  <span className="nc-settings-nav__description">{item.description}</span>
                </span>
              </button>
            );
          })}
        </nav>

        <div className="nc-settings-panel__content">
          <div className="nc-settings-panel__section-header">
            <h3>{activeSectionMeta.label}</h3>
            <p>{activeSectionMeta.description}</p>
          </div>

          {activeSection === "general" ? (
            <section className="nc-settings-card">
              <h4>General controls</h4>
              <p>
                NeuralChat keeps quick conversation controls in the sidebar and the theme control in the top navigation bar.
                This settings area is where larger operational tools live.
              </p>
              <div className="nc-settings-card__list">
                <div className="nc-settings-card__list-item">
                  <strong>Theme</strong>
                  <span>Available from the top navigation bar so it stays one click away.</span>
                </div>
                <div className="nc-settings-card__list-item">
                  <strong>Chat tools</strong>
                  <span>Web search and Agent mode stay in the sidebar so they remain close to chat workflows.</span>
                </div>
              </div>
              <div className="nc-settings-card__actions">
                <button
                  type="button"
                  className="nc-settings-card__action"
                  onClick={() => {
                    onShowToast("Theme is available in the top bar.", "info");
                  }}
                >
                  Where is theme?
                </button>
                {onCloseSettings ? (
                  <button type="button" className="nc-settings-card__action" onClick={onCloseSettings}>
                    Return to chat
                  </button>
                ) : null}
              </div>
            </section>
          ) : null}

          {activeSection === "cost" ? (
            <section className="nc-settings-panel__cost">
              <CostDashboardContent
                getAuthToken={getAuthToken}
                naming={naming}
                onShowToast={onShowToast}
                onUsageStateChange={onUsageStateChange}
              />
            </section>
          ) : null}

          {activeSection === "account" ? (
            <section className="nc-settings-card">
              <h4>Account</h4>
              <p>Manage your profile, authentication session, and Clerk-hosted account details.</p>
              <div className="nc-settings-card__actions">
                <button type="button" className="nc-settings-card__action" onClick={onOpenAccountSettings}>
                  Open account settings
                </button>
                {onCloseSettings ? (
                  <button type="button" className="nc-settings-card__action" onClick={onCloseSettings}>
                    Done
                  </button>
                ) : null}
              </div>
            </section>
          ) : null}

          {activeSection === "members" ? <MembersPanel /> : null}
        </div>
      </div>
    </section>
  );
}
