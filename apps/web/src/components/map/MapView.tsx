import { useEffect, useRef } from "react";
import maplibregl, { type Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { HazardType, RecommendationStatus } from "@punarvas/shared";
import type { District, ZonePolygon, HabitationFeatureCollection, RelocationSite, ScenarioRun } from "../../lib/api";
import type { ScenarioViewMode } from "../../stores/scenarioStore";
import { baseMapStyle, ZONE_COLORS, ZONE_OPACITY, BUCKET_COLORS, UNBUCKETED_COLOR } from "./mapStyle";

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
      map.addSource("district-boundary", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "district-boundary-line",
        type: "line",
        source: "district-boundary",
        paint: { "line-color": "#5C6B78", "line-width": 1.5, "line-dasharray": [2, 2] },
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
    });

    return () => {
      map.remove();
      mapRef.current = null;
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
    if (map.isStyleLoaded()) apply();
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
    if (map.isStyleLoaded()) apply();
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
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [activeScenario, scenarioViewMode, visibleHazards]);

  // Habitations.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = (): void => {
      const source = map.getSource("habitations") as maplibregl.GeoJSONSource | undefined;
      if (!source) return;
      if (!showHabitations || !habitations) {
        source.setData(EMPTY_FC);
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
    };
    if (map.isStyleLoaded()) apply();
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
    if (map.isStyleLoaded()) apply();
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
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [selectedHabitationId]);

  return <div ref={containerRef} className="h-full w-full" />;
}
