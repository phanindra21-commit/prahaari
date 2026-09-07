import { useEffect, useRef } from "react";
import maplibregl, { type Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { HazardType, RecommendationStatus } from "@prahari/shared";
import type { District, ZonePolygon, HabitationFeatureCollection, RelocationSite, ScenarioRun } from "../../lib/api";
import type { ScenarioViewMode } from "../../stores/scenarioStore";
import { baseMapStyle, ZONE_COLORS, ZONE_OPACITY, BUCKET_COLORS, UNBUCKETED_COLOR, LABEL_FONT } from "./mapStyle";

/** Step 7 Commit 3F: ring color for a habitation with a recorded decision
 * (a Recommendation whose status moved off PENDING_REVIEW) — independent
 * of the priority-bucket fill color, so a decided habitation's fill still
 * shows its hazard priority while the ring shows what an officer did about it. */
export const DECISION_RING_COLORS: Record<RecommendationStatus, string> = {
  PENDING_REVIEW: "#0A0E13",
  APPROVED: "#4C9F73",
  MODIFIED: "#CE8A3E",
  REJECTED: "#C6483C",
  DEFERRED: "#C9B454",
};

const ZONE_SEVERITY: Record<string, number> = { Green: 0, Yellow: 1, Orange: 2, Red: 3 };

const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

interface MapViewProps {
  district: District | undefined;
  zones: ZonePolygon[];
  visibleHazards: Set<HazardType>;
  habitations: HabitationFeatureCollection | undefined;
  showHabitations: boolean;
  relocationSites: RelocationSite[];
  showSites: boolean;
  selectedHabitationId: string | null;
  onHabitationClick: (habitationId: string) => void;
  /** habitationId -> decided Recommendation.status (PENDING_REVIEW entries
   * omitted — only a recorded decision gets a ring). */
  recommendationStatusByHabitationId?: Record<string, RecommendationStatus>;
  /** Step 8 Part 2E: while set, the scenario's baseline/scenario zone
   * geometry REPLACES the live `zones` layer (never shown together —
   * the toggle is how the officer compares them, not simultaneous
   * overlap) and a "changed cells" highlight outline is drawn on top. */
  activeScenario?: ScenarioRun | null;
  scenarioViewMode?: ScenarioViewMode;
}

function zonesToFeatureCollection(zones: ZonePolygon[], visibleHazards: Set<HazardType>): GeoJSON.FeatureCollection {
  const features = zones
    .filter((z) => visibleHazards.has(z.hazardType))
    .map((z) => ({
      type: "Feature" as const,
      geometry: (z.simplifiedGeometry ?? z.geometry) as GeoJSON.Geometry,
      properties: { hazardType: z.hazardType, zoneClass: z.zoneClass, hazardScore: z.hazardScore },
    }))
    .sort((a, b) => (ZONE_SEVERITY[a.properties.zoneClass] ?? 0) - (ZONE_SEVERITY[b.properties.zoneClass] ?? 0));
  return { type: "FeatureCollection", features };
}

function scenarioZonesToFeatureCollection(
  scenario: ScenarioRun,
  viewMode: ScenarioViewMode,
  visibleHazards: Set<HazardType>,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const g of scenario.zoneGeometries) {
    if (!visibleHazards.has(g.hazardType)) continue;
    const byClass = viewMode === "baseline" ? g.baseline : g.scenario;
    for (const [zoneClass, geometry] of Object.entries(byClass)) {
      if (!geometry) continue;
      features.push({
        type: "Feature",
        geometry: geometry as GeoJSON.Geometry,
        properties: { hazardType: g.hazardType, zoneClass },
      });
    }
  }
  features.sort(
    (a, b) =>
      (ZONE_SEVERITY[(a.properties as { zoneClass: string }).zoneClass] ?? 0) -
      (ZONE_SEVERITY[(b.properties as { zoneClass: string }).zoneClass] ?? 0),
  );
  return { type: "FeatureCollection", features };
}

/**
 * Step 10 Part 2B/2C: a simple, dependency-free centroid — average of the
 * outer ring's vertices of whichever sub-polygon has the most vertices
 * (a proxy for "the mainland", so a MultiPolygon district like Ganjam
 * — a few small Chilika Lake islands plus the main landmass — gets its
 * label centered on the landmass, not dragged toward a tiny island by an
 * unweighted average across all sub-polygons). Good enough for placing one
 * label point; not a true area-weighted geometric centroid.
 */
