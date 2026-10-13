# Shelfmark

Grouped bookmarks that open the way you want: in a private window, a new window, an app window without toolbars, a background tab, or by switching to the tab if it's already open.

Version 0.6.0. The same files run two ways:

- **As a website on GitHub Pages.** Nothing to install; works in any browser. A web page can't do everything an extension can (see the table below).
- **As a browser extension** in Chrome 121+, Edge 121+ and Firefox 140+, with every feature.

## Use it as a website (GitHub Pages)

1. Create a repository on GitHub, for example `shelfmark`, and upload everything in this folder. (`.nojekyll` is a hidden file that tells GitHub to serve the files as they are; it's optional.)
2. In the repository, open **Settings › Pages**. Under **Build and deployment**, set **Source** to **Deploy from a branch**, choose the `main` branch and the `/ (root)` folder, and click **Save**.
3. After a minute or so, Shelfmark is at `https://<your-username>.github.io/shelfmark/`. Open it and go through setup.

Your bookmarks are not stored in the repository. They stay in each browser's storage for that address, so the repository can be public without exposing them. Each browser and computer keeps its own set; use **Export backup** and **Import** to move them. To update Shelfmark, replace the files in the repository; GitHub republishes in about a minute and your bookmarks are untouched. Moving to a different address (a custom domain, a renamed repository) starts with empty storage, so export first.

Chrome and Edge can also install the site as an app with its own window and taskbar icon: use the install icon at the right end of the address bar.

### What works on the website

| | Website | Extension |
| --- | --- | --- |
| Layouts, groups, search, keyboard, import/export | Yes | Yes |
| Widgets and the search-box calculator | Yes | Yes |
| Outage feeds from Microsoft, Azure, AWS, Google, Slack | Only if the provider allows websites to read them | Yes, after you allow that site |
| New tab, same tab, app window | Yes | Yes |
| New window | A separate window without tabs (or Shift-click a link) | Yes |
| Background tab | Ctrl-click or middle-click a link | Yes |
| Private window | Link is copied to paste into one | Yes |
| Switch to the tab if already open | Only tabs Shelfmark opened, in this session; some browsers won't bring the tab forward, and Shelfmark says so | Any tab |
| Open all | Yes, as plain tabs; Firefox needs pop-ups allowed for the site | As a tab group |
| Open at browser start | Set Shelfmark as your home page (Settings shows how) | Built in |
| `bm` in the address bar | Add Shelfmark as a site search (Settings shows how); Enter opens the best match | Built in, with suggestions |
| Save the current page | Drag the **Save to Shelfmark** button from Settings to your bookmarks bar | Toolbar button and right-click menu |
| Site icons | Lettered tiles, or ask each site for its icon (Settings) | From the browser's cache (Chrome, Edge) |

The website and the extension keep separate bookmarks, even in the same browser.

For "switch to the tab if already open", the tab Shelfmark opens keeps a link back to the Shelfmark tab, because browsers only let a page find a tab it opened through that link. In principle the site in that tab could use it to redirect the Shelfmark tab. Other bookmarks open without that link.

## Install as an extension

The same folder (or zip) works in every browser.

### Chrome

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and choose this folder (the one containing `manifest.json`).
3. Click **Details** on Shelfmark and turn on **Allow in Incognito** if you'll use private-window bookmarks.
4. Pin the Shelfmark button from the puzzle-piece menu.

### Edge

1. Open `edge://extensions` and turn on **Developer mode** (left side).
2. Click **Load unpacked** and choose this folder.
3. Click **Details** on Shelfmark and turn on **Allow in InPrivate** if you'll use private-window bookmarks.
4. Show the button with the puzzle-piece menu › eye icon.

### Firefox

Firefox only keeps add-ons installed across restarts if Mozilla has signed them. Signing is free and can be private.

- **To try it out:** open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on…**, and choose the zip, or `manifest.json` in this folder. It stays until Firefox closes.
- **To keep it:** sign it as an *unlisted* add-on, which isn't published in the store. Sign in at [addons.mozilla.org/developers](https://addons.mozilla.org/developers/), choose **Submit a New Add-on**, pick **On your own**, and upload the zip. Automated checks usually finish within minutes; install the signed `.xpi` you get back by dragging it into Firefox. The command-line route is `web-ext sign --channel=unlisted`.
- **Firefox Developer Edition or Nightly** can run it unsigned: set `xpinstall.signatures.required` to `false` in `about:config`, then install the zip.

For private-window bookmarks: ☰ menu › **Add-ons and themes** › Shelfmark › set **Run in Private Windows** to **Allow**.

### Updating

Replace the files in the same folder and click the reload arrow on Shelfmark's card (`chrome://extensions` or `edge://extensions`). Chrome and Edge identify an unpacked extension by its folder, so loading a different folder starts an empty install. Firefox identifies Shelfmark by the ID in `manifest.json`, so a newly signed version keeps your data.

### How one package covers three browsers

`manifest.json` lists both kinds of background script. Chrome and Edge run `service_worker` and ignore `scripts`; Firefox runs `scripts` and ignores `service_worker`. Firefox's add-on ID, minimum version and data-collection declaration sit under `browser_specific_settings`, which Chrome and Edge ignore. Firefox also ignores the `favicon` permission, which only Chrome and Edge have. In the code, `lib/browser.js` picks the right API namespace and each browser's names for things.

### Packaging

```
node tools/build.mjs                 # ../shelfmark-builds/shelfmark-<version>.zip
node tools/build.mjs --out dist      # or anywhere you like
node tools/build.mjs --chrome-store  # also a copy without Firefox's manifest section
```

It needs Node 18 or later and nothing else. The zip leaves out `tools/`. Use the `--chrome-store` copy only if the Chrome Web Store rejects the regular one.

### Differences between browsers

| | Chrome | Edge | Firefox |
| --- | --- | --- | --- |
| Site icons | From the browser's cache | From the browser's cache | Lettered tiles (no icon API) |
| Address-bar suggestions | Styled | Styled | Plain text |
| Private-window setting | Allow in Incognito | Allow in InPrivate | Run in Private Windows |
| Opening that setting from Shelfmark | Button | Button | Spelled-out steps (Firefox blocks it) |
| Tab groups for Open all | Yes | Yes | Yes (Firefox 139+) |

Each browser keeps its own bookmarks. To move them across, use **Export backup** in one and **Import** in the other.

## First run

The first time Shelfmark opens, it walks through three steps: choose a layout, decide whether Shelfmark opens when the browser starts (and turn on private windows if you'll use them), then import a bookmarks file or start empty. Progress is saved after each step, so the browser reloading the extension when you change its private-window setting doesn't lose your place. Run it again any time from **Settings › Run setup again**.

## Layouts

Switch from the ⋯ menu › **Layout…**. Every layout shares the same search, open behaviors, dialogs and shortcuts.

| Layout | What it is | Good for |
| --- | --- | --- |
| Columns | Group panels in evenly filled columns | Seeing every group at once |
| List | One full-width outline with tags and when you last opened each link | Keyboard use, larger collections |
| Tiles | Large icons per group, like a speed dial | A small set of links you use daily |
| Sidebar | Group names on the left, one group on the right | Many groups |
| Table | Sortable columns; in Edit, tick rows to move, change or delete them together | Tidying up |
| Launcher | A search box and your most-used links | Searching instead of browsing |

**Row spacing** (comfortable or compact) is in the same dialog.

In Edit mode you can drag bookmarks and groups in Columns, List, Tiles and Sidebar. In Sidebar, drop a bookmark on a group name to move it there.

## Widgets

Turn widgets on in **Settings › Widgets**. The arrows there set their order. On wide screens they sit in a column to the right of your bookmarks; on narrower screens, and in Launcher, they go below the bookmarks so the bookmarks stay first.

| Widget | What it does |
| --- | --- |
| Calculator | Type a sum in the search box, like `1450*1.06`, `15% of 80`, `1450 + 6%`, `2^40`, `sqrt(2)` or `255 in hex`. The answer appears above your bookmarks and `Enter` copies it. Ordinary searches never show an answer; start with `=` to treat anything as a sum and see what's wrong with it. In the extension, `bm 1450*1.06` shows the answer in the address bar. On by default. |
| Clocks | Your time, UTC, and any cities or time zones you add, with the difference from your time and "Tomorrow" or "Yesterday" when the date differs. **Edit** adds, renames and removes them and switches between 12- and 24-hour. |
| Date math | Days between two dates, with months, weeks and weekdays (Monday to Friday), or a date plus or minus days, weeks, months, years or weekdays. Shows today's week number and day of the year. |
| Scratchpad | A plain-text note that saves as you type. Another Shelfmark tab picks up the change. **Clear** can be undone. |
| Subnet calculator | `10.20.0.0/22`, `192.168.1.10 255.255.255.0`, a wildcard mask, or an IPv6 prefix like `2001:db8::/48`. Shows network, mask, wildcard, broadcast, usable range, host count and the kind of range (private, CGNAT, link-local and so on). `↑` `↓` in the box change the prefix. |
| Timestamp converter | Unix time in seconds, milliseconds, microseconds or nanoseconds, Active Directory / Windows FILETIME (`lastLogonTimestamp`, `pwdLastSet`, `accountExpires`), LDAP time (`whenCreated`), or a written date. It guesses the kind from the number of digits; **Read as** overrides it. Shows your time, UTC, ISO 8601 and every other form. |

Click any result to copy it. These six run entirely in the page, so nothing you type in them is sent anywhere.

### Live widgets

These three fetch data while Shelfmark is showing, and pause when its tab is in the background. They pick up again as soon as you come back. Several Shelfmark tabs share one set of results instead of each asking.

| Widget | Source | Refreshes | What's sent |
| --- | --- | --- | --- |
| Weather | [Open-Meteo](https://open-meteo.com/), no key | Every 15 minutes | The coordinates of your saved places |
| Outages | Each service's own status page or feed | Every 3 minutes | Nothing about you; it reads public status pages |
| Traffic | Google's Routes API, with your own key | Every 5–60 minutes (10 by default), only in the hours you set | Your saved route addresses and your key |

**Weather.** Search for a city or postal code, add as many places as you like, and click a place for the next 12 hours, three days, wind, humidity and sunrise. °F or °C in Edit. Open-Meteo is free for non-commercial use and asks for credit, which the widget shows.

**Outages.** Pick from ready-made services or paste any status page address. Most status pages run on Atlassian Statuspage (Cloudflare, GitHub, Zoom, Jira, Dropbox, Box, Twilio, DigitalOcean, Datadog, Discord and thousands more) and work everywhere. Microsoft 365, Azure, AWS, Google Workspace, Google Cloud and Slack publish feeds that may not let websites read them; installed as an extension, Shelfmark asks to read that one site when you add it. Microsoft's public feed only lists widespread problems and ones that block the admin center; your tenant's full service health needs a sign-in.

When a service reports a problem, a banner appears at the top of Shelfmark and the widget turns red. **×** on the banner hides that alert until something changes (a new incident, or it gets worse); a service that recovers forgets the dismissal.

**Traffic.** Paste a Google Maps directions link (the full address from the browser, not a short `maps.app.goo.gl` link), or type From and To. Each route shows the drive time now, how much traffic adds, the route, distance and arrival time if you leave now; its name opens it in Google Maps. **Add return** makes the trip back.

Setting up a key (once):

1. In the [Google Cloud console](https://console.cloud.google.com/projectcreate), create a project and turn on billing. Google requires billing; traffic-aware requests are billed as "Compute Routes Pro", with 5,000 a month free and $10 per 1,000 after that (Google's price list in October 2026).
2. Turn on the [Routes API](https://console.cloud.google.com/apis/library/routes.googleapis.com).
3. Under [Credentials](https://console.cloud.google.com/apis/credentials), create an API key. Restrict it to the Routes API. For the website, also restrict it to **Websites** and add `https://<your-username>.github.io/*`. For the extension, leave application restrictions off.
4. Optional but sensible: on the Routes API's **Quotas** page, cap requests per day (200 is plenty).
5. Paste the key in the Traffic widget's Edit. It's kept in this browser only and left out of backups.

The widget's Edit shows how many requests a month your settings allow at most. Two routes every 10 minutes from 6:00 to 19:00 on weekdays is about 3,400, inside the free 5,000.

What the widgets hold (clock list, scratchpad, places, services, routes, last inputs) is saved in the browser with your bookmarks and included in backups. The Google key and the fetched results are not.

## Opening Shelfmark when the browser starts

Turn it on during setup or in **Settings › When … starts**. When the browser starts, Shelfmark takes the place of the empty new tab; if the browser reopens your previous tabs, Shelfmark is added in front of them; if a Shelfmark tab is already there, it's brought forward. This also happens when you open the first window after closing them all while the browser kept running in the background.

## Getting around

| Where | How |
| --- | --- |
| Main page | `Alt+Shift+K`, or **Open Shelfmark** in the toolbar popup |
| Save the current page | Toolbar button, or `Alt+Shift+S` |
| Save a page or link | Right-click › Save to Shelfmark › pick a group |
| Search from the address bar | Type `bm`, a space, then a few letters |

Change the two shortcuts at `chrome://extensions/shortcuts` or `edge://extensions/shortcuts`. In Firefox, use **Settings › Change shortcuts** in Shelfmark, or `about:addons` › ⚙ › **Manage Extension Shortcuts**.

## How links open

Every bookmark has an open behavior, inherited in three steps: the default in Settings, then the group, then the bookmark itself. The right-hand edge of each row shows the behavior when it differs from the default; faded glyphs come from the group.

| Behavior | What happens |
| --- | --- |
| New tab | Opens next to the Shelfmark tab |
| Background tab | Opens without leaving Shelfmark |
| Same tab | Replaces the Shelfmark tab |
| New window | Opens a new browser window |
| Private window | Uses the open private (Incognito or InPrivate) window if there is one, otherwise opens one |
| App window | Opens a window without the address bar or tabs |
| Switch to the open tab | Focuses a tab that's already open instead of opening another (see below) |

A tab counts as already open if it shows the bookmarked page, if Shelfmark opened it from that bookmark and it's still on the same site (so redirects don't break it), or if it's on the same site at or below the bookmarked path. A bookmark to a site's front page therefore counts any tab on that site. `www.` and http/https differences are ignored. When several tabs qualify, the one in your current window wins, then the most recently used.

Modifier keys override the stored behavior for one click or Enter: `Alt` private window, `Shift` new window, `Ctrl` (`⌘` on Mac) background tab. Middle-click opens a background tab.

**Open all** on a group opens its bookmarks as a tab group with the group's name and color. Bookmarks that resolve to a private window go to a private window, grouped the same way.

From the address bar, private, new-window and app-window bookmarks keep their behavior; everything else follows how you pressed Enter (`Enter` uses the current tab, `Alt+Enter` a new one).

## Keyboard on the main page

`/` or just start typing to search. `Enter` opens the highlighted match, or copies the answer when you've typed a sum. `↑` `↓` move between bookmarks, `←` `→` move sideways (the next column in Columns, the next group in List, the next tile in Tiles, back to the group list in Sidebar), `Alt+↑` `Alt+↓` reorder, `F2` edits, `Delete` deletes (with undo), `Esc` clears the search, `?` lists all of these.

Search matches names, sites, tags, notes, group names, paths and open behavior, so `private` lists every bookmark that opens privately.

## Your data

Everything lives in this browser: `chrome.storage.local` in the extension, the site's storage on the website. Nothing is sent anywhere, except what the live widgets fetch (see Live widgets).

- **Export backup** (⋯ menu or Settings) downloads a JSON file with every group, bookmark, setting and open count, and what the widgets hold.
- **Import** accepts a Shelfmark backup (add to what's there, or replace everything) or the bookmarks HTML file that Chrome, Firefox, Edge and Safari export. Each folder becomes a group. Every import can be undone from the toast that follows.

## Permissions

| Permission | Used for |
| --- | --- |
| `storage` | Saving your bookmarks |
| `tabs` | Switching to a tab that's already open, saving all tabs in a window |
| `tabGroups` | Naming and coloring the tab group made by Open all |
| `contextMenus` | Right-click › Save to Shelfmark |
| `favicon` | Chrome and Edge: showing site icons from the browser's own cache, so no third-party icon service sees your list |
| Optional: individual sites | Asked for one site at a time when you add an outage feed that doesn't let other pages read it (Microsoft, Azure, AWS, Google, Slack). Nothing is granted until you agree. |

## Files

```
manifest.json      Extension manifest (MV3)
background.js      Service worker: right-click menu, address-bar keyword, shortcut
app.html, js/app.js, css/app.css     Main page: state, events, dialogs
js/views.js        The six layouts and the layout picker
js/ui.js           Markup shared by the layouts (rows, groups, icons)
js/setup.js        First-run setup
popup.html, js/popup.js, css/popup.css   Toolbar popup
css/tokens.css     Colors, type and controls shared by both pages
lib/model.js       Data model and open-behavior inheritance
lib/store.js       Storage, change events, open counts
lib/open.js        Opening links, groups, private windows, tab reuse
lib/search.js      Fuzzy search used by the page and the address bar
lib/importers.js   Backup and bookmarks-HTML import/export
js/widgets.js      The widget panel: clocks, date math, scratchpad, subnet, timestamps
js/live.js         Weather, outages and traffic widgets
js/wkit.js         Small helpers shared by the widgets
lib/net.js         Fetching live data; asking the extension for a site
lib/weather.js     Open-Meteo requests and weather codes
lib/status.js      Statuspage, RSS/Atom and Slack status, and the ready-made services
lib/routes.js      Google Maps links, the Routes API, refresh hours and cost estimate
lib/calc.js        The search box's calculator (a parser; no eval)
lib/subnet.js      IPv4 and IPv6 subnet math
lib/timetools.js   Timestamp reading and date arithmetic
lib/browser.js     Extension, website or preview; which browser; its names for things
index.html         Website entry point; forwards to app.html
site.webmanifest   Lets Chrome and Edge install the website as an app
tools/build.mjs    Packages the extension as a zip
lib/icons.js       Inline SVG icons
fonts/             Atkinson Hyperlegible Next (SIL Open Font License, see fonts/OFL.txt)
```

The code uses plain ES modules with no build step.
