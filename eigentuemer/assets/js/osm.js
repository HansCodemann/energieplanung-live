// osm.js — Nominatim (Adresssuche) + Overpass (Gebäude-Footprint)
// Doku: https://nominatim.org/release-docs/latest/api/Overview/
//       https://wiki.openstreetmap.org/wiki/Overpass_API

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const OVERPASS  = 'https://overpass-api.de/api/interpreter';

export async function geocode(query) {
  const url = `${NOMINATIM}?format=jsonv2&addressdetails=1&limit=6&countrycodes=de,at,ch&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { 'Accept': 'application/json' }});
  if (!res.ok) throw new Error('Geocoding fehlgeschlagen');
  const data = await res.json();
  return data.map(r => ({
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lon),
    label: r.display_name,
    type: r.type,
    addr: r.address || {}
  }));
}

/**
 * Holt Gebäude-Polygon in Umkreis von (lat,lng).
 * Nimmt das nächstliegende Gebäude, dessen Polygon den Punkt enthält
 * oder dem Punkt am nächsten ist.
 */
export async function fetchBuildingAt(lat, lng, radius = 40) {
  const query = `
    [out:json][timeout:15];
    (
      way(around:${radius},${lat},${lng})["building"];
      relation(around:${radius},${lat},${lng})["building"];
    );
    out body geom;
  `;
  const res = await fetch(OVERPASS, {
    method: 'POST',
    body: new URLSearchParams({ data: query }),
  });
  if (!res.ok) throw new Error('Overpass-Abfrage fehlgeschlagen');
  const data = await res.json();
  const features = (data.elements || [])
    .map(el => {
      if (el.type === 'way' && Array.isArray(el.geometry)) {
        const coords = el.geometry.map(p => [p.lat, p.lon]);
        return { id: `w${el.id}`, coords, tags: el.tags || {} };
      }
      if (el.type === 'relation' && Array.isArray(el.members)) {
        const outer = el.members.find(m => m.role === 'outer' && Array.isArray(m.geometry));
        if (!outer) return null;
        const coords = outer.geometry.map(p => [p.lat, p.lon]);
        return { id: `r${el.id}`, coords, tags: el.tags || {} };
      }
      return null;
    })
    .filter(Boolean);
  if (!features.length) return null;

  // Punkt-in-Polygon prüfen, sonst nächstes Polygon nach Zentroid-Distanz
  const hit = features.find(f => pointInPolygon([lat, lng], f.coords));
  if (hit) return hit;
  features.sort((a, b) => {
    const ca = centroid(a.coords), cb = centroid(b.coords);
    return haversine(lat, lng, ca[0], ca[1]) - haversine(lat, lng, cb[0], cb[1]);
  });
  return features[0];
}

// ---------- Geometrie-Utilities ----------

export function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = [poly[i][1], poly[i][0]];
    const [xj, yj] = [poly[j][1], poly[j][0]];
    const [x, y]   = [p[1], p[0]];
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

export function centroid(coords) {
  let lat = 0, lng = 0;
  for (const [la, ln] of coords) { lat += la; lng += ln; }
  return [lat / coords.length, lng / coords.length];
}

export function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Polygon-Fläche in m² (Shoelace auf Äquator-projiziertem Raster). */
export function polygonAreaM2(coords) {
  if (coords.length < 3) return 0;
  const c = centroid(coords);
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos(c[0] * Math.PI / 180);
  const pts = coords.map(([la, ln]) => [(ln - c[1]) * mPerDegLng, (la - c[0]) * mPerDegLat]);
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

/**
 * Ermittelt Hauptachse des Polygons (= wahrscheinliche Firstrichtung).
 * Liefert Azimut in Grad (0=Nord, 90=Ost) der LÄNGSTEN Kante.
 * Bei Rechteck-förmigen Häusern ist das in der Regel parallel zum First.
 */
export function dominantAzimuth(coords) {
  if (coords.length < 3) return 90;
  const c = centroid(coords);
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos(c[0] * Math.PI / 180);
  // längste Kante finden
  let maxLen = -1, bestAz = 90;
  for (let i = 0; i < coords.length - 1; i++) {
    const [la1, ln1] = coords[i];
    const [la2, ln2] = coords[i + 1];
    const dx = (ln2 - ln1) * mPerDegLng;
    const dy = (la2 - la1) * mPerDegLat;
    const len = Math.hypot(dx, dy);
    if (len > maxLen) {
      maxLen = len;
      // Azimut aus dx,dy: atan2(dx, dy) gibt 0 = Nord, 90 = Ost
      let az = Math.atan2(dx, dy) * 180 / Math.PI;
      if (az < 0) az += 360;
      // auf 0..180 normalisieren (Orientierungs-Symmetrie)
      if (az >= 180) az -= 180;
      bestAz = az;
    }
  }
  return Math.round(bestAz);
}

/** Bounding-Box des Polygons in Metern um Zentrum (dx, dy). */
export function bboxMeters(coords) {
  const c = centroid(coords);
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos(c[0] * Math.PI / 180);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [la, ln] of coords) {
    const x = (ln - c[1]) * mPerDegLng;
    const y = (la - c[0]) * mPerDegLat;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY, center: c };
}
