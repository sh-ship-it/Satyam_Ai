import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";

export type Hotspot = {
  lat: number;
  lng: number;
  weight: number; // raw count from the backend
  label?: string;
};

type Mode = "heat" | "pins" | "grid";

const KARNATAKA_CENTER: [number, number] = [14.5, 75.7];

/** Prop-driven map component — no internal data fetching, no hardcoded arrays.
 *  Parent passes `points` from api.mapHotspots and `mode` from the layer toggle. */
export function CrimeMap({ points, mode = "heat" }: { points: Hotspot[]; mode?: Mode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const layerRef = useRef<any>(null);
  const LRef = useRef<any>(null);
  const [ready, setReady] = useState(false);

  // Init Leaflet once
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      await import("leaflet.heat");
      if (cancelled || !containerRef.current || mapRef.current) return;
      LRef.current = L;
      const map = L.map(containerRef.current, { center: KARNATAKA_CENTER, zoom: 7 });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
        maxZoom: 19,
      }).addTo(map);
      mapRef.current = map;
      setReady(true);
    })();
    return () => {
      cancelled = true;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    };
  }, []);

  // (Re)draw whenever points or mode change
  useEffect(() => {
    const map = mapRef.current;
    const L = LRef.current;
    if (!map || !L || !ready) return;
    if (layerRef.current) { map.removeLayer(layerRef.current); layerRef.current = null; }
    if (!points.length) return;

    const maxW = Math.max(...points.map((p) => p.weight), 1);
    const norm = (w: number) => Math.max(0.15, w / maxW);

    let group: any;
    if (mode === "heat") {
      const heat = (L as any).heatLayer(
        points.map((h) => [h.lat, h.lng, norm(h.weight)]),
        {
          radius: 35, blur: 28, maxZoom: 14, max: 1.0,
          gradient: { 0.2: "#3b82f6", 0.4: "#fbbf24", 0.7: "#f97316", 1.0: "#ef4444" },
        },
      );
      group = L.layerGroup([heat]);
    } else if (mode === "pins") {
      group = L.layerGroup();
      points.forEach((h) => {
        L.circleMarker([h.lat, h.lng], {
          radius: 5 + norm(h.weight) * 12,
          color: "#0a0a0a", weight: 2, fillColor: "#ef4444", fillOpacity: 0.85,
        }).bindPopup(`<strong>${h.label ?? "Area"}</strong><br/>${Math.round(h.weight)} incidents`).addTo(group);
      });
    } else {
      group = L.layerGroup();
      const cell = 0.02;
      points.forEach((h) => {
        const w = norm(h.weight);
        L.rectangle([[h.lat - cell, h.lng - cell], [h.lat + cell, h.lng + cell]], {
          color: "#0a0a0a", weight: 1,
          fillColor: w > 0.7 ? "#ef4444" : w > 0.4 ? "#f97316" : "#fbbf24",
          fillOpacity: 0.5,
        }).bindPopup(`<strong>${h.label ?? "Area"}</strong><br/>${Math.round(h.weight)} incidents`).addTo(group);
      });
    }
    group.addTo(map);
    layerRef.current = group;

    // Fit map bounds to the returned points
    try {
      const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng]));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });
    } catch { /* ignore — e.g. single-point edge case */ }
  }, [points, mode, ready]);

  return <div ref={containerRef} className="absolute inset-0 z-0 bg-muted" />;
}
