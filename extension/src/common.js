// Shared by the content script, background, popup and options page.
/* exported SLOP_API, SLOP_ORIGINS, SLOP_DEFAULTS, slopGetSettings, slopGetShare, slopIsFirefox, slopIsSafari,
   slopCanSeeSites, slopAskToShare, slopArmStrip, slopStripReady, slopRequestTimeout, slopBrowserName */

var SLOP_API = globalThis.browser ?? globalThis.chrome;

// Must match host_permissions in the manifest.
var SLOP_ORIGINS = ['http://*/*', 'https://*/*'];

var SLOP_DEFAULTS = {
  enabled: true,
  labels: true,         // the site's own "AI info" / "AI-generated" labels
  hashtags: true,       // #aiart, #midjourney, "made with AI" ...
  scanImages: true,     // C2PA / IPTC / generator metadata inside the image file
  includeEdited: true,  // also images marked as AI-edited (generative fill etc.)
  visualCheck: false,   // guess from the pixels with the downloaded model (vision.js)
  visualCutoff: 0.7,    // how sure the model must be before hiding
  useCrowdList: true,   // download the crowd's list of confirmed AI pictures and match it here (crowd.js)
  hideSponsored: false, // hide every sponsored/promoted post on social feeds
  hoverButton: true,    // "Hide slop" button when you rest the mouse on a big picture
  mode: 'placeholder',  // 'placeholder' leaves a "show" bar, 'remove' leaves nothing
  keywords: [],         // user's own words and accounts to hide
  disabledSites: [],
};

async function slopGetSettings() {
  const stored = await SLOP_API.storage.sync.get(SLOP_DEFAULTS);
  return { ...SLOP_DEFAULTS, ...stored };
}

// Sharing your ratings isn't in SLOP_DEFAULTS, because those live in storage.sync and
// agreeing on one laptop shouldn't turn it on for another. It's per install, and off
// unless it says exactly true.
async function slopGetShare() {
  const { shareRatings } = await SLOP_API.storage.local.get('shareRatings');
  return shareRatings === true;
}

// Only the Firefox build's manifest has this. A missing `data_collection` key can't be
// the test, because that only says the browser has no built-in consent.
function slopIsFirefox() {
  return !!SLOP_API.runtime.getManifest?.().browser_specific_settings?.gecko;
}

// Only the Safari build's manifest has this. Its own address is the fallback, so that a
// Safari that dropped the key from getManifest() still counts as Safari, and the checks
// below that only Safari gets can't be skipped by accident.
// Safari closes the background 30 s after an alarm wakes it, even mid-request, so the
// canary's two requests and a send have to fit inside that. Elsewhere there's no rush.
function slopRequestTimeout() {
  return slopIsSafari() ? 6000 : 15000;
}

function slopIsSafari() {
  if (SLOP_API.runtime.getManifest?.().browser_specific_settings?.safari) return true;
  return !!SLOP_API.runtime.getURL?.('').startsWith('safari-web-extension:');
}

// For the reports you email yourself: which browser, and nothing more specific.
function slopBrowserName() {
  return slopIsSafari() ? 'Safari' : slopIsFirefox() ? 'Firefox' : 'Chrome, Edge or similar';
}

// Whether you've allowed every site. Chrome grants it at install, so a check that fails
// there reads as yes rather than nagging. Safari grants it site by site and starts with
// none, so a failed check there reads as no.
function slopCanSeeSites() {
  return SLOP_API.permissions.contains({ origins: SLOP_ORIGINS }).catch(() => !slopIsSafari());
}

// Firefox's own consent for sharing. Call it straight from a click, before any await,
// or Firefox refuses. It resolves to whether you said yes, and everywhere else that's
// yes, because the switch you just clicked is the consent.
function slopAskToShare() {
  if (!slopIsFirefox()) return Promise.resolve(true);
  return SLOP_API.permissions.request({ data_collection: ['websiteContent'] }).catch(() => false);
}

// ---- Safari's Origin --------------------------------------------------------
// Safari puts safari-web-extension:// and a random id in the Origin of the background's
// requests, which would tie your votes together. origin-rules.json removes it, but in the
// spike a rule listed as enabled still let the id through, and it only stopped once the
// rulesets had been switched at runtime. So Safari re-arms the rule every time the
// background starts, and then proves it worked with a canary before anything goes to the
// API: one GET and one POST, shaped like a list download and a vote, to your own website,
// which answers only whether an extension Origin arrived, and keeps nothing. Chrome and
// Firefox never do either.
var SLOP_ORIGIN_CHECK = 'https://hidetheslop.com/.well-known/origin-check';
var SLOP_ORIGIN_HOSTS = ['https://hidetheslop.com/*', 'https://api.hidetheslop.com/*'];

var slopArmed = null;
var slopStripChecked = null;

// Switches the strip rule off and on. Cheap and local, so background.js does it first
// thing. A failure leaves the canary to say no.
function slopArmStrip() {
  if (!slopIsSafari()) return Promise.resolve(true);
  slopArmed ??= (async () => {
    const rules = SLOP_API.declarativeNetRequest;
    await rules.updateEnabledRulesets({ disableRulesetIds: ['strip-origin'] });
    await rules.updateEnabledRulesets({ enableRulesetIds: ['strip-origin'] });
    return (await rules.getEnabledRulesets()).includes('strip-origin');
  })().catch(() => false);
  return slopArmed;
}

async function slopOriginArrived(method) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), slopRequestTimeout());
  try {
    // The same options votes.js and crowd.js use, so it takes the path they take.
    const init = { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', redirect: 'error', signal: ctrl.signal };
    const res = await fetch(SLOP_ORIGIN_CHECK, method === 'POST' ? { ...init, method, headers: { 'content-type': 'application/json' }, body: '{}' } : init);
    if (res.status !== 200) return true;
    const json = JSON.parse(await res.text());
    return json?.extension !== false;
  } catch {
    return true; // offline, or anything unexpected, counts as a leak
  } finally {
    clearTimeout(timer);
  }
}

// Whether the API can be sent to in this run of the background: always on Chrome and
// Firefox. On Safari the canary goes once per run, sent by the first vote or list download
// that asks, never on waking, because Safari wakes the background for picture checks and
// a request then would follow your browsing. Without access to both hosts nothing goes,
// because Safari would then send a preflight that the rule can't touch.
async function slopStripReady() {
  if (!slopIsSafari()) return true;
  try {
    if (!(await SLOP_API.permissions.contains({ origins: SLOP_ORIGIN_HOSTS }))) return false;
  } catch {
    return false;
  }
  slopStripChecked ??= (async () => {
    if (!(await slopArmStrip())) return false;
    if (await slopOriginArrived('GET')) return false;
    return !(await slopOriginArrived('POST'));
  })().catch(() => false);
  return slopStripChecked;
}
