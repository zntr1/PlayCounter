import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0f1014",
        surface: "#16181f",
        "surface-hover": "#1e212a",
        border: "#2a2e39",
        text: "#e7e9ee",
        "text-muted": "#9aa1ad",
        "text-faint": "#6b7280",
        accent: {
          DEFAULT: "#8b8cff",
          hover: "#a5a6ff",
          tint: "rgba(139, 140, 255, 0.14)",
          fg: "#0f1014",
        },
        success: {
          DEFAULT: "#4ade80",
          tint: "#14532d",
          border: "#22c55e",
        },
        warning: {
          DEFAULT: "#fbbf24",
          tint: "#78350f",
          border: "#f59e0b",
        },
        danger: {
          DEFAULT: "#f87171",
          solid: "#e11d48",
          "solid-hover": "#be123c",
          tint: "rgba(244, 63, 94, 0.12)",
          border: "rgba(244, 63, 94, 0.34)",
        },
        info: {
          DEFAULT: "#38bdf8",
          tint: "rgba(14, 165, 233, 0.12)",
          border: "rgba(14, 165, 233, 0.32)",
        },
        community: {
          DEFAULT: "#c4b5fd",
          tint: "#4c1d95",
          border: "#7c3aed",
        },
      },
      fontFamily: {
        sans: ["Inter", "Segoe UI", "system-ui", "sans-serif"],
      },
      boxShadow: {
        raised: "0 1px 2px rgba(0, 0, 0, 0.4), 0 4px 16px rgba(0, 0, 0, 0.25)",
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
