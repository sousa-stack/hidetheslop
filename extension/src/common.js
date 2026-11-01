// Shared by the content script, background, popup and options page.
/* exported SLOP_API, SLOP_ORIGINS, SLOP_DEFAULTS, slopGetSettings, slopGetShare, slopIsFirefox, slopAskToShare */

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

// Firefox's own consent for sharing. Call it straight from a click, before any await,
// or Firefox refuses. It resolves to whether you said yes, and everywhere else that's
// yes, because the switch you just clicked is the consent.
function slopAskToShare() {
  if (!slopIsFirefox()) return Promise.resolve(true);
  return SLOP_API.permissions.request({ data_collection: ['websiteContent'] }).catch(() => false);
}
