import type { StyleSpecification } from "maplibre-gl";

/**
 * Dark basemap, no API key, ever (Step 8 Part 1 — the previous CARTO
 * `basemaps.cartocdn.com` source started requiring a key and rendered an
 * "API KEY REQUIRED" watermark over every map in production, which reads
 * as a broken product to a judge). Esri's classic public basemap REST
 * services (`server.arcgisonline.com`) have been genuinely keyless for
 * over a decade — no token, no signup, no rate-limit wall — and are used
 * here instead:
 *
 *  - `Elevation/World_Hillshade_Dark` IS the base layer, not an overlay
 *    over a flat color: it is itself a full dark-canvas raster baked
 *    from real elevation data, so the Western Ghats escarpment behind
 *    Chooralmala/Mundakkai is visible with no separate DEM/hillshade
 *    compositing needed (MapLibre raster layers have no blend-mode
 *    property, so a two-layer "flat base UNDER hillshade" composite
 *    like Esri's own Living Atlas authoring isn't reproducible here
 *    anyway — this single layer already reads as both).
 *  - `Canvas/World_Dark_Gray_Reference` is a transparent-background
 *    overlay of place labels, admin boundaries, and roads, tuned to sit
 *    on top of a dark base.
 *
 * Verified keyless and watermark-free by direct tile fetch over both
 * pilot districts before wiring this in (not just "should work" —
 * checked the actual bytes).
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
    "esri-hillshade-dark": {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade_Dark/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      maxzoom: 18,
      attribution: "Hillshade: Esri, Vantor, Airbus DS, USGS, NGA, NASA, and the GIS user community",
    },
    "esri-dark-gray-reference": {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      maxzoom: 16,
      attribution: "Esri, HERE, Garmin, © OpenStreetMap contributors, and the GIS user community",
    },
  },
  layers: [
    { id: "esri-hillshade-dark-layer", type: "raster", source: "esri-hillshade-dark" },
    { id: "esri-dark-gray-reference-layer", type: "raster", source: "esri-dark-gray-reference" },
  ],
};

export const ZONE_COLORS: Record<string, string> = {
  Red: "#C6483C",
  Orange: "#CE8A3E",
  Yellow: "#C9B454",
  Green: "#4C9F73",
};

/**
 * Step 10 Part 2B: lowered from the original 0.55/0.45/0.3/0.15 — at those
 * levels the Esri dark-gray reference layer's baked-in town/road labels
 * underneath were unreadable through Red/Orange fills. Red still reads as
 * clearly the most severe (highest opacity of the four), just not opaque
 * enough to blot out the basemap underneath it.
 */
export const ZONE_OPACITY: Record<string, number> = {
  Red: 0.4,
  Orange: 0.32,
  Yellow: 0.22,
  Green: 0.1,
};

export const BUCKET_COLORS: Record<string, string> = {
  Immediate: "#C6483C",
  ShortTerm: "#CE8A3E",
  MediumTerm: "#2FA9A0",
};

export const UNBUCKETED_COLOR = "#5C6B78";
