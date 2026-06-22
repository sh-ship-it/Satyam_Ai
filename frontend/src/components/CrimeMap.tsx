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
export function CrimeMap({
  points,
  mode = "heat",
  trail,
  animateKey,
  focus,
  signals,
  routePath,
  liveMarker,
  liveMarkers,
  routePaths,
  corridorPath,
  fitSignal,
  lockBounds,
  darkTiles,
}: {
  points: Hotspot[];
  mode?: Mode;
  trail?: Hotspot[];
  animateKey?: number;
  focus?: Hotspot[] | null;
  signals?: { id: number; junction_id: string; lat: number; lng: number; state: string }[];
  routePath?: Hotspot[];
  liveMarker?: Hotspot | null;
  liveMarkers?: Hotspot[];
  routePaths?: Hotspot[][];
  corridorPath?: [number, number][];
  /** Increment this number to trigger a one-shot fitBounds to the current corridorPath. */
  fitSignal?: number;
  /** When true, suppress the automatic fitBounds that fires when `points` changes. */
  lockBounds?: boolean;
  /** When true, use dark CARTO tiles instead of the default OSM light tiles. */
  darkTiles?: boolean;
}) {
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
      const tileUrl = darkTiles
        ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"
        : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
      const attribution = darkTiles ? "© OSM © CARTO" : "© OpenStreetMap contributors";
      L.tileLayer(tileUrl, { attribution, maxZoom: 19 }).addTo(map);
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

  // (Re)draw whenever points or mode change
  useEffect(() => {
    const map = mapRef.current;
    const L = LRef.current;
    if (!map || !L || !ready) return;
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }
    if (!points.length) return;

    const maxW = Math.max(...points.map((p) => p.weight), 1);
    const norm = (w: number) => Math.max(0.15, w / maxW);

    let group: any;
    if (mode === "heat") {
      const heat = (L as any).heatLayer(
        points.map((h) => [h.lat, h.lng, norm(h.weight)]),
        {
          radius: 35,
          blur: 28,
          maxZoom: 14,
          max: 1.0,
          gradient: { 0.2: "#3b82f6", 0.4: "#fbbf24", 0.7: "#f97316", 1.0: "#ef4444" },
        },
      );
      group = L.layerGroup([heat]);
    } else if (mode === "pins") {
      group = L.layerGroup();
      points.forEach((h) => {
        L.circleMarker([h.lat, h.lng], {
          radius: 5 + norm(h.weight) * 12,
          color: "#0a0a0a",
          weight: 2,
          fillColor: "#ef4444",
          fillOpacity: 0.85,
        })
          .bindPopup(`<strong>${h.label ?? "Area"}</strong><br/>${Math.round(h.weight)} incidents`)
          .addTo(group);
      });
    } else {
      group = L.layerGroup();
      const cell = 0.02;
      points.forEach((h) => {
        const w = norm(h.weight);
        L.rectangle(
          [
            [h.lat - cell, h.lng - cell],
            [h.lat + cell, h.lng + cell],
          ],
          {
            color: "#0a0a0a",
            weight: 1,
            fillColor: w > 0.7 ? "#ef4444" : w > 0.4 ? "#f97316" : "#fbbf24",
            fillOpacity: 0.5,
          },
        )
          .bindPopup(`<strong>${h.label ?? "Area"}</strong><br/>${Math.round(h.weight)} incidents`)
          .addTo(group);
      });
    }
    group.addTo(map);
    layerRef.current = group;

    // Fit map bounds to the returned points — skip when a sim route has taken over the viewport.
    if (!lockBounds) {
      try {
        const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng]));
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });
      } catch {
        /* ignore — e.g. single-point edge case */
      }
    }
  }, [points, mode, ready, lockBounds]);

  // Animated "connect the dots" offender trail
  const trailLayerRef = useRef<any>(null);
  useEffect(() => {
    const map = mapRef.current,
      L = LRef.current;
    if (!map || !L || !ready) return;
    if (trailLayerRef.current) {
      map.removeLayer(trailLayerRef.current);
      trailLayerRef.current = null;
    }
    if (!trail || trail.length === 0) return;

    const group = L.layerGroup().addTo(map);
    trailLayerRef.current = group;
    const latlngs = trail.map((p) => [p.lat, p.lng] as [number, number]);
    map.fitBounds(L.latLngBounds(latlngs).pad(0.25));

    const line = L.polyline([], {
      color: "#e11d48",
      weight: 3,
      opacity: 0.9,
      dashArray: "6 6",
    }).addTo(group);
    let i = 0;
    const step = () => {
      if (i >= trail.length || !trailLayerRef.current) return;
      const p = trail[i];
      L.circleMarker([p.lat, p.lng], {
        radius: 6,
        color: "#e11d48",
        fillColor: "#fb7185",
        fillOpacity: 0.9,
        weight: 2,
      })
        .bindTooltip(`${i + 1}. ${p.label ?? p.weight ?? ""}`)
        .addTo(group);
      line.addLatLng([p.lat, p.lng]);
      i += 1;
      if (i < trail.length) setTimeout(() => requestAnimationFrame(step), 600);
    };
    requestAnimationFrame(step);

    return () => {
      if (trailLayerRef.current) {
        map.removeLayer(trailLayerRef.current);
        trailLayerRef.current = null;
      }
    };
  }, [trail, animateKey, ready]);

  // Route polyline for dispatch (additive; no-op when trail is empty)
  const trailLineRef = useRef<any>(null);
  useEffect(() => {
    const map = mapRef.current,
      L = LRef.current;
    if (!map || !L || !ready) return;
    if (trailLineRef.current) {
      map.removeLayer(trailLineRef.current);
      trailLineRef.current = null;
    }
    if (!trail || trail.length < 2) return;
    trailLineRef.current = L.polyline(
      trail.map((p) => [p.lat, p.lng]),
      { color: "#91C5FD", weight: 5, opacity: 0.85 },
    ).addTo(map);
  }, [trail, ready]);

  // AI focus: highlight a specific person's crime locations and zoom in.
  const focusLayerRef = useRef<any>(null);
  useEffect(() => {
    const map = mapRef.current,
      L = LRef.current;
    if (!map || !L || !ready) return;
    if (focusLayerRef.current) {
      map.removeLayer(focusLayerRef.current);
      focusLayerRef.current = null;
    }
    if (!focus || focus.length === 0) return;

    const group = L.layerGroup().addTo(map);
    focusLayerRef.current = group;
    focus.forEach((p, i) => {
      const m = L.circleMarker([p.lat, p.lng], {
        radius: 11,
        color: "#2563eb",
        weight: 3,
        fillColor: "#3b82f6",
        fillOpacity: 0.9,
      })
        .bindPopup(`<strong>${p.label ?? "Crime location"}</strong>`)
        .addTo(group);
      if (i === 0) m.openPopup();
    });
    try {
      const b = L.latLngBounds(focus.map((p) => [p.lat, p.lng] as [number, number]));
      map.fitBounds(b, { padding: [60, 60], maxZoom: 14 });
    } catch {
      /* single-point edge case */
    }

    return () => {
      if (focusLayerRef.current) {
        map.removeLayer(focusLayerRef.current);
        focusLayerRef.current = null;
      }
    };
  }, [focus, ready]);

  // Traffic signal overlay (green corridor — additive, optional)
  const signalLayerRef = useRef<any>(null);
  useEffect(() => {
    const map = mapRef.current,
      L = LRef.current;
    if (!map || !L || !ready) return;
    if (signalLayerRef.current) {
      map.removeLayer(signalLayerRef.current);
      signalLayerRef.current = null;
    }
    if (!signals || signals.length === 0) return;
    const group = L.layerGroup();
    signals.forEach((s) => {
      L.circleMarker([s.lat, s.lng], {
        radius: 6,
        color: "#1a1a1a",
        weight: 2,
        fillColor: s.state === "GREEN" ? "#00C896" : "#9ca3af",
        fillOpacity: 0.95,
      })
        .bindTooltip(`${s.junction_id} · ${s.state}`)
        .addTo(group);
    });
    group.addTo(map);
    signalLayerRef.current = group;
  }, [signals, ready]);

  // --- Response-Ops: static dispatch route line ---
  const routePathRef = useRef<any>(null);
  useEffect(() => {
    const map = mapRef.current,
      L = LRef.current;
    if (!map || !L || !ready) return;
    if (routePathRef.current) {
      map.removeLayer(routePathRef.current);
      routePathRef.current = null;
    }
    if (!routePath || routePath.length < 2) return;
    routePathRef.current = L.polyline(
      routePath.map((p: Hotspot) => [p.lat, p.lng]),
      {
        color: "#91C5FD",
        weight: 5,
        opacity: 0.9,
      },
    ).addTo(map);
    // No fitBounds here — fitSignal handles zooming.
  }, [routePath, ready]);

  // --- Response-Ops: green-corridor glow ---
  const corridorRef = useRef<any>(null);
  useEffect(() => {
    const map = mapRef.current,
      L = LRef.current;
    if (!map || !L || !ready) return;
    if (corridorRef.current) {
      map.removeLayer(corridorRef.current);
      corridorRef.current = null;
    }
    if (!corridorPath || corridorPath.length < 2) return;
    const latlngs = corridorPath as [number, number][];
    const group = L.layerGroup();
    L.polyline(latlngs, { color: "#00C896", weight: 16, opacity: 0.18 }).addTo(group);
    L.polyline(latlngs, { color: "#00C896", weight: 8, opacity: 0.4 }).addTo(group);
    L.polyline(latlngs, { color: "#00E6A8", weight: 3, opacity: 0.95 }).addTo(group);
    group.addTo(map);
    corridorRef.current = group;
    // No fitBounds here — fitSignal handles zooming.
  }, [corridorPath, ready]);

  // --- One-shot fitBounds: fires only when fitSignal increments ---
  useEffect(() => {
    if (!fitSignal) return;
    const map = mapRef.current,
      L = LRef.current;
    if (!map || !L || !ready) return;
    const path =
      corridorPath ?? (routePath ? routePath.map((p) => [p.lat, p.lng] as [number, number]) : null);
    if (!path || path.length < 2) return;
    try {
      map.fitBounds(L.latLngBounds(path).pad(0.3), { maxZoom: 15, animate: true });
    } catch {}
  }, [fitSignal]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Response-Ops: pulse keyframes injected once (for the live marker) ---
  useEffect(() => {
    if (typeof document === "undefined" || document.getElementById("ops-pulse-kf")) return;
    const st = document.createElement("style");
    st.id = "ops-pulse-kf";
    st.textContent =
      "@keyframes opspulse{0%{transform:scale(.6);opacity:.9}100%{transform:scale(1.8);opacity:0}}";
    document.head.appendChild(st);
  }, []);

  // --- Response-Ops: single live patrol marker (animated vehicle) that PANS ---
  const liveMarkerRef = useRef<any>(null);
  // Only auto-pan on the very first placement; after that let the user control the map.
  const liveMarkerPlacedRef = useRef(false);
  useEffect(() => {
    if (!liveMarker) liveMarkerPlacedRef.current = false;
  }, [liveMarker]);
  useEffect(() => {
    const map = mapRef.current,
      L = LRef.current;
    if (!map || !L || !ready) return;
    if (!liveMarker) {
      if (liveMarkerRef.current) {
        map.removeLayer(liveMarkerRef.current);
        liveMarkerRef.current = null;
      }
      return;
    }
    const ll: [number, number] = [liveMarker.lat, liveMarker.lng];
    const isFirst = !liveMarkerRef.current;
    if (isFirst) {
      const icon = L.divIcon({
        className: "",
        html:
          `<div style="position:relative;display:flex;align-items:center;justify-content:center;width:30px;height:30px">` +
          `<span style="position:absolute;width:30px;height:30px;border-radius:9999px;background:#00C89644;animation:opspulse 1.4s ease-out infinite"></span>` +
          `<span style="position:relative;font-size:20px;line-height:1">\uD83D\uDE93</span></div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15],
      });
      liveMarkerRef.current = L.marker(ll, { icon }).addTo(map);
      if (liveMarker.label) liveMarkerRef.current.bindTooltip(liveMarker.label);
      // Pan only on first placement (not on every subsequent tick).
      if (!liveMarkerPlacedRef.current) {
        liveMarkerPlacedRef.current = true;
        if (!map.getBounds().contains(ll)) map.panTo(ll, { animate: true });
      }
    } else {
      liveMarkerRef.current.setLatLng(ll);
      // Never re-pan after initial placement — let the user zoom/pan freely.
    }
  }, [liveMarker, ready]);

  // --- Response-Ops: many live vehicle markers (Demo Simulation) ---
  const liveMarkersRef = useRef<any>(null);
  useEffect(() => {
    const map = mapRef.current,
      L = LRef.current;
    if (!map || !L || !ready) return;
    if (liveMarkersRef.current) {
      map.removeLayer(liveMarkersRef.current);
      liveMarkersRef.current = null;
    }
    if (!liveMarkers || liveMarkers.length === 0) return;
    const group = L.layerGroup();
    liveMarkers.forEach((m) => {
      const cm = L.circleMarker([m.lat, m.lng], {
        radius: 8,
        color: "#0B5",
        weight: 3,
        fillColor: "#00C896",
        fillOpacity: 1,
      });
      if (m.label) cm.bindTooltip(m.label);
      cm.addTo(group);
    });
    group.addTo(map);
    liveMarkersRef.current = group;
  }, [liveMarkers, ready]);

  // --- Response-Ops: many dispatch route lines (Demo Simulation) ---
  const routePathsRef = useRef<any>(null);
  useEffect(() => {
    const map = mapRef.current,
      L = LRef.current;
    if (!map || !L || !ready) return;
    if (routePathsRef.current) {
      map.removeLayer(routePathsRef.current);
      routePathsRef.current = null;
    }
    if (!routePaths || routePaths.length === 0) return;
    const group = L.layerGroup();
    routePaths.forEach((rp) => {
      if (rp.length < 2) return;
      L.polyline(
        rp.map((p) => [p.lat, p.lng]),
        { color: "#91C5FD", weight: 4, opacity: 0.85 },
      ).addTo(group);
    });
    group.addTo(map);
    routePathsRef.current = group;
  }, [routePaths, ready]);

  return <div ref={containerRef} className="absolute inset-0 z-0 bg-muted" />;
}