function largestRingCentroid(geometry: GeoJSON.Geometry): [number, number] | null {
  let rings: [number, number][][] = [];
  if (geometry.type === "Polygon") {
    rings = [geometry.coordinates[0] as [number, number][]];
  } else if (geometry.type === "MultiPolygon") {
    rings = geometry.coordinates.map((poly) => poly[0] as [number, number][]);
  } else {
    return null;
  }
  const outer = rings.filter(Boolean).sort((a, b) => b.length - a.length)[0];
  if (!outer || outer.length === 0) return null;
  let x = 0;
  let y = 0;
  for (const [lon, lat] of outer) {
    x += lon;
    y += lat;
  }
  return [x / outer.length, y / outer.length];
}

interface LabelPoint {
  name: string;
  lon: number;
  lat: number;
  count: number;
}

/** Groups habitation point features by a property (block/panchayat) and
 * returns one centroid label point per distinct group. */
function groupedLabelPoints(
  features: Array<{ geometry: GeoJSON.Point; properties: { block: string; panchayat: string } }>,
  key: "block" | "panchayat",
): LabelPoint[] {
  const groups = new Map<string, { sumLon: number; sumLat: number; count: number }>();
  for (const f of features) {
    const name = f.properties[key];
    const [lon, lat] = f.geometry.coordinates as [number, number];
    const g = groups.get(name) ?? { sumLon: 0, sumLat: 0, count: 0 };
    g.sumLon += lon;
    g.sumLat += lat;
    g.count += 1;
    groups.set(name, g);
  }
  return Array.from(groups.entries()).map(([name, g]) => ({
    name,
    lon: g.sumLon / g.count,
    lat: g.sumLat / g.count,
    count: g.count,
  }));
}

function labelPointsToFeatureCollection(points: LabelPoint[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: points.map((p) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [p.lon, p.lat] },
      properties: { name: p.name, count: p.count },
    })),
  };
}

function scenarioChangedToFeatureCollection(
  scenario: ScenarioRun,
  visibleHazards: Set<HazardType>,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const g of scenario.zoneGeometries) {
    if (!visibleHazards.has(g.hazardType) || !g.changed) continue;
    features.push({ type: "Feature", geometry: g.changed as GeoJSON.Geometry, properties: { hazardType: g.hazardType } });
  }
  return { type: "FeatureCollection", features };
}

