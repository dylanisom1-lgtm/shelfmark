// Service status for the outages widget. Three kinds of source:
//   statuspage  Atlassian Statuspage's public JSON (most SaaS status pages). Browsers can read it
//               from any site.
//   feed        an RSS or Atom feed (Microsoft 365, Azure, AWS, Google). Most don't let pages on
//               other sites read them, so on the website they may be blocked; the extension can
//               read them once you allow it.
//   slack       Slack's own status API.
// Each is reduced to { level, summary, problems: [{ id, title, level, state, url, updated }] }.
// Levels, in order: ok, info (maintenance or a notice), warn (degraded), down (outage).

export const LEVEL_ORDER = ['ok', 'info', 'warn', 'down'];
export const worst = (levels) => levels.reduce((a, b) => (LEVEL_ORDER.indexOf(b) > LEVEL_ORDER.indexOf(a) ? b : a), 'ok');

export const LEVEL_TEXT = { ok: 'Operational', info: 'Maintenance or notice', warn: 'Degraded', down: 'Outage', unknown: 'Couldn’t check' };

export const PRESETS = [
  { id: 'm365', name: 'Microsoft 365', kind: 'feed', url: 'https://status.cloud.microsoft/', feed: 'https://status.cloud.microsoft/api/feed/mac',
    note: 'Microsoft’s public status page. It lists widespread issues and anything that stops admins reaching Service health; your tenant’s full health needs a sign-in.' },
  { id: 'azure', name: 'Azure', kind: 'feed', url: 'https://azure.status.microsoft/en-us/status', feed: 'https://rssfeed.azure.status.microsoft/en-us/status/feed/', presence: true },
  { id: 'gworkspace', name: 'Google Workspace', kind: 'feed', url: 'https://www.google.com/appsstatus/dashboard/', feed: 'https://www.google.com/appsstatus/dashboard/en/feed.atom', windowHours: 72 },
  { id: 'gcloud', name: 'Google Cloud', kind: 'feed', url: 'https://status.cloud.google.com/', feed: 'https://status.cloud.google.com/en/feed.atom', windowHours: 72 },
  { id: 'aws', name: 'AWS', kind: 'feed', url: 'https://health.aws.amazon.com/health/status', feed: 'https://status.aws.amazon.com/rss/all.rss' },
  { id: 'slack', name: 'Slack', kind: 'slack', url: 'https://slack-status.com/', feed: 'https://slack-status.com/api/v2.0.0/current' },
  { id: 'cloudflare', name: 'Cloudflare', kind: 'statuspage', url: 'https://www.cloudflarestatus.com' },
  { id: 'github', name: 'GitHub', kind: 'statuspage', url: 'https://www.githubstatus.com' },
  { id: 'zoom', name: 'Zoom', kind: 'statuspage', url: 'https://status.zoom.us' },
  { id: 'jira', name: 'Jira', kind: 'statuspage', url: 'https://jira-software.status.atlassian.com' },
  { id: 'dropbox', name: 'Dropbox', kind: 'statuspage', url: 'https://status.dropbox.com' },
  { id: 'box', name: 'Box', kind: 'statuspage', url: 'https://status.box.com' },
  { id: 'twilio', name: 'Twilio', kind: 'statuspage', url: 'https://status.twilio.com' },
  { id: 'digitalocean', name: 'DigitalOcean', kind: 'statuspage', url: 'https://status.digitalocean.com' },
  { id: 'datadog', name: 'Datadog', kind: 'statuspage', url: 'https://status.datadoghq.com' },
  { id: 'discord', name: 'Discord', kind: 'statuspage', url: 'https://discordstatus.com' },
];

export function sourceUrl(svc) {
  return svc.kind === 'statuspage' ? svc.url.replace(/\/+$/, '') + '/api/v2/summary.json' : svc.feed;
}

// Sources other than Statuspage usually need the extension's permission for their site.
export const needsSitePermission = (svc) => svc.kind !== 'statuspage';

