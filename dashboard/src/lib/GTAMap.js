"use client";
import { useEffect, useRef, useState } from "react";

// ── CALIBRATED CONVERSION ──
// Calculated from known GTA V landmarks:
//   LS Downtown (~400, -800)  → map center-south
//   Paleto Bay  (~0, 6300)    → map top
//   LSIA        (~-1000, -3000) → map bottom
//
// lat = gameY * SCALE + OFFSET_Y
// lng = gameX * SCALE + OFFSET_X

const SCALE_X = 0.01424;
const SCALE_Y = 0.01424;
const OFFSET_X = 58.87;
const OFFSET_Y = -119.59;

// ── RUNTIME DEPENDENCIES (third-party CDNs, fetched by the browser) ──
// Leaflet 1.9.4 (script + css) is loaded from jsDelivr and the map tiles come
// from Rockstar's Social Club renderer. Neither is vendored, so the map is
// blank when the viewer is offline, behind a blocking proxy, or if either host
// changes its URLs. The tile template is configurable at build time:
//   NEXT_PUBLIC_MAP_TILES=/map-tiles/{z}/{x}/{y}.jpg   (a vendored copy under public/)
// NEXT_PUBLIC_* values are inlined by Next at build time, so a change needs a rebuild.
const DEFAULT_TILE_URL = 'https://s.rsg.sc/sc/images/games/GTAV/map/render/{z}/{x}/{y}.jpg';
const TILE_URL = process.env.NEXT_PUBLIC_MAP_TILES || DEFAULT_TILE_URL;
const LEAFLET_JS = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js';
const LEAFLET_CSS = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css';

function gameToLatLng(gameX, gameY) {
  return [gameY * SCALE_Y + OFFSET_Y, gameX * SCALE_X + OFFSET_X];
}

const PALETTE = ['#6366f1','#22c55e','#ec4899','#f97316','#14b8a6','#8b5cf6','#06b6d4','#84cc16','#e11d48','#0ea5e9','#a855f7','#10b981'];
const TURF_COLORS = {};
let palIdx = 0;
function getColor(turf) {
  if (turf === 'Neutral') return '#ef4444';
  if (!TURF_COLORS[turf]) { TURF_COLORS[turf] = PALETTE[palIdx % PALETTE.length]; palIdx++; }
  return TURF_COLORS[turf];
}

// Popup markup is built as an HTML string for Leaflet; NPC names, types and
// positions are staff-entered text, so escape them.
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let leafletReady = null;
function loadLeaflet() {
  if (leafletReady) return leafletReady;
  leafletReady = new Promise(resolve => {
    if (typeof window === 'undefined') return resolve(null);
    if (window.L) return resolve(window.L);
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css'; link.rel = 'stylesheet';
      link.href = LEAFLET_CSS;
      document.head.appendChild(link);
    }
    const s = document.createElement('script');
    s.src = LEAFLET_JS;
    s.onload = () => resolve(window.L);
    s.onerror = () => { leafletReady = null; resolve(null); };
    document.head.appendChild(s);
  });
  return leafletReady;
}

function makeIcon(color) {
  return `<div style="width:12px;height:12px;border-radius:50%;background:${color};border:2px solid rgba(255,255,255,0.9);box-shadow:0 1px 4px rgba(0,0,0,0.5);"></div>`;
}