export function MapView({
  district,
  zones,
  visibleHazards,
  habitations,
  showHabitations,
  relocationSites,
  showSites,
  selectedHabitationId,
  onHabitationClick,
  recommendationStatusByHabitationId,
  activeScenario = null,
  scenarioViewMode = "scenario",
}: MapViewProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  /**
   * Part 1 fix (demo rehearsal: "habitation not loading", intermittent,
   * every role): every data-setting effect below used to gate on
   * `map.isStyleLoaded()`, falling back to `map.once("load", apply)` when
   * false. That is unsound — `isStyleLoaded()` is not a one-way "has the
   * map finished its initial load" flag; MapLibre reports it false again
   * whenever ANY source's tiles are mid-update (e.g. right after a
   * sibling effect's own `setData()` call), which happens routinely once
   * real data starts arriving. Since the map's `"load"` event fires
   * EXACTLY ONCE in its lifetime, an effect that re-checks
   * `isStyleLoaded()` after that one real `"load"` has already fired —
   * sees `false` again — and registers `map.once("load", apply)` anyway
   * registers a listener for an event that will never fire again, so
   * `apply()` is silently dropped forever. Confirmed by direct trace
   * against a live page load: the habitations effect re-ran twice AFTER
   * the map's one real `"load"` had already fired, both times seeing
   * `isStyleLoaded() === false` and registering a dead listener — the
   * habitations source stayed empty indefinitely. This ref is the fix:
   * set exactly once, inside the mount effect's own `"load"` handler
   * (which reliably fires once and only once), and checked instead of
   * `isStyleLoaded()` everywhere below — a plain boolean that, unlike
   * `isStyleLoaded()`, never regresses to false once the map is ready.
   */
  const styleLoadedRef = useRef(false);
  const onHabitationClickRef = useRef(onHabitationClick);
  onHabitationClickRef.current = onHabitationClick;

  // Mount once.
  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: baseMapStyle,
      center: [78.5, 15],
      zoom: 5,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    mapRef.current = map;

    map.on("load", () => {
      // Step 10 Part 2C: a distinct, legible outline for "this is the area
      // of responsibility" — a soft wide glow underneath a crisp bright
      // dashed line on top, rather than the original single thin
      // `#5C6B78` line that read as barely-there against the dark basemap
      // and disappeared entirely under a Red/Orange zone fill.
      //
      // Post-Step-10 fix: `#DCE2E7` (pale) was tuned for the old dark
      // basemap and nearly disappears against NatGeo's light cream/green
      // terrain — switched to a solid administrative-boundary navy that
      // reads clearly on light terrain colour and isn't already claimed
      // by the zone/priority-bucket/signal-accent colour vocabulary
      // elsewhere in this file.
      map.addSource("district-boundary", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "district-boundary-glow",
        type: "line",
        source: "district-boundary",
        paint: { "line-color": "#1D3557", "line-width": 6, "line-opacity": 0.22, "line-blur": 2 },
      });
      map.addLayer({
        id: "district-boundary-line",
        type: "line",
        source: "district-boundary",
        paint: { "line-color": "#1D3557", "line-width": 2, "line-dasharray": [3, 2] },
      });

      map.addSource("zones", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "zones-fill",
        type: "fill",
        source: "zones",
        paint: {
          "fill-color": [
            "match",
            ["get", "zoneClass"],
            "Red",
            ZONE_COLORS.Red!,
            "Orange",
            ZONE_COLORS.Orange!,
            "Yellow",
            ZONE_COLORS.Yellow!,
            "Green",
            ZONE_COLORS.Green!,
            "#888888",
          ],
          "fill-opacity": [
            "match",
            ["get", "zoneClass"],
            "Red",
            ZONE_OPACITY.Red!,
            "Orange",
            ZONE_OPACITY.Orange!,
            "Yellow",
            ZONE_OPACITY.Yellow!,
            "Green",
            ZONE_OPACITY.Green!,
            0.2,
          ],
        },
      });
      map.addLayer({
        id: "zones-outline",
        type: "line",
        source: "zones",
        paint: {
          "line-color": ["match", ["get", "zoneClass"], "Red", ZONE_COLORS.Red!, "Orange", ZONE_COLORS.Orange!, "#00000000"],
          "line-width": 1,
          "line-opacity": 0.6,
        },
        filter: ["in", ["get", "zoneClass"], ["literal", ["Red", "Orange"]]],
      });

      // Step 8 Part 2E: scenario zone overlay — hidden (layout.visibility)
      // until a scenario is active, at which point the "Live vs scenario
      // zones" effect below hides zones-fill/outline and shows these
      // instead (never both at once — the toggle is how the officer
      // compares baseline vs scenario, not simultaneous overlap).
      map.addSource("scenario-zones", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "scenario-zones-fill",
        type: "fill",
        source: "scenario-zones",
        layout: { visibility: "none" },
        paint: {
          "fill-color": [
            "match",
            ["get", "zoneClass"],
            "Red",
            ZONE_COLORS.Red!,
            "Orange",
            ZONE_COLORS.Orange!,
            "Yellow",
            ZONE_COLORS.Yellow!,
            "Green",
            ZONE_COLORS.Green!,
            "#888888",
          ],
          "fill-opacity": [
            "match",
            ["get", "zoneClass"],
            "Red",
            ZONE_OPACITY.Red!,
            "Orange",
            ZONE_OPACITY.Orange!,
            "Yellow",
            ZONE_OPACITY.Yellow!,
            "Green",
            ZONE_OPACITY.Green!,
            0.2,
          ],
        },
      });
      map.addLayer({
        id: "scenario-zones-outline",
        type: "line",
        source: "scenario-zones",
        layout: { visibility: "none" },
        paint: {
          "line-color": [
            "match",
            ["get", "zoneClass"],
            "Red",
            ZONE_COLORS.Red!,
            "Orange",
            ZONE_COLORS.Orange!,
            "#00000000",
          ],
          "line-width": 1,
          "line-opacity": 0.6,
        },
        filter: ["in", ["get", "zoneClass"], ["literal", ["Red", "Orange"]]],
      });

      // The "what changed" highlight — a thick dashed signal-colored
      // outline around every cell whose class moved, drawn regardless of
      // which of baseline/scenario is currently shown underneath.
      map.addSource("scenario-changed", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "scenario-changed-outline",
        type: "line",
        source: "scenario-changed",
        layout: { visibility: "none" },
        paint: {
          "line-color": "#45C9BF",
          "line-width": 2.5,
          "line-opacity": 0.9,
          "line-dasharray": [1.5, 1],
        },
      });

      map.addSource("relocation-sites", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "relocation-sites-layer",
        type: "circle",
        source: "relocation-sites",
        paint: {
          "circle-radius": 6,
          "circle-color": "#0A0E13",
          "circle-stroke-width": 2,
          "circle-stroke-color": "#DCE2E7",
        },
      });

      map.addSource("habitations", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "habitations-layer",
        type: "circle",
        source: "habitations",
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["get", "population"],
            0,
            4,
            500,
            8,
            2000,
            14,
          ],
          "circle-color": [
            "match",
            ["get", "priorityBucket"],
            "Immediate",
            BUCKET_COLORS.Immediate!,
            "ShortTerm",
            BUCKET_COLORS.ShortTerm!,
            "MediumTerm",
            BUCKET_COLORS.MediumTerm!,
            UNBUCKETED_COLOR,
          ],
          "circle-stroke-width": [
            "case",
            ["==", ["get", "id"], ["literal", ""]],
            2,
            1,
          ],
          "circle-stroke-color": "#0A0E13",
          "circle-opacity": 0.9,
        },
      });

      // Step 10 Part 2B: place names and context — the map was too sparse
      // to orient by. `text-allow-overlap: false` (the default) is what
      // actually declutters — MapLibre skips a label whose box would
      // collide with a higher-priority one already placed, rather than
      // every layer being forced to hand-pick non-overlapping zoom
      // windows.
      //
      // Post-Step-10 fix: every layer here originally paired light text
      // with a dark halo, tuned for the old near-black basemap. NatGeo's
      // light cream/green terrain colour made that combination nearly
      // invisible, so every layer is flipped to dark text on a light
      // halo — hierarchy is still carried by size and darkness (district
      // is largest/darkest-accent, panchayat is smallest/lightest-dark).
      map.addSource("district-label", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "district-label-layer",
        type: "symbol",
        source: "district-label",
        layout: {
          "text-field": ["get", "name"],
          "text-font": LABEL_FONT,
          "text-size": 22,
          "text-letter-spacing": 0.04,
          "text-transform": "uppercase",
        },
        paint: {
          "text-color": "#1E6E68",
          "text-halo-color": "#FFFFFF",
          "text-halo-width": 2.5,
        },
      });

      map.addSource("block-labels", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "block-labels-layer",
        type: "symbol",
        source: "block-labels",
        minzoom: 9,
        layout: {
          "text-field": ["get", "name"],
          "text-font": LABEL_FONT,
          "text-size": 13,
          "text-transform": "uppercase",
          "text-letter-spacing": 0.03,
        },
        paint: { "text-color": "#141B23", "text-halo-color": "#FFFFFF", "text-halo-width": 1.8 },
      });

      map.addSource("panchayat-labels", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "panchayat-labels-layer",
        type: "symbol",
        source: "panchayat-labels",
        minzoom: 11,
        layout: {
          "text-field": ["get", "name"],
          "text-font": LABEL_FONT,
          "text-size": 11,
        },
        paint: { "text-color": "#3A4753", "text-halo-color": "#FFFFFF", "text-halo-width": 1.6 },
      });

      map.addLayer({
        id: "habitation-name-labels",
        type: "symbol",
        source: "habitations",
        minzoom: 10,
        layout: {
          "text-field": ["get", "name"],
          "text-font": LABEL_FONT,
          "text-size": 12,
          "text-variable-anchor": ["top", "bottom", "left", "right"],
          "text-radial-offset": 0.8,
          "text-justify": "auto",
          "symbol-sort-key": ["-", 0, ["get", "population"]],
        },
        paint: { "text-color": "#0A0E13", "text-halo-color": "#FFFFFF", "text-halo-width": 2 },
      });

      map.addLayer({
        id: "relocation-site-name-labels",
        type: "symbol",
        source: "relocation-sites",
        minzoom: 10,
        layout: {
          "text-field": ["get", "name"],
          "text-font": LABEL_FONT,
          "text-size": 12,
          "text-variable-anchor": ["top", "bottom", "left", "right"],
          "text-radial-offset": 0.7,
        },
        paint: { "text-color": "#0A0E13", "text-halo-color": "#FFFFFF", "text-halo-width": 2 },
      });

      map.on("mouseenter", "habitations-layer", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "habitations-layer", () => {
        map.getCanvas().style.cursor = "";
      });
      map.on("click", "habitations-layer", (e) => {
        const feature = e.features?.[0];
        const id = feature?.properties?.id as string | undefined;
        if (id) onHabitationClickRef.current(id);
      });

      // Set exactly once, here — see styleLoadedRef's own doc comment for why
      // every other effect below checks this instead of map.isStyleLoaded().
      styleLoadedRef.current = true;
    });

    return () => {
      map.remove();
      mapRef.current = null;
      styleLoadedRef.current = false;
    };
  }, []);

  // District boundary + fit bounds.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !district) return;
    const apply = (): void => {
      const source = map.getSource("district-boundary") as maplibregl.GeoJSONSource | undefined;
      if (!source) return;
      source.setData({
        type: "Feature",
        geometry: district.boundary as GeoJSON.Geometry,
        properties: {},
      });

      const labelSource = map.getSource("district-label") as maplibregl.GeoJSONSource | undefined;
      const centroid = largestRingCentroid(district.boundary as GeoJSON.Geometry);
      labelSource?.setData(
        centroid
          ? {
              type: "Feature",
              geometry: { type: "Point", coordinates: centroid },
              properties: { name: district.name },
            }
          : EMPTY_FC,
      );

      const coords: [number, number][] = [];
      const collect = (geom: GeoJSON.Geometry): void => {
        if (geom.type === "Polygon") geom.coordinates.forEach((ring) => ring.forEach((c) => coords.push(c as [number, number])));
        else if (geom.type === "MultiPolygon")
          geom.coordinates.forEach((poly) => poly.forEach((ring) => ring.forEach((c) => coords.push(c as [number, number]))));
      };
      collect(district.boundary as GeoJSON.Geometry);
      if (coords.length > 0) {
        const bounds = coords.reduce(
          (b, c) => b.extend(c),
          new maplibregl.LngLatBounds(coords[0], coords[0]),
        );
        map.fitBounds(bounds, { padding: 48, duration: 600 });
      }
    };
    if (styleLoadedRef.current) apply();
    else map.once("load", apply);
  }, [district]);

  // Zones.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = (): void => {
      const source = map.getSource("zones") as maplibregl.GeoJSONSource | undefined;
      source?.setData(zonesToFeatureCollection(zones, visibleHazards));
    };
    if (styleLoadedRef.current) apply();
    else map.once("load", apply);
  }, [zones, visibleHazards]);

  // Scenario zone overlay (Step 8 Part 2E): while active, replaces the
  // live zones layers rather than layering on top of them; the "changed
  // cells" outline shows regardless of the baseline/scenario toggle.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = (): void => {
      const zonesSource = map.getSource("scenario-zones") as maplibregl.GeoJSONSource | undefined;
      const changedSource = map.getSource("scenario-changed") as maplibregl.GeoJSONSource | undefined;
      if (!zonesSource || !changedSource || !map.getLayer("zones-fill")) return;

      if (activeScenario) {
        zonesSource.setData(scenarioZonesToFeatureCollection(activeScenario, scenarioViewMode, visibleHazards));
        changedSource.setData(scenarioChangedToFeatureCollection(activeScenario, visibleHazards));
      } else {
        zonesSource.setData(EMPTY_FC);
        changedSource.setData(EMPTY_FC);
      }

      const liveVisibility = activeScenario ? "none" : "visible";
      const scenarioVisibility = activeScenario ? "visible" : "none";
      map.setLayoutProperty("zones-fill", "visibility", liveVisibility);
      map.setLayoutProperty("zones-outline", "visibility", liveVisibility);
      map.setLayoutProperty("scenario-zones-fill", "visibility", scenarioVisibility);
      map.setLayoutProperty("scenario-zones-outline", "visibility", scenarioVisibility);
      map.setLayoutProperty("scenario-changed-outline", "visibility", scenarioVisibility);
    };
    if (styleLoadedRef.current) apply();
    else map.once("load", apply);
  }, [activeScenario, scenarioViewMode, visibleHazards]);

  // Habitations, plus the block/panchayat labels derived from them
  // (Step 10 Part 2B — there is no separate block/panchayat boundary
  // dataset, so one label per distinct name is placed at the centroid of
  // the habitations that share it).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = (): void => {
      const source = map.getSource("habitations") as maplibregl.GeoJSONSource | undefined;
      const blockSource = map.getSource("block-labels") as maplibregl.GeoJSONSource | undefined;
      const panchayatSource = map.getSource("panchayat-labels") as maplibregl.GeoJSONSource | undefined;
      if (!source) return;
      if (!showHabitations || !habitations) {
        source.setData(EMPTY_FC);
        blockSource?.setData(EMPTY_FC);
        panchayatSource?.setData(EMPTY_FC);
        return;
      }
      const features = habitations.features.map((f) => ({
        type: "Feature" as const,
        geometry: f.geometry as GeoJSON.Geometry,
        properties: {
          id: f.properties.id,
          name: f.properties.name,
          population: f.properties.population,
          priorityBucket: f.properties.assessment?.priorityBucket ?? null,
          zoneClass: f.properties.assessment?.overallZoneClass ?? null,
          decisionStatus: recommendationStatusByHabitationId?.[f.properties.id] ?? null,
        },
      }));
      source.setData({ type: "FeatureCollection", features });

      const pointFeatures = habitations.features.map((f) => ({
        geometry: f.geometry as GeoJSON.Point,
        properties: { block: f.properties.block, panchayat: f.properties.panchayat },
      }));
      blockSource?.setData(labelPointsToFeatureCollection(groupedLabelPoints(pointFeatures, "block")));
      panchayatSource?.setData(labelPointsToFeatureCollection(groupedLabelPoints(pointFeatures, "panchayat")));
    };
    if (styleLoadedRef.current) apply();
    else map.once("load", apply);
  }, [habitations, showHabitations, recommendationStatusByHabitationId]);

  // Relocation sites.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = (): void => {
      const source = map.getSource("relocation-sites") as maplibregl.GeoJSONSource | undefined;
      if (!source) return;
      if (!showSites) {
        source.setData(EMPTY_FC);
        return;
      }
      const features = relocationSites.map((s) => ({
        type: "Feature" as const,
        geometry: s.centroid as GeoJSON.Geometry,
        properties: { id: s._id, name: s.name },
      }));
      source.setData({ type: "FeatureCollection", features });
    };
    if (styleLoadedRef.current) apply();
    else map.once("load", apply);
  }, [relocationSites, showSites]);

  // Selected habitation highlight, layered with the Step 7 Commit 3F
  // decision-status ring (evaluated per-feature from `decisionStatus`, so
  // this expression stays live as habitation data refetches after a
  // decision — it does not need to be reapplied on that data change).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = (): void => {
      if (!map.getLayer("habitations-layer")) return;
      map.setPaintProperty("habitations-layer", "circle-stroke-width", [
        "case",
        ["==", ["get", "id"], selectedHabitationId ?? ""],
        3,
        ["!=", ["get", "decisionStatus"], null],
        2.5,
        1,
      ]);
      map.setPaintProperty("habitations-layer", "circle-stroke-color", [
        "case",
        ["==", ["get", "id"], selectedHabitationId ?? ""],
        "#45C9BF",
        ["==", ["get", "decisionStatus"], "APPROVED"],
        DECISION_RING_COLORS.APPROVED,
        ["==", ["get", "decisionStatus"], "MODIFIED"],
        DECISION_RING_COLORS.MODIFIED,
        ["==", ["get", "decisionStatus"], "REJECTED"],
        DECISION_RING_COLORS.REJECTED,
        ["==", ["get", "decisionStatus"], "DEFERRED"],
        DECISION_RING_COLORS.DEFERRED,
        "#0A0E13",
      ]);
    };
    if (styleLoadedRef.current) apply();
    else map.once("load", apply);
  }, [selectedHabitationId]);

  return <div ref={containerRef} className="h-full w-full" />;
}
