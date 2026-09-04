import type { StyleSpecification } from "maplibre-gl";

/**
 * Dark reference basemap (CARTO Dark Matter — free, no API key required)
 * with a real elevation hillshade layered over it (AWS's open Terrarium
 * DEM tiles — also free, no key). The hillshade is what makes the
 * Western Ghats escarpment behind Chooralmala/Mundakkai legible at a
 * glance: hazard-zone fills sit on top of visible terrain relief, not a
 * flat vector map.
 */
export const baseMapStyle: StyleSpecification = {
  version: 8,
  sources: {
    "carto-dark": {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        "https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      ],
      tileSize: 256,
      attribution: "© CARTO © OpenStreetMap contributors",
    },
    "terrain-dem": {
      type: "raster-dem",
      tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
      tileSize: 256,
      encoding: "terrarium",
      maxzoom: 15,
      attribution: "Terrain tiles: AWS Open Data — Terrarium",
    },
  },
  layers: [
    { id: "carto-base", type: "raster", source: "carto-dark", paint: { "raster-opacity": 0.85 } },
    {
      id: "hillshade",
      type: "hillshade",
      source: "terrain-dem",
      paint: {
        "hillshade-exaggeration": 0.7,
        "hillshade-shadow-color": "#000000",
        "hillshade-highlight-color": "#3A4753",
        "hillshade-accent-color": "#0A0E13",
        "hillshade-illumination-direction": 315,
      },
    },
  ],
};

export const ZONE_COLORS: Record<string, string> = {
  Red: "#C6483C",
  Orange: "#CE8A3E",
  Yellow: "#C9B454",
  Green: "#4C9F73",
};

export const ZONE_OPACITY: Record<string, number> = {
  Red: 0.55,
  Orange: 0.45,
  Yellow: 0.3,
  Green: 0.15,
};

export const BUCKET_COLORS: Record<string, string> = {
  Immediate: "#C6483C",
  ShortTerm: "#CE8A3E",
  MediumTerm: "#2FA9A0",
};

export const UNBUCKETED_COLOR = "#5C6B78";
