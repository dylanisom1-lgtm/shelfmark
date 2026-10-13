// Drive times for the traffic widget, from Google's Routes API with your own API key.
// Traffic-aware requests bill as "Compute Routes Pro": 5,000 a month free, then $10 per 1,000
// (Google's price list, October 2026). No DOM here.

export const ROUTES_ENDPOINT = 'https://routes.googleapis.com/directions/v2:computeRoutes';
export const FREE_PER_MONTH = 5000;

const LATLNG = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;
const dec = (s) => {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' ')).trim();
  } catch {
    return s.replace(/\+/g, ' ').trim();
  }
};

// Reads a Google Maps directions link:
//   https://www.google.com/maps/dir/Work+Address/Home+Address/@42.9,-85.6,12z/data=...
//   https://www.google.com/maps/dir/?api=1&origin=...&destination=...&waypoints=a|b
// Returns { origin, destination, via, link } or { error }.
export function parseMapsLink(input) {
  const raw = String(input || '').trim();
  let u;
  try {
    u = new URL(raw);
  } catch {
    return { error: 'That isn’t a link. Paste the whole address from Google Maps.' };
  }
  const host = u.hostname.toLowerCase();
  if (host === 'maps.app.goo.gl' || host === 'goo.gl') {
    return { error: 'Short share links can’t be read here. Open the link, then copy the full address from the address bar.' };
  }
  if (!/(^|\.)google\.[a-z.]+$/.test(host) || !u.pathname.startsWith('/maps')) {
    return { error: 'That isn’t a Google Maps link.' };
  }
  const sp = u.searchParams;
  if (sp.get('api') === '1' || sp.has('destination')) {
    const origin = (sp.get('origin') || '').trim();
    const destination = (sp.get('destination') || '').trim();
    if (!origin || !destination) return { error: 'The link needs a starting point and a destination.' };
    const via = (sp.get('waypoints') || '').split('|').map((s) => s.trim()).filter(Boolean);
    return { origin, destination, via, link: raw };
  }
  const m = /\/maps\/dir\/(.*)$/.exec(u.pathname);
  if (!m) return { error: 'That Google Maps link isn’t directions. Open directions between two places and copy that link.' };
  const parts = m[1].split('/');
  const stops = [];
  for (const p of parts) {
    if (p.startsWith('@') || p.startsWith('data=')) break;
    stops.push(dec(p));
  }
  while (stops.length && !stops[stops.length - 1]) stops.pop();
  if (stops.length < 2) return { error: 'The link needs a starting point and a destination.' };
  if (stops.some((s) => !s)) return { error: 'This link starts from “Your location”, which Shelfmark can’t know. Type the starting address instead.' };
  return { origin: stops[0], destination: stops[stops.length - 1], via: stops.slice(1, -1), link: raw };
}

export function mapsLinkFor(route) {
  if (route.link) return route.link;
  const p = new URLSearchParams({ api: '1', origin: route.origin, destination: route.destination, travelmode: 'driving' });
  if (route.via && route.via.length) p.set('waypoints', route.via.join('|'));
  return `https://www.google.com/maps/dir/?${p}`;
}

// "Work → Home" from the first part of each address.
export function defaultName(origin, destination) {
  const short = (s) => {
    const m = LATLNG.exec(s);
    if (m) return `${Number(m[1]).toFixed(3)}, ${Number(m[2]).toFixed(3)}`;
    return s.split(',')[0].trim().slice(0, 32);
  };
  return `${short(origin)} → ${short(destination)}`;
}

function waypoint(s) {
  const m = LATLNG.exec(s);
  if (m) return { location: { latLng: { latitude: Number(m[1]), longitude: Number(m[2]) } } };
  return { address: s };
}

export function usesMiles(locale = (globalThis.navigator && navigator.language) || 'en-US') {
  return /-(US|GB|LR|MM)$/i.test(locale);
}

