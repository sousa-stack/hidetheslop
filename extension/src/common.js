// Shared by the content script, background, popup and options page.
/* exported SLOP_API, SLOP_ORIGINS, SLOP_DEFAULTS, slopGetSettings */

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
