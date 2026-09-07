import { useEffect, useRef } from "react";
import maplibregl, { type Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { GeoPoint } from "@prahari/shared";
import type { RankedCandidateSiteDetail } from "../../lib/api";
import { baseMapStyle, ZONE_COLORS, MAP_INK, MAP_HALO, MAP_SIGNAL } from "../map/mapStyle";

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
  // See MapView.tsx's own styleLoadedRef doc comment: map.isStyleLoaded()
  // is not a one-way "has loaded" flag (it can report false again once
  // real data starts arriving), so map.once("load", apply) as a fallback
  // can register a listener for an event that already fired and will
  // never fire again — the same "habitation not loading" root cause,
  // fixed the same way here for consistency (Part 1).
  const styleLoadedRef = useRef(false);

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
          "line-color": ["case", ["get", "isSelected"], MAP_SIGNAL, "#4C6884"],
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
          "circle-color": ["case", ["get", "isSelected"], MAP_SIGNAL, "#8FAFC9"],
          "circle-stroke-width": 2,
          "circle-stroke-color": MAP_INK,
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
        paint: { "text-color": MAP_INK, "text-halo-color": MAP_HALO, "text-halo-width": 1.4 },
      });

      map.addSource("origin", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "origin-circle",
        type: "circle",
        source: "origin",
        paint: {
          "circle-radius": 8,
          "circle-color": ZONE_COLORS.Red!,
          "circle-stroke-width": 2,
          "circle-stroke-color": MAP_INK,
        },
      });

      // Step 10 Part 3D: the selected candidate's safest (A*-routed)
      // corridor in green over its direct-line reference in red — drawn
      // on top of everything else added so far so neither is obscured by
      // the generic dashed origin-to-site connectors.
      map.addSource("direct-route", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "direct-route-line",
        type: "line",
        source: "direct-route",
        paint: { "line-color": ZONE_COLORS.Red!, "line-width": 2.5, "line-dasharray": [2, 1.5], "line-opacity": 0.9 },
      });

      map.addSource("safest-route", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "safest-route-line",
        type: "line",
        source: "safest-route",
        paint: { "line-color": ZONE_COLORS.Green!, "line-width": 3.5, "line-opacity": 0.95 },
      });

      styleLoadedRef.current = true;
    });

    return () => {
      map.remove();
      mapRef.current = null;
      styleLoadedRef.current = false;
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
      const directRouteSource = map.getSource("direct-route") as maplibregl.GeoJSONSource | undefined;
      const safestRouteSource = map.getSource("safest-route") as maplibregl.GeoJSONSource | undefined;
      if (!originSource || !sitesSource || !connectorsSource || !directRouteSource || !safestRouteSource) return;

      const selectedCandidate = candidateSites.find((c) => c.relocationSiteId._id === selectedSiteId);
      const selectedRoute = selectedCandidate?.route ?? null;
      directRouteSource.setData(
        selectedRoute
          ? { type: "Feature", geometry: selectedRoute.directGeometry as GeoJSON.Geometry, properties: {} }
          : EMPTY_FC,
      );
      safestRouteSource.setData(
        selectedRoute
          ? { type: "Feature", geometry: selectedRoute.routeGeometry as GeoJSON.Geometry, properties: {} }
          : EMPTY_FC,
      );

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

      // The selected candidate's dashed connector is replaced by the two
      // dedicated route lines above when route data exists — skip it here
      // to avoid drawing both on top of each other. Every other candidate
      // (and the selected one too, as a fallback when no route could be
      // computed for it) still gets the plain connector.
      const connectorFeatures = candidateSites
        .filter((c) => !(selectedRoute && c.relocationSiteId._id === selectedSiteId))
        .map((c) => ({
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

    if (styleLoadedRef.current) apply();
    else map.once("load", apply);
  }, [origin, originName, candidateSites, selectedSiteId]);

  return <div ref={containerRef} className="h-full w-full" />;
}
