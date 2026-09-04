import { useEffect, useRef } from "react";
import maplibregl, { type Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { HazardType } from "@punarvas/shared";
import type { District, ZonePolygon, HabitationFeatureCollection, RelocationSite } from "../../lib/api";
import { baseMapStyle, ZONE_COLORS, ZONE_OPACITY, BUCKET_COLORS, UNBUCKETED_COLOR } from "./mapStyle";

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
}

function zonesToFeatureCollection(zones: ZonePolygon[], visibleHazards: Set<HazardType>): GeoJSON.FeatureCollection {
  const features = zones
    .filter((z) => visibleHazards.has(z.hazardType))
    .map((z) => ({
      type: "Feature" as const,
      geometry: z.simplifiedGeometry as GeoJSON.Geometry,
      properties: { hazardType: z.hazardType, zoneClass: z.zoneClass, hazardScore: z.hazardScore },
    }))
    .sort((a, b) => (ZONE_SEVERITY[a.properties.zoneClass] ?? 0) - (ZONE_SEVERITY[b.properties.zoneClass] ?? 0));
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
        },
      }));
      source.setData({ type: "FeatureCollection", features });
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [habitations, showHabitations]);

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

  // Selected habitation highlight.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    if (!map.getLayer("habitations-layer")) return;
    map.setPaintProperty("habitations-layer", "circle-stroke-width", [
      "case",
      ["==", ["get", "id"], selectedHabitationId ?? ""],
      3,
      1,
    ]);
    map.setPaintProperty("habitations-layer", "circle-stroke-color", [
      "case",
      ["==", ["get", "id"], selectedHabitationId ?? ""],
      "#45C9BF",
      "#0A0E13",
    ]);
  }, [selectedHabitationId]);

  return <div ref={containerRef} className="h-full w-full" />;
}
