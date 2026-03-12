/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        nc: {
          bgPrimary: "var(--bg-primary)",
          bgSecondary: "var(--bg-secondary)",
          bgInput: "var(--bg-input)",
          bgHover: "var(--bg-hover)",
          userBubble: "var(--bg-user-bubble)",
          codeBlock: "var(--bg-code-block)",
          accent: "var(--accent-primary)",
          accentHover: "var(--accent-hover)",
          textPrimary: "var(--text-primary)",
          textSecondary: "var(--text-secondary)",
          textHeading: "var(--text-heading)",
          borderSubtle: "var(--border-subtle)",
          borderInput: "var(--border-input)"
        }
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)"
      }
    }
  },
  plugins: []
};