// What someone typed into "any status page": a page address, a summary.json, or a feed.
export function guessSource(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  let u;
  try {
    u = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw);
  } catch {
    return { error: 'That isn’t a web address.' };
  }
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(u.hostname)) return { error: 'That isn’t a web address.' };
  const host = u.hostname.replace(/^www\./, '');
  if (host === 'slack-status.com' || host === 'status.slack.com') return { ...PRESETS.find((p) => p.id === 'slack') };
  const path = u.pathname;
  if (/\.(rss|atom|xml)$|\/(feed|rss)(\/|$)|feed\.atom|\/api\/feed\//i.test(path)) {
    return { kind: 'feed', url: u.origin + '/', feed: u.href, name: host };
  }
  const base = path.includes('/api/v2/') ? path.slice(0, path.indexOf('/api/v2/')) : path.replace(/\/+$/, '');
  return { kind: 'statuspage', url: u.origin + base, name: host, maybeFeed: u.href };
}

// --- Statuspage -------------------------------------------------------------------------
const INDICATOR = { none: 'ok', minor: 'warn', major: 'down', critical: 'down', maintenance: 'info' };
const IMPACT = { none: 'info', minor: 'warn', major: 'down', critical: 'down', maintenance: 'info' };
const COMPONENT = { degraded_performance: ['warn', 'degraded'], partial_outage: ['down', 'partial outage'], major_outage: ['down', 'major outage'], under_maintenance: ['info', 'maintenance'] };
const STATE = { investigating: 'Investigating', identified: 'Identified', monitoring: 'Monitoring', in_progress: 'In progress', verifying: 'Verifying' };

export function parseStatuspage(json) {
  if (!json || !json.status || !json.page) throw new Error('Not a Statuspage summary.');
  const open = (i) => !['resolved', 'postmortem', 'completed'].includes(i.status);
  const incidents = (json.incidents || []).filter(open).map((i) => ({
    id: i.id,
    title: i.name,
    level: IMPACT[i.impact] || 'warn',
    state: STATE[i.status] || '',
    url: i.shortlink || json.page.url,
    updated: Date.parse(i.updated_at) || null,
  }));
  const maint = (json.scheduled_maintenances || [])
    .filter((m) => m.status === 'in_progress' || m.status === 'verifying')
    .map((m) => ({ id: m.id, title: m.name, level: 'info', state: 'Maintenance', url: m.shortlink || json.page.url, updated: Date.parse(m.updated_at) || null }));
  const components = (json.components || [])
    .filter((c) => COMPONENT[c.status] && !c.group)
    .map((c) => ({ name: c.name, level: COMPONENT[c.status][0], text: COMPONENT[c.status][1] }));
  const level = worst([INDICATOR[json.status.indicator] || 'ok', ...incidents.map((i) => i.level), ...maint.map((m) => m.level), ...components.map((c) => c.level)]);
  return {
    name: json.page.name || '',
    level,
    summary: json.status.description || LEVEL_TEXT[level],
    problems: [...incidents, ...maint],
    components: components.slice(0, 4),
  };
}

// --- RSS and Atom feeds -----------------------------------------------------------------------
const RESOLVED_TITLE = /^\s*(\[?resolved\]?|resolved:)|\bservice is operating normally\b|\[resolved\]|\b(has been )?(resolved|mitigated|restored)\.?\s*$/i;
const MS_FINE = /^(available|serviceoperational|servicerestored|resolved|falsepositive|postincidentreviewpublished|restored|serviceavailable)$/i;
const MS_DOWN = /^(serviceinterruption|serviceoutage)$/i;
const DOWN_WORDS = /\b(outage|disruption|interruption|unavailable|down)\b/i;

function text(el, ...names) {
  for (const n of names) {
    const c = [...el.children].find((x) => x.localName === n);
    if (c && c.textContent.trim()) return c.textContent.trim();
  }
  return '';
}

