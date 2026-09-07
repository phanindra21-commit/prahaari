import type { StyleSpecification } from "maplibre-gl";

/**
 * Post-Step-10 fix: the previous basemap (`Elevation/World_Hillshade_Dark`
 * + `Canvas/World_Dark_Gray_Reference`) is pure greyscale relief with NO
 * land/water colour distinction anywhere in the world — not a pilot-
 * district-specific bug, the whole basemap has no coastline or water at
 * all. For Ganjam, a coastal district whose entire hazard story is
 * coastal erosion and cyclones, having no visible Bay of Bengal made the
 * demo incoherent. Flagged in rehearsal, fixed here.
 *
 * `NatGeo_World_Map` (`server.arcgisonline.com`, same keyless Esri
 * service family already in use since Step 8 Part 1 — no token, no
 * signup, no rate-limit wall, verified over a decade) replaces both
 * layers with a single raster source that already bakes in everything
 * the old two-layer composite was missing: land/water colour, a crisp
 * coastline, rivers and reservoirs, hillshaded terrain relief (the
 * Western Ghats escarpment behind Chooralmala/Mundakkai reads clearly,
 * down to individual ridgelines and named peaks), roads, and its own
 * place/river/elevation labels. A three-layer composite (terrain base +
 * hillshade-over-it-at-reduced-opacity + a separate reference/labels
 * layer) was tried conceptually first, per the brief's suggested order,
 * but NatGeo already delivers the full result in one layer with no
 * compositing to get wrong two days before the hackathon — fewer moving
 * parts, chosen deliberately for reliability over elaborateness.
 *
 * Verified over both pilot districts before wiring this in: fetched
 * actual tile bytes (not "should work") over Wayanad and Ganjam at
 * district-wide zoom (9) AND at habitation-level zoom (12, centred on
 * Mundakkai/Chooralmala and on the Banasura Sagar reservoir) — confirmed
 * a visible Bay of Bengal with a distinct coastline off Ganjam, the
 * Western Ghats escarpment with contour/elevation labels, the Kabbani
 * river and Banasura Sagar reservoir near Wayanad, and zero watermark
 * text anywhere in the rendered tiles. Source/licence recorded in
 * `docs/DATA_SOURCES.md`.
 *
 * Because the basemap is now light (not dark), every label layer and the
 * district boundary line in `MapView.tsx`/`RecommendationMap.tsx` were
 * flipped from light-text-on-dark-halo to dark-text-on-light-halo — the
 * old scheme was tuned for a near-black basemap and would have been
 * unreadable against NatGeo's cream/green terrain colour.
 */
/**
 * Step 10 Part 2B: text-field symbol layers (habitation/block/panchayat/
 * district/site names) render nothing without a glyphs URL — MapLibre GL
 * needs a PBF font-glyph source even for a raster-tile base style. This is
 * MapLibre's own public demo glyph server (keyless, no signup), the same
 * one their official example styles use — verified reachable by direct
 * fetch before wiring in. Only "Open Sans Semibold" is served here (a 404
 * check ruled out Regular/Bold/other stacks), so every label layer uses
 * that one font stack and differentiates hierarchy via size/color instead
 * of weight.
 */
export const LABEL_FONT = ["Open Sans Semibold"];

export const baseMapStyle: StyleSpecification = {
  version: 8,
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  sources: {
    "esri-natgeo": {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      // Esri's own service metadata (MapServer?f=json) lists 17 LODs,
      // level 0-16 — verified z16 tiles resolve (HTTP 200) and z17 does
      // not exist server-side; MapLibre oversamples the z16 raster for
      // any deeper zoom the officer scrolls to, same as every slippy-map
      // raster source behaves past its native max.
      maxzoom: 16,
      attribution:
        "National Geographic, Esri, Garmin, HERE, UNEP-WCMC, USGS, NASA, ESA, METI, NRCAN, GEBCO, NOAA, Increment P Corp.",
    },
  },
  layers: [{ id: "esri-natgeo-layer", type: "raster", source: "esri-natgeo" }],
};

/**
 * Light-theme retune (white/light-blue chrome). MapLibre paint properties
 * and Recharts SVG props need literal hex — they cannot consume Tailwind
 * classes — so this file (not tailwind.config.js) is the single source of
 * truth for every raw color the map layers and the dashboard charts use;
 * MapView.tsx, RecommendationMap.tsx, ZoneLegend.tsx, and
 * DashboardCharts.tsx all import from here rather than re-declaring hex.
 * Values match tailwind.config.js's zone/signal scales exactly where the
 * same color is meant, so a badge and a map fill for the same zone class
 * always agree.
 */
export const ZONE_COLORS: Record<string, string> = {
  Red: "#B3261E",
  Orange: "#A85300",
  Yellow: "#7A6900",
  Green: "#1E7A3D",
};

/**
 * Unchanged from the dark-theme tuning — Red still reads as clearly the
 * most severe (highest opacity), Green the least, and these darker,
 * more-saturated fill colors read cleanly as a wash over NatGeo's light
 * terrain at the same opacities that worked over the old dark basemap
 * (verified visually with Playwright screenshots while building this).
 */
export const ZONE_OPACITY: Record<string, number> = {
  Red: 0.4,
  Orange: 0.32,
  Yellow: 0.22,
  Green: 0.1,
};

export const BUCKET_COLORS: Record<string, string> = {
  Immediate: ZONE_COLORS.Red!,
  ShortTerm: ZONE_COLORS.Orange!,
  MediumTerm: "#1856C4", // signal.DEFAULT
};

export const UNBUCKETED_COLOR = "#46647F"; // mist-200 — a clearly-visible neutral slate dot

/** A dark, high-contrast mark color for foreground icons/text/default
 * strokes on the map canvas — independent of the app-chrome "ink" scale,
 * which is now white-dominant and would make these invisible if reused
 * directly. Pairs with MAP_HALO (white) for label text, matching
 * NatGeo's light terrain regardless of the surrounding app theme. */
export const MAP_INK = "#0F1F2E"; // mist-50
export const MAP_HALO = "#FFFFFF";
/** The app's blue accent, for interactive/selected map elements (the
 * selected-habitation ring, the scenario "what changed" outline) — kept
 * in sync with tailwind.config.js's signal.DEFAULT by hand, since
 * MapLibre paint values can't reference it directly. */
export const MAP_SIGNAL = "#1856C4"; // signal.DEFAULT
/** A dedicated administrative-boundary navy, deliberately NOT the same
 * hue as MAP_SIGNAL — kept from the dark-theme tuning, since it already
 * reads clearly on light terrain and stays visually distinct from the
 * brighter, more saturated signal-blue used for interactive elements. */
export const MAP_BOUNDARY = "#1D3557";
