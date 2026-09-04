/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["IBM Plex Sans", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "monospace"],
      },
      colors: {
        // Operations-room instrument palette. Not the app's decoration —
        // ink is the base the map and its hazard-zone colors sit on.
        ink: {
          950: "#0A0E13",
          900: "#0F151C",
          800: "#141B23",
          700: "#1B242E",
          600: "#232E3A",
          500: "#3A4753",
        },
        mist: {
          400: "#5C6B78",
          300: "#8A97A3",
          200: "#B7C0C9",
          100: "#DCE2E7",
          50: "#EEF1F4",
        },
        signal: {
          DEFAULT: "#2FA9A0",
          bright: "#45C9BF",
          dim: "#1E6E68",
        },
        // Fixed domain semantics for hazard zone classes — never reused
        // elsewhere in the UI. Muted/desaturated so they read as a
        // serious classification system, not a traffic light.
        zone: {
          red: "#C6483C",
          orange: "#CE8A3E",
          yellow: "#C9B454",
          green: "#4C9F73",
        },
      },
      borderRadius: {
        DEFAULT: "3px",
        sm: "2px",
        md: "4px",
        lg: "6px",
      },
      boxShadow: {
        panel: "0 1px 0 rgba(0,0,0,0.4), 0 8px 24px rgba(0,0,0,0.35)",
      },
    },
  },
  plugins: [],
};
