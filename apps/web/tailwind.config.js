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
        // District-Collector instrument palette: white dominant, light blue
        // supporting. Every class name and numeric relationship below is
        // UNCHANGED from the previous dark theme (950 = the extreme/base
        // end of the scale, 500/400 = the moderate/foreground end) — only
        // the lightness each step maps to has inverted, so every existing
        // `bg-ink-800`/`text-mist-300`/etc. usage across the app re-themes
        // correctly with zero component changes. See apps/web/src/
        // components/map/mapStyle.ts for the small set of raw hex values
        // MapLibre/Recharts need outside this token system (they cannot
        // consume Tailwind classes) — those were retuned by hand alongside
        // this file, not derived from it.
        ink: {
          950: "#FFFFFF", // page background — white dominant
          900: "#F5F9FD", // barest panel tint (footers, quiet backgrounds)
          800: "#EAF1F9", // card / dropdown / popup surface
          700: "#D8E6F2", // stronger surface, row hover
          600: "#C7DAEA", // standard border
          500: "#6D93B8", // emphasis border — inputs, interactive outlines (>=3:1 on white)
        },
        mist: {
          50: "#0F1F2E", // headings — darkest, on white
          100: "#26415A", // primary body text (~10.5:1 on white)
          200: "#46647F", // secondary text (~6.2:1 on white)
          300: "#4C6884", // muted text (~5.1:1 on the darkest card bg, ink-800)
          400: "#576986", // most-muted text still meeting AA (~4.9:1 on ink-800)
          500: "#576986", // alias of 400 — a couple of call sites reference
          // this tier for maximally de-emphasized text; kept identical
          // rather than pushed lighter, since 400 already sits close to
          // the 4.5:1 floor and a genuinely lighter 500 would fail AA.
        },
        signal: {
          DEFAULT: "#1856C4",
          bright: "#215BC0", // ~5.6:1 as text on the darkest card bg (ink-800)
          dim: "#123F7A",
        },
        // Fixed domain semantics for hazard zone classes — never reused
        // elsewhere in the UI. Deliberately dark/saturated rather than
        // pastel: every one of these is also used as small badge TEXT on
        // a near-white tinted chip (ZoneBadge, PriorityBadge,
        // RecommendationStatusBadge all do `bg-zone-X/20 text-zone-X`),
        // so each value is chosen to clear 4.5:1 as text on white, not
        // just to look distinct as a map fill. Yellow in particular reads
        // as a dark gold/olive rather than a bright yellow — an accessible
        // yellow-as-text does not exist at high lightness; relative
        // ordering against red/orange/green carries the severity meaning.
        zone: {
          red: "#B3261E", // ~6.5:1
          orange: "#A85300", // ~5.4:1
          yellow: "#7A6900", // ~5.5:1
          green: "#1E7A3D", // ~5.4:1
        },
      },
      borderRadius: {
        DEFAULT: "3px",
        sm: "2px",
        md: "4px",
        lg: "6px",
      },
      boxShadow: {
        // Softened for the light theme — the original dark-theme values
        // (0.4/0.35 alpha) read as a heavy black smudge against white;
        // a light backdrop needs far less shadow density to still convey
        // an elevated panel.
        panel: "0 1px 0 rgba(15,31,46,0.06), 0 8px 24px rgba(15,31,46,0.12)",
      },
    },
  },
  plugins: [],
};
