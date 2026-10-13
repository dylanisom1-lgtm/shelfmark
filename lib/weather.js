// Weather from Open-Meteo (open-meteo.com): free, no key, for non-commercial use, data under
// CC BY 4.0. One request covers every saved place. No DOM here.

export const UNITS = {
  f: { label: '°F', temp: 'fahrenheit', wind: 'mph', windLabel: 'mph', precip: 'inch' },
  c: { label: '°C', temp: 'celsius', wind: 'kmh', windLabel: 'km/h', precip: 'mm' },
};

export function defaultUnits(locale = (globalThis.navigator && navigator.language) || 'en-US') {
  return /-(US|LR|MM|BS|BZ|KY|PW)$/i.test(locale) ? 'f' : 'c';
}

// WMO weather codes, as Open-Meteo reports them.
const CODES = {
  0: ['Clear', 'clear'],
  1: ['Mostly clear', 'clear'],
  2: ['Partly cloudy', 'partly'],
  3: ['Overcast', 'cloud'],
  45: ['Fog', 'fog'],
  48: ['Freezing fog', 'fog'],
  51: ['Light drizzle', 'drizzle'],
  53: ['Drizzle', 'drizzle'],
  55: ['Heavy drizzle', 'drizzle'],
  56: ['Freezing drizzle', 'sleet'],
  57: ['Freezing drizzle', 'sleet'],
  61: ['Light rain', 'rain'],
  63: ['Rain', 'rain'],
  65: ['Heavy rain', 'rain'],
  66: ['Freezing rain', 'sleet'],
  67: ['Freezing rain', 'sleet'],
  71: ['Light snow', 'snow'],
  73: ['Snow', 'snow'],
  75: ['Heavy snow', 'snow'],
  77: ['Snow grains', 'snow'],
  80: ['Rain showers', 'rain'],
  81: ['Rain showers', 'rain'],
  82: ['Heavy showers', 'rain'],
  85: ['Snow showers', 'snow'],
  86: ['Heavy snow showers', 'snow'],
  95: ['Thunderstorm', 'thunder'],
  96: ['Thunderstorm with hail', 'thunder'],
  99: ['Thunderstorm with hail', 'thunder'],
};

export function describeCode(code, isDay = true) {
  const [text, icon] = CODES[code] || ['Unknown', 'cloud'];
  return { text, icon: !isDay && (icon === 'clear' || icon === 'partly') ? icon + '-night' : icon };
}

// --- finding places -----------------------------------------------------------------------
export function geocodeUrl(query, lang = 'en') {
  const p = new URLSearchParams({ name: query.trim(), count: '6', language: lang.slice(0, 2), format: 'json' });
  return `https://geocoding-api.open-meteo.com/v1/search?${p}`;
}

export function parseGeocode(json) {
  const list = json && Array.isArray(json.results) ? json.results : [];
  return list
    .filter((r) => Number.isFinite(r.latitude) && Number.isFinite(r.longitude))
    .map((r) => ({
      name: String(r.name || ''),
      admin: String(r.admin1 || ''),
      country: String(r.country || ''),
      countryCode: String(r.country_code || ''),
      lat: Math.round(r.latitude * 1e4) / 1e4,
      lon: Math.round(r.longitude * 1e4) / 1e4,
    }));
}

// "Grand Rapids, Michigan" in the US, "Lyon, France" elsewhere.
export function placeLabel(p) {
  const second = p.countryCode === 'US' || !p.country ? p.admin : p.country;
  return second && second !== p.name ? `${p.name}, ${second}` : p.name;
}

// --- forecasts --------------------------------------------------------------------------
export function forecastUrl(places, units = 'f') {
  const u = UNITS[units] || UNITS.f;
  const p = new URLSearchParams({
    latitude: places.map((x) => x.lat).join(','),
    longitude: places.map((x) => x.lon).join(','),
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,is_day,precipitation,weather_code,wind_speed_10m,wind_gusts_10m',
    hourly: 'temperature_2m,precipitation_probability,weather_code,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset',
    timezone: 'auto',
    forecast_days: '3',
    forecast_hours: '13',
    temperature_unit: u.temp,
    wind_speed_unit: u.wind,
    precipitation_unit: u.precip,
  });
  return `https://api.open-meteo.com/v1/forecast?${p}`;
}

const round = (v) => (Number.isFinite(v) ? Math.round(v) : null);
const at = (arr, i) => (Array.isArray(arr) ? arr[i] : undefined);

// Open-Meteo answers with one object for one place, or a list for several.
export function parseForecast(json, count) {
  const list = Array.isArray(json) ? json : [json];
  if (list.length !== count || list.some((x) => !x || !x.current)) throw new Error('Unexpected weather data.');
  return list.map((f) => {
    const c = f.current;
    const d = f.daily || {};
    const h = f.hourly || {};
    const hours = (h.time || [])
      .map((t, i) => ({ time: t, temp: round(at(h.temperature_2m, i)), pop: round(at(h.precipitation_probability, i)), code: at(h.weather_code, i), isDay: at(h.is_day, i) !== 0 }))
      .filter((x) => x.time > c.time)
      .filter((x, i) => i % 2 === 1) // every two hours
      .slice(0, 6);
    const days = (d.time || []).map((t, i) => ({
      date: t,
      code: at(d.weather_code, i),
      max: round(at(d.temperature_2m_max, i)),
      min: round(at(d.temperature_2m_min, i)),
      pop: round(at(d.precipitation_probability_max, i)),
    }));
    return {
      time: c.time, // the place's own local time, as "2026-10-13T16:15"
      tz: f.timezone_abbreviation || '',
      temp: round(c.temperature_2m),
      feels: round(c.apparent_temperature),
      humidity: round(c.relative_humidity_2m),
      code: c.weather_code,
      isDay: c.is_day !== 0,
      wind: round(c.wind_speed_10m),
      gusts: round(c.wind_gusts_10m),
      precip: Number.isFinite(c.precipitation) ? c.precipitation : 0,
      today: days[0] || null,
      days,
      hours,
      sunrise: at(d.sunrise, 0) || null,
      sunset: at(d.sunset, 0) || null,
    };
  });
}

// "4 PM" for the place's own clock time; the string already is local to the place.
export function hourLabel(localIso) {
  const m = /T(\d{2}):(\d{2})/.exec(localIso || '');
  if (!m) return '';
  const d = new Date(Date.UTC(2000, 0, 1, Number(m[1]), Number(m[2])));
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', timeZone: 'UTC' }).format(d);
}

export function timeLabel(localIso) {
  const m = /T(\d{2}):(\d{2})/.exec(localIso || '');
  if (!m) return '';
  const d = new Date(Date.UTC(2000, 0, 1, Number(m[1]), Number(m[2])));
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(d);
}

export function dayLabel(isoDate, index) {
  if (index === 0) return 'Today';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate || '');
  if (!m) return '';
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])));
}
