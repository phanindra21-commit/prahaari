import { useEffect, useRef } from "react";
import maplibregl, { type Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { GeoPoint } from "@punarvas/shared";
import type { RankedCandidateSiteDetail } from "../../lib/api";
import { baseMapStyle } from "../map/mapStyle";

const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

interface RecommendationMapProps {
  origin: GeoPoint;
  originName: string;
  candidateSites: RankedCandidateSiteDetail[];
  selectedSiteId: string | null;
}

/** Origin (habitation) + destination (ranked candidate sites) map for the
 * recommendation detail view — a focused, self-contained MapLibre instance
 * rather than reusing the district-wide MapView, which is built around
 * hazard-zone layer toggles this view doesn't need. */
export function RecommendationMap({
  origin,
  originName,
  candidateSites,
  selectedSiteId,
}: RecommendationMapProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: baseMapStyle,
      center: origin.coordinates as [number, number],
      zoom: 10,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");
    mapRef.current = map;

    map.on("load", () => {
      map.addSource("connectors", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "connectors-line",
        type: "line",
        source: "connectors",
        paint: {
          "line-color": ["case", ["get", "isSelected"], "#45C9BF", "#5C6B78"],
          "line-width": ["case", ["get", "isSelected"], 2.5, 1],
          "line-dasharray": [2, 1.5],
          "line-opacity": 0.8,
        },
      });

      map.addSource("sites", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "sites-circle",
        type: "circle",
        source: "sites",
        paint: {
          "circle-radius": ["case", ["get", "isSelected"], 9, 6],
          "circle-color": ["case", ["get", "isSelected"], "#45C9BF", "#DCE2E7"],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#0A0E13",
        },
      });
      map.addLayer({
        id: "sites-label",
        type: "symbol",
        source: "sites",
        layout: {
          "text-field": ["concat", "#", ["get", "rank"]],
          "text-size": 10,
          "text-offset": [0, -1.4],
        },
        paint: { "text-color": "#DCE2E7", "text-halo-color": "#0A0E13", "text-halo-width": 1 },
      });

      map.addSource("origin", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "origin-circle",
        type: "circle",
        source: "origin",
        paint: {
          "circle-radius": 8,
          "circle-color": "#C6483C",
          "circle-stroke-width": 2,
          "circle-stroke-color": "#0A0E13",
        },
      });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = (): void => {
      const originSource = map.getSource("origin") as maplibregl.GeoJSONSource | undefined;
      const sitesSource = map.getSource("sites") as maplibregl.GeoJSONSource | undefined;
      const connectorsSource = map.getSource("connectors") as maplibregl.GeoJSONSource | undefined;
      if (!originSource || !sitesSource || !connectorsSource) return;

      originSource.setData({
        type: "Feature",
        geometry: origin as GeoJSON.Geometry,
        properties: { name: originName },
      });

      const siteFeatures = candidateSites.map((c) => ({
        type: "Feature" as const,
        geometry: c.relocationSiteId.centroid as GeoJSON.Geometry,
        properties: {
          id: c.relocationSiteId._id,
          name: c.relocationSiteId.name,
          rank: c.rank,
          isSelected: c.relocationSiteId._id === selectedSiteId,
        },
      }));
      sitesSource.setData({ type: "FeatureCollection", features: siteFeatures });

      const connectorFeatures = candidateSites.map((c) => ({
        type: "Feature" as const,
        geometry: {
          type: "LineString" as const,
          coordinates: [origin.coordinates, c.relocationSiteId.centroid.coordinates],
        },
        properties: { isSelected: c.relocationSiteId._id === selectedSiteId },
      }));
      connectorsSource.setData({ type: "FeatureCollection", features: connectorFeatures });

      const allCoords: [number, number][] = [
        origin.coordinates as [number, number],
        ...candidateSites.map((c) => c.relocationSiteId.centroid.coordinates as [number, number]),
      ];
      if (allCoords.length > 0) {
        const bounds = allCoords.reduce(
          (b, c) => b.extend(c),
          new maplibregl.LngLatBounds(allCoords[0], allCoords[0]),
        );
        map.fitBounds(bounds, { padding: 56, maxZoom: 13, duration: 400 });
      }
    };

    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [origin, originName, candidateSites, selectedSiteId]);

  return <div ref={containerRef} className="h-full w-full" />;
}
