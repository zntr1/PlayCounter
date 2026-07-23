import type { Config } from "tailwindcss";

// Theme-aware color: reads an RGB triple from a CSS variable defined in
// styles.css so Tailwind opacity modifiers (bg-surface/50) keep working.
const rgb = (variable: string) => `rgb(var(${variable}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: rgb("--color-bg"),
        surface: rgb("--color-surface"),
        "surface-hover": rgb("--color-surface-hover"),
        border: rgb("--color-border"),
        text: rgb("--color-text"),
        "text-muted": rgb("--color-text-muted"),
        "text-faint": rgb("--color-text-faint"),
        accent: {
          DEFAULT: rgb("--color-accent"),
          hover: rgb("--color-accent-hover"),
          tint: "var(--color-accent-tint)",
          fg: rgb("--color-accent-fg"),
        },
        success: {
          DEFAULT: rgb("--color-success"),
          tint: rgb("--color-success-tint"),
          border: rgb("--color-success-border"),
        },
        warning: {
          DEFAULT: rgb("--color-warning"),
          tint: rgb("--color-warning-tint"),
          border: rgb("--color-warning-border"),
        },
        danger: {
          DEFAULT: rgb("--color-danger"),
          solid: rgb("--color-danger-solid"),
          "solid-hover": rgb("--color-danger-solid-hover"),
          tint: "var(--color-danger-tint)",
          border: "var(--color-danger-border)",
        },
        info: {
          DEFAULT: rgb("--color-info"),
          tint: "var(--color-info-tint)",
          border: "var(--color-info-border)",
        },
        community: {
          DEFAULT: rgb("--color-community"),
          tint: rgb("--color-community-tint"),
          border: rgb("--color-community-border"),
        },
      },
      fontFamily: {
        sans: ["Inter", "Segoe UI", "system-ui", "sans-serif"],
      },
      boxShadow: {
        raised: "var(--shadow-raised)",
      },
      keyframes: {
        pop: {
          "0%": { transform: "scale(1)" },
          "40%": { transform: "scale(1.4)" },
          "100%": { transform: "scale(1)" },
        },
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "toast-in": {
          "0%": { opacity: "0", transform: "translateX(16px) scale(0.98)" },
          "100%": { opacity: "1", transform: "translateX(0) scale(1)" },
        },
        "toast-out": {
          "0%": { opacity: "1", transform: "translateX(0) scale(1)" },
          "100%": { opacity: "0", transform: "translateX(16px) scale(0.98)" },
        },
      },
      animation: {
        pop: "pop 320ms ease-out",
        "fade-in": "fade-in 200ms ease-out",
        "toast-in": "toast-in 220ms ease-out",
        "toast-out": "toast-out 260ms ease-in forwards",
      },
      gridTemplateColumns: {
        14: "repeat(14, minmax(0, 1fr))",
      },
    },
  },
  plugins: [],
} satisfies Config;
