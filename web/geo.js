// Maidenhead locators, great-circle distance and bearing (no DOM: shared by the page and the Node tests).

/** Centre of a 4, 6 or 8 character locator as [lat, lon] in degrees; null for an invalid one. */
export function locToLatLon(loc) {
  const l = String(loc).trim().toUpperCase();
  if (!/^[A-R]{2}\d{2}([A-X]{2}(\d{2})?)?$/.test(l)) return null;
  const a = (i) => l.charCodeAt(i) - 65, d = (i) => l.charCodeAt(i) - 48;
  let lon = a(0) * 20 - 180 + d(2) * 2, lat = a(1) * 10 - 90 + d(3);
  let w = 2, h = 1;                                       // size of the last field
  if (l.length >= 6) { w = 2 / 24; h = 1 / 24; lon += a(4) * w; lat += a(5) * h; }
  if (l.length >= 8) { w /= 10; h /= 10; lon += d(6) * w; lat += d(7) * h; }
  return [lat + h / 2, lon + w / 2];
}

/** 6 character locator of a position in degrees. */
export function latLonToLoc(lat, lon) {
  const x = Math.min(Math.max(lon + 180, 0), 360 - 1e-9), y = Math.min(Math.max(lat + 90, 0), 180 - 1e-9);
  const A = (n) => String.fromCharCode(65 + n);
  return A(Math.floor(x / 20)) + A(Math.floor(y / 10)) + Math.floor((x % 20) / 2) + Math.floor(y % 10)
    + A(Math.floor((x % 2) * 12)) + A(Math.floor((y % 1) * 24));
}

/** Great-circle distance in km and initial bearing in degrees (0 = north) from a to b, both [lat, lon]. */
export function distBearing(a, b) {
  const r = Math.PI / 180, R = 6371;
  const [p1, l1] = [a[0] * r, a[1] * r], [p2, l2] = [b[0] * r, b[1] * r];
  const h = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin((l2 - l1) / 2) ** 2;
  const km = 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  const y = Math.sin(l2 - l1) * Math.cos(p2), x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(l2 - l1);
  return { km, deg: (Math.atan2(y, x) / r + 360) % 360 };
}