export default function GTAMap({ npcs, selectedTurf, height }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [debugCoord, setDebugCoord] = useState(null);

  useEffect(() => {
    let alive = true;
    loadLeaflet().then(L => {
      if (!alive) return;
      if (!L) { setFailed(true); return; }
      if (!containerRef.current || mapRef.current) return;

      const map = L.map(containerRef.current, {
        crs: L.CRS.Simple,
        minZoom: 2,
        maxZoom: 7,
        zoomControl: true,
        attributionControl: false,
      });

      L.tileLayer(TILE_URL, {
        minZoom: 0,
        maxZoom: 7,
        tileSize: 256,
        noWrap: true,
      }).addTo(map);

      // Center on the map — adjusted for recalibrated coords
      map.setView([-90, 60], 3);

      // Debug: click to show coordinates (helps with calibration)
      map.on('click', (e) => {
        const lat = e.latlng.lat;
        const lng = e.latlng.lng;
        // Reverse: gameY = (lat - OFFSET_Y) / SCALE_Y, gameX = (lng - OFFSET_X) / SCALE_X
        const gx = ((lng - OFFSET_X) / SCALE_X).toFixed(1);
        const gy = ((lat - OFFSET_Y) / SCALE_Y).toFixed(1);
        setDebugCoord({ lat: lat.toFixed(2), lng: lng.toFixed(2), gx, gy });
      });

      mapRef.current = map;
      setReady(true);
    });
    return () => { alive = false; if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } };
  }, []);

  // Markers
  useEffect(() => {
    if (!ready || !mapRef.current || !window.L) return;
    const L = window.L;
    const map = mapRef.current;

    markersRef.current.forEach(m => map.removeLayer(m));
    markersRef.current = [];
    palIdx = 0;
    Object.keys(TURF_COLORS).forEach(k => delete TURF_COLORS[k]);

    const filtered = selectedTurf ? npcs.filter(n => (n.turf || 'Neutral').trim().toLowerCase() === selectedTurf.toLowerCase()) : npcs;

    filtered.forEach(npc => {
      if (!npc.position) return;
      const parts = npc.position.trim().split(/\s+/);
      if (parts.length < 2) return;
      const gx = parseFloat(parts[0]);
      const gy = parseFloat(parts[1]);
      if (isNaN(gx) || isNaN(gy)) return;

      const turf = (npc.turf || 'Neutral').trim();
      const color = getColor(turf);
      const latlng = gameToLatLng(gx, gy);

      const icon = L.divIcon({
        className: '',
        html: makeIcon(color),
        iconSize: [12, 12],
        iconAnchor: [6, 6],
        popupAnchor: [0, -8],
      });

      const marker = L.marker(latlng, { icon }).addTo(map);
      const tpCmd = `/tppos ${npc.position.trim()}`;
      marker.bindPopup(`
        <div style="font-family:system-ui;min-width:150px;">
          <div style="font-weight:800;font-size:13px;margin-bottom:3px;">${esc(npc.name)}</div>
          <div style="font-size:11px;color:#888;">${esc(npc.npc_type || '')}</div>
          <div style="font-size:11px;color:${color};font-weight:600;margin-bottom:4px;">${esc(turf)}</div>
          <div style="font-size:10px;font-family:monospace;color:#666;margin-bottom:6px;">${esc(npc.position)}</div>
          <button type="button" data-tp="${esc(tpCmd)}" style="background:${color};color:white;border:none;padding:5px 10px;border-radius:4px;font-size:10px;font-weight:700;cursor:pointer;width:100%;">COPY TP</button>
        </div>
      `, { closeButton: true, className: 'gta-popup' });
      marker.on('popupopen', (e) => {
        const btn = e.popup.getElement()?.querySelector('button[data-tp]');
        if (btn) btn.onclick = () => { navigator.clipboard?.writeText(btn.getAttribute('data-tp') || ''); btn.textContent = 'COPIED'; };
      });

      markersRef.current.push(marker);
    });

    if (selectedTurf && markersRef.current.length > 0) {
      const group = L.featureGroup(markersRef.current);
      map.fitBounds(group.getBounds().pad(0.3));
    }
  }, [npcs, selectedTurf, ready]);

  return (
    <div style={{ position:'relative', width:'100%', height: height || 500 }}>
      {!ready && (
        <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', background:'var(--bg-2)', borderRadius:8, color:'var(--fg-4)' }}>
          {failed ? 'Map unavailable — the Leaflet library could not be loaded from its CDN.' : 'Loading map...'}
        </div>
      )}
      <div ref={containerRef} style={{ width:'100%', height:'100%', borderRadius:8, overflow:'hidden', background:'#1a1a24' }} />
      {debugCoord && (
        <div style={{ position:'absolute', bottom:10, left:10, zIndex:1000, background:'var(--bg-1)', border:'1px solid var(--border)', borderRadius:6, padding:'6px 10px', fontSize:11, fontFamily:'monospace', color:'var(--fg-2)' }}>
          Map: {debugCoord.lat}, {debugCoord.lng} | Game: {debugCoord.gx}, {debugCoord.gy}
          <button onClick={() => setDebugCoord(null)} style={{ marginLeft:8, color:'var(--fg-4)', background:'none', border:'none', cursor:'pointer' }}>✕</button>
        </div>
      )}
    </div>
  );
}
