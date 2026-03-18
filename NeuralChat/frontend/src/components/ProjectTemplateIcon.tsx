import type { CSSProperties } from "react";

interface ProjectTemplateIconProps {
  template: string;
  color?: string;
  className?: string;
}

function IconGlyph({ template }: { template: string }) {
  switch (template) {
    case "startup":
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M7 14L14.5 6.5L17.5 9.5L10 17H7V14Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M13 5L19 11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M8 18L6 20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case "study":
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M5 6.5C5 5.67 5.67 5 6.5 5H17.5C18.33 5 19 5.67 19 6.5V18L15.5 16.2L12 18L8.5 16.2L5 18V6.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M8 9H16M8 12H14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    case "code":
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M8.5 8L5 12L8.5 16M15.5 8L19 12L15.5 16M13.5 6L10.5 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "writing":
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M6 17.5V20H8.5L17 11.5L14.5 9L6 17.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M13.5 10L16 12.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M12 20H19" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    case "research":
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="11" cy="11" r="5.5" stroke="currentColor" strokeWidth="1.8" />
          <path d="M15.5 15.5L19 19" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M9.5 11H12.5M11 9.5V12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    case "job":
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="4" y="7" width="16" height="11" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
          <path d="M9 7V5.8C9 5.36 9.36 5 9.8 5H14.2C14.64 5 15 5.36 15 5.8V7" stroke="currentColor" strokeWidth="1.8" />
          <path d="M4 11H20" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 4L13.7 8.3L18 10L13.7 11.7L12 16L10.3 11.7L6 10L10.3 8.3L12 4Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M18 15L18.8 17.2L21 18L18.8 18.8L18 21L17.2 18.8L15 18L17.2 17.2L18 15Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
      );
  }
}

export function ProjectTemplateIcon({ template, color, className = "" }: ProjectTemplateIconProps) {
  return (
    <span
      className={`nc-project-template-icon ${className}`.trim()}
      style={color ? ({ ["--project-icon-color" as string]: color } as CSSProperties) : undefined}
      aria-hidden="true"
    >
      <IconGlyph template={template} />
    </span>
  );
}