export function routesRequest(route, key, { miles = usesMiles(), lang = (globalThis.navigator && navigator.language) || 'en-US' } = {}) {
  return {
    url: ROUTES_ENDPOINT,
    init: {
      method: 'POST',
      // The page sends no referrer by default; send the site's address here so a key
      // restricted to your github.io site is accepted.
      referrerPolicy: 'strict-origin-when-cross-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'routes.duration,routes.staticDuration,routes.distanceMeters,routes.description',
      },
      body: JSON.stringify({
        origin: waypoint(route.origin),
        destination: waypoint(route.destination),
        intermediates: (route.via || []).map(waypoint),
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_AWARE',
        units: miles ? 'IMPERIAL' : 'METRIC',
        languageCode: lang,
      }),
    },
  };
}

const seconds = (s) => {
  const m = /^(\d+(?:\.\d+)?)s$/.exec(String(s || ''));
  return m ? Math.round(Number(m[1])) : null;
};

export function parseRoutes(json) {
  const r = json && Array.isArray(json.routes) ? json.routes[0] : null;
  if (!r) return null; // no route between those places
  const duration = seconds(r.duration);
  if (duration === null) throw new Error('Unexpected answer from Google.');
  return {
    duration,
    typical: seconds(r.staticDuration),
    distance: Number.isFinite(r.distanceMeters) ? r.distanceMeters : null,
    via: r.description || '',
  };
}

// Plain words for what Google sent back when a request failed.
export function routesError(status, body) {
  const e = body && body.error ? body.error : null;
  const msg = e && e.message ? e.message : '';
  if (status === 400 && /API key not valid/i.test(msg)) return 'Google says the API key isn’t valid. Check it in Edit.';
  if (status === 403 && /referer|referrer/i.test(msg)) return 'Google refused the key for this address. Add this site to the key’s website restrictions, or remove them.';
  if (status === 403 && /billing/i.test(msg)) return 'Google needs billing turned on for the key’s project.';
  if (status === 403 && /not been used|disabled|not enabled/i.test(msg)) return 'Turn on the Routes API for the key’s project in Google Cloud.';
  if (status === 403) return `Google refused the request${msg ? `: ${msg}` : '.'}`;
  if (status === 429) return 'Google’s request limit was reached. It will try again later.';
  if (status === 400) return msg ? `Google couldn’t use this route: ${msg}` : 'Google couldn’t use this route.';
  return msg || `Google answered ${status}.`;
}

// --- how often to ask -------------------------------------------------------------------
export const INTERVALS = [5, 10, 15, 30, 60];

export function minutesOf(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function withinHours(now, hours) {
  if (!hours || !hours.limit) return true;
  if (hours.weekdays && (now.getDay() === 0 || now.getDay() === 6)) return false;
  const from = minutesOf(hours.from);
  const to = minutesOf(hours.to);
  if (from === null || to === null) return true;
  const t = now.getHours() * 60 + now.getMinutes();
  return from <= to ? t >= from && t < to : t >= from || t < to; // overnight spans wrap
}

// The most requests a month these settings allow, if Shelfmark were open the whole time.
export function monthlyEstimate({ routes, interval, hours }) {
  if (!routes) return 0;
  const perHour = 60 / interval;
  let hoursPerDay = 24;
  let days = 30.4;
  if (hours && hours.limit) {
    const from = minutesOf(hours.from);
    const to = minutesOf(hours.to);
    if (from !== null && to !== null) hoursPerDay = ((to - from + 1440) % 1440 || 1440) / 60;
    if (hours.weekdays) days = 21.7;
  }
  return Math.ceil(routes * perHour * hoursPerDay * days);
}

export function formatDuration(sec) {
  if (sec === null || sec === undefined) return '';
  const mins = Math.max(1, Math.round(sec / 60));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function formatDistance(meters, miles = usesMiles()) {
  if (meters === null || meters === undefined) return '';
  if (miles) {
    const mi = meters / 1609.344;
    return `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`;
  }
  const km = meters / 1000;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

// How bad the traffic is: the extra time against the same trip with no traffic.
export function trafficLevel(duration, typical) {
  if (!typical || duration <= typical) return 'light';
  const extra = duration - typical;
  if (extra < 120 || extra / typical < 0.1) return 'light';
  if (extra / typical < 0.3) return 'moderate';
  return 'heavy';
}