function linkOf(el) {
  const l = [...el.children].find((x) => x.localName === 'link');
  if (!l) return '';
  return l.getAttribute('href') || l.textContent.trim();
}

// The same incident's updates share a title once "RESOLVED:" and "Informational message:"
// style prefixes are taken off.
function incidentKey(title) {
  return title
    .toLowerCase()
    .replace(/^\s*(\[?resolved\]?:?|resolved:)\s*/, '')
    .replace(/^[a-z ]{3,40}:\s+/, '')
    .replace(/\[resolved\]\s*/g, '')
    .trim();
}

export function parseFeed(xml, svc = {}, now = Date.now()) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const root = doc.documentElement;
  if (!root || doc.getElementsByTagName('parsererror').length || !/^(rss|feed|RDF)$/i.test(root.localName)) throw new Error('Not a feed.');
  const channel = root.localName === 'rss' ? [...root.children].find((x) => x.localName === 'channel') || root : root;
  const name = text(channel, 'title');
  const items = [...doc.getElementsByTagName('*')]
    .filter((el) => el.localName === 'item' || el.localName === 'entry')
    .map((el) => ({
      id: text(el, 'guid', 'id') || text(el, 'title'),
      title: text(el, 'title').replace(/\s+/g, ' '),
      url: linkOf(el),
      updated: Date.parse(text(el, 'pubDate', 'updated', 'published')) || null,
      status: text(el, 'status'),
    }))
    .filter((i) => i.title)
    .sort((a, b) => (b.updated || 0) - (a.updated || 0));

  const windowMs = (svc.windowHours || 24) * 3600e3;
  const seen = new Set();
  const problems = [];
  for (const i of items) {
    const key = incidentKey(i.title);
    if (seen.has(key)) continue; // an older update of an incident already decided
    seen.add(key);
    let open;
    if (i.status) open = !MS_FINE.test(i.status);
    else if (svc.presence) open = true; // feeds that only list current issues
    else open = !RESOLVED_TITLE.test(i.title) && i.updated !== null && now - i.updated < windowMs;
    if (!open) continue;
    const level = i.status ? (MS_DOWN.test(i.status) ? 'down' : 'warn') : DOWN_WORDS.test(i.title) ? 'down' : 'warn';
    const state = i.status ? i.status.replace(/([a-z])([A-Z])/g, '$1 $2') : '';
    problems.push({ id: i.id, title: i.title.length > 160 ? i.title.slice(0, 157) + '…' : i.title, level, state, url: i.url || svc.url, updated: i.updated });
  }
  const level = worst(problems.map((p) => p.level));
  return {
    name,
    level,
    summary: problems.length ? `${problems.length} open issue${problems.length === 1 ? '' : 's'}` : 'No current issues',
    problems: problems.slice(0, 4),
    components: [],
  };
}

// --- Slack ------------------------------------------------------------------------------
const SLACK = { outage: 'down', incident: 'warn', notice: 'info' };

export function parseSlack(json) {
  if (!json || typeof json.status !== 'string') throw new Error('Not Slack’s status.');
  const problems = (json.active_incidents || []).map((i) => ({
    id: String(i.id),
    title: i.title,
    level: SLACK[i.type] || 'warn',
    state: (i.services || []).slice(0, 3).join(', '),
    url: i.url || 'https://slack-status.com/',
    updated: Date.parse(i.date_updated) || null,
  }));
  const level = worst(problems.map((p) => p.level));
  return { name: 'Slack', level, summary: problems.length ? LEVEL_TEXT[level] : 'All systems go', problems, components: [] };
}

// A short fingerprint of what's wrong, so a dismissed alert comes back when it changes.
export function signature(result) {
  if (!result || result.level === 'ok' || result.level === 'info') return '';
  return result.level + ':' + result.problems.map((p) => p.id + '@' + p.level).sort().join('|');
}
