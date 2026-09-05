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
