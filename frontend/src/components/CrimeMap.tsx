import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";

export type Hotspot = {
  lat: number;
  lng: number;
  weight: number;
  label: string;
  count: number;
};

export const BENGALURU_HOTSPOTS: Hotspot[] = [
  { lat: 12.9698, lng: 77.7499, weight: 1.0, label: "Whitefield", count: 47 },
  { lat: 12.9352, lng: 77.6245, weight: 0.7, label: "Koramangala", count: 31 },
  { lat: 12.9250, lng: 77.5938, weight: 0.45, label: "Jayanagar", count: 18 },
  { lat: 13.0358, lng: 77.5970, weight: 0.4, label: "Hebbal", count: 14 },
  { lat: 12.9784, lng: 77.6408, weight: 0.6, label: "Indiranagar", count: 24 },
  { lat: 13.1007, lng: 77.5963, weight: 0.3, label: "Yelahanka", count: 11 },
  { lat: 12.9081, lng: 77.6476, weight: 0.5, label: "HSR Layout", count: 21 },
  { lat: 12.9667, lng: 77.5667, weight: 0.55, label: "Rajajinagar", count: 22 },
];

type Mode = "heat" | "pins" | "grid";

export function CrimeMap({ mode = "heat" }: { mode?: Mode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const layerRef = useRef<any>(null);
  const LRef = useRef<any>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      await import("leaflet.heat");
      if (cancelled || !containerRef.current || mapRef.current) return;
      LRef.current = L;
      const map = L.map(containerRef.current, {
        center: [12.9716, 77.5946],
        zoom: 11,
      });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
        maxZoom: 19,
      }).addTo(map);
      mapRef.current = map;
      setReady(true);
    })();
    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const L = LRef.current;
    if (!map || !L || !ready) return;
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }

    if (mode === "heat") {
      const heat = (L as any).heatLayer(
        BENGALURU_HOTSPOTS.map((h) => [h.lat, h.lng, h.weight]),
        {
          radius: 45, blur: 35, maxZoom: 14, max: 1.0,
          gradient: { 0.2: "#3b82f6", 0.4: "#fbbf24", 0.7: "#f97316", 1.0: "#ef4444" },
        },
      );
      const labels = L.layerGroup();
      BENGALURU_HOTSPOTS.forEach((h) => {
        L.marker([h.lat, h.lng], {
          icon: L.divIcon({
            className: "",
            html: `<div style="background:#0a0a0a;color:#fff;padding:2px 8px;border:2px solid #0a0a0a;border-radius:5px;font-size:11px;font-weight:700;white-space:nowrap;box-shadow:2px 2px 0 0 #0a0a0a;">${h.label} · ${h.count}</div>`,
            iconSize: [0, 0],
            iconAnchor: [0, 0],
          }),
        }).addTo(labels);
      });
      const group = L.layerGroup([heat, labels]);
      group.addTo(map);
      layerRef.current = group;
    } else if (mode === "pins") {
      const group = L.layerGroup();
      BENGALURU_HOTSPOTS.forEach((h) => {
        L.circleMarker([h.lat, h.lng], {
          radius: 6 + h.weight * 10,
          color: "#0a0a0a", weight: 2,
          fillColor: "#ef4444", fillOpacity: 0.85,
        })
          .bindPopup(`<strong>${h.label}</strong><br/>${h.count} incidents`)
          .addTo(group);
      });
      group.addTo(map);
      layerRef.current = group;
    } else {
      const group = L.layerGroup();
      const cell = 0.015;
      BENGALURU_HOTSPOTS.forEach((h) => {
        const bounds = [
          [h.lat - cell, h.lng - cell],
          [h.lat + cell, h.lng + cell],
        ];
        L.rectangle(bounds, {
          color: "#0a0a0a", weight: 2,
          fillColor: h.weight > 0.7 ? "#ef4444" : h.weight > 0.4 ? "#f97316" : "#fbbf24",
          fillOpacity: 0.55,
        })
          .bindPopup(`<strong>${h.label}</strong><br/>${h.count} incidents`)
          .addTo(group);
      });
      group.addTo(map);
      layerRef.current = group;
    }
  }, [mode, ready]);

  return <div ref={containerRef} className="absolute inset-0 z-0 bg-muted" />;
}
