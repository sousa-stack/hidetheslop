// Finds AI content on the page and hides it.
//  - posts the site itself labels as AI ("AI info", "AI-generated", ...)
//  - posts with AI hashtags / "made with Midjourney" style text
//  - images whose file metadata says an AI made them (checked by background.js)
//  - the user's own blocked words, accounts and images
(() => {
  if (window.__hideTheSlop) return;
  window.__hideTheSlop = true;

  const api = SLOP_API;
  const TOP = window === window.top;
  const MIN_IMAGE_PX = 160;
  const MIN_PICTURE_PX = 200; // smaller than this is an icon or avatar, not worth the model's time
  const MIN_VIDEO_SCORE = 0.9;
  const isMedia = (el) => el.tagName === 'IMG' || el.tagName === 'VIDEO';
  const mediaUrl = (el) => (el.tagName === 'VIDEO' ? el.poster : el.currentSrc || el.src);

  // Exact text of the AI labels that platforms put on posts. Facebook has used
  // "Made with AI", then "AI info", then "AI content"; test against normalised text.
  const LABEL = new RegExp(
    '^(?:AI info|AI content|Contains AI content|Made with AI|AI[- ]generated|AI[- ]generated content|' +
      'Contains AI[- ]generated content|Creator labell?ed as AI[- ]generated|Altered or synthetic content|' +
      'Synthetic content|AI[- ]modified|AI[- ]edited|Edited with AI|Created with AI|Generated (?:by|with) AI|' +
      'Imagined with AI)$',
    'i'
  );
  const normalise = (t) => t.replace(/[\s ​]+/g, ' ').replace(/[‐-–]/g, '-').trim();
  const isLabel = (t) => t.length < 60 && LABEL.test(normalise(t));

  const HASHTAGS = [
    'aiart', 'aiartwork', 'aiartist', 'aiartcommunity', 'aigenerated', 'aigeneratedart', 'aigeneratedimage',
    'aiimage', 'aiimages', 'aiphotography', 'aifood', 'aifoodart', 'madewithai', 'createdwithai',
    'generativeai', 'genai', 'genaiart', 'midjourney', 'midjourneyart', 'midjourneyai', 'midjourneyv6',
    'midjourneyv7', 'dalle', 'dalle2', 'dalle3', 'stablediffusion', 'stablediffusionart', 'sdxl', 'fluxai',
    'leonardoai', 'adobefirefly', 'chatgptart', 'chatgptimage', 'soraai', 'ideogram', 'grokimagine',
    'imaginedwithai', 'aiad', 'aiads',
  ];
  const HASHTAG_RE = new RegExp(`(?:^|[^\\w#])#(?:${HASHTAGS.join('|')})(?![\\w])`, 'i');
  const PHRASE_RE = new RegExp(
    '\\b(?:made|created|generated|designed|imagined|produced|edited) (?:with|by|using|in) ' +
      '(?:ai|midjourney|dall[·\\-]?e|chatgpt|stable diffusion|firefly|leonardo(?:\\.ai)?|ideogram|meta ai|gemini|grok|sora)\\b' +
      '|\\bai[- ]generated (?:image|photo|picture|art|artwork|flyer|poster|video|content)\\b',
    'i'
  );

  // Where posts live on the big feeds. `author` finds the poster for "always hide this account".
  const SITES = [
    {
      host: /(^|\.)facebook\.com$/,
      // Each feed item is a div[data-virtualized]; offscreen ones are kept as empty
      // placeholders (data-virtualized="true"). The others cover older layouts and comments.
      posts: 'div[data-virtualized], [aria-posinset], div[role="article"], [data-pagelet^="FeedUnit"]',
      author: '[data-ad-rendering-role="profile_name"] a, h2 a, h3 a, h4 a, strong a',
      sponsored: /^(?:Sponsored|Ad)$/i,
      scrambledSponsored: true,
    },
    {
      host: /(^|\.)instagram\.com$/,
      posts: 'article',
      author: 'header a[href^="/"]:not([href^="/explore"])',
      sponsored: /^(?:Sponsored|Ad)$/i,
    },
    {
      host: /(^|\.)threads\.(?:net|com)$/,
      posts: 'div[data-pressable-container="true"]',
      author: 'a[href^="/@"]',
      sponsored: /^Sponsored$/i,
    },
    {
      host: /(^|\.)(?:x|twitter)\.com$/,
      posts: 'article[data-testid="tweet"]',
      author: (post) => {
        const a = post.querySelector('[data-testid="User-Name"] a[href^="/"]');
        return a ? '@' + a.getAttribute('href').slice(1).split('/')[0] : '';
      },
      sponsored: /^(?:Ad|Promoted)$/i,
    },
    {
      host: /(^|\.)reddit\.com$/,
      posts: 'shreddit-post, shreddit-ad-post, article, .thing',
      author: (post) => {
        const name = post.getAttribute('author');
        if (name) return 'u/' + name;
        const a = post.querySelector('a[href*="/user/"]');
        return a ? a.textContent.trim() : '';
      },
      ads: 'shreddit-ad-post, .promotedlink',
      sponsored: /^Promoted$/i,
    },
    {
      host: /(^|\.)linkedin\.com$/,
      posts: '.feed-shared-update-v2, [data-urn^="urn:li:activity"], [data-id^="urn:li:activity"]',
      author: '.update-components-actor__title span[aria-hidden="true"], .update-components-actor__name',
      sponsored: /^Promoted(?: by .*)?$/i,
    },
    {
      host: /(^|\.)youtube\.com$/,
      posts:
        'ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-reel-item-renderer, ' +
        'ytd-reel-video-renderer, ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2, yt-lockup-view-model',
      author: 'ytd-channel-name a, #channel-name a, #text.ytd-channel-name',
      ads: 'ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, ytd-promoted-sparkles-web-renderer, ytd-promoted-video-renderer',
      sponsored: /^Sponsored$/i,
    },
    {
      host: /(^|\.)tiktok\.com$/,
      posts: '[data-e2e="recommend-list-item-container"], [data-e2e="user-post-item"], article',
      author: '[data-e2e="video-author-uniqueid"], [data-e2e="video-author-avatar"]',
      sponsored: /^(?:Sponsored|Ad)$/i,
    },
    {
      host: /(^|\.)pinterest\.[a-z.]+$/,
      posts: '[data-test-id="pin"], [data-grid-item="true"]',
      sponsored: /^(?:Promoted|Sponsored)(?: by .*)?$/i,
    },
  ];

  const HOST = globalThis.__slopTestHost || location.hostname; // test/harness.html pretends to be a feed
  const site = TOP ? SITES.find((s) => s.host.test(HOST)) : null;

  let settings = { ...SLOP_DEFAULTS };
  let blockedImages = new Set();
  let keywordRe = null;
  let hidden = []; // { el, reason }
  let postTextLen = new WeakMap();
  let seenImages = new WeakSet();
  let lastTarget = null;

  // ---- helpers -------------------------------------------------------------

  function active() {
    return settings.enabled && !settings.disabledSites.includes(HOST);
  }

  function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function buildKeywordRe() {
    const words = settings.keywords.map((k) => k.trim()).filter(Boolean);
    keywordRe = words.length ? new RegExp(`(?<![\\w])(?:${words.map(escapeRe).join('|')})(?![\\w])`, 'i') : null;
  }

  function imageKey(url) {
    try {
      const u = new URL(url, location.href);
      return u.origin + u.pathname;
    } catch {
      return url;
    }
  }

  function postOf(el) {
    if (!el || !el.closest) return null;
    if (site) return el.closest(site.posts);
    return el.closest('figure');
  }

  function hasBigMedia(el) {
    for (const m of el.querySelectorAll('img, video')) {
      if (m.offsetWidth >= 200 && m.offsetHeight >= 150) return true;
    }
    return false;
  }

  // For when the site's post markup isn't one we know (Facebook changes it often):
  // climb from the label to the smallest box that also holds the post's picture or video.
  function postAround(el) {
    const known = postOf(el);
    if (known) return known;
    const cap = window.innerHeight * 2.5;
    let fallback = null;
    for (let node = el.parentElement, i = 0; node && node !== document.body && i < 30; node = node.parentElement, i++) {
      if (node.offsetHeight > cap) break;
      if (hasBigMedia(node)) return node;
      if (!fallback && node.offsetHeight >= 120) fallback = node;
    }
    return fallback;
  }

  // Text that belongs to this post and not to a post nested inside it (comments, quoted posts).
  function ownText(post) {
    const parts = [];
    const walker = document.createTreeWalker(post, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const parent = n.parentElement;
      if (!parent || parent.closest('.hidetheslop-ph')) continue;
      if (parent.closest(site.posts) !== post) continue;
      parts.push(n.data);
    }
    return parts;
  }

  // Facebook sometimes writes "Sponsored" as separate one-letter fragments in a jumbled
  // order, with stray extras, to stop text matching. Check the letters are all there.
  function hasScrambledSponsored(texts) {
    const have = {};
    for (const t of texts) {
      const c = t.trim().toLowerCase();
      if (c.length === 1) have[c] = (have[c] || 0) + 1;
    }
    return Object.entries({ s: 2, p: 1, o: 2, n: 1, r: 1, e: 1, d: 1 }).every(([c, n]) => (have[c] || 0) >= n);
  }

  function ariaLabels(post) {
    const out = [];
    for (const el of post.querySelectorAll('[aria-label]')) {
      if (el.closest(site.posts) === post) out.push(el.getAttribute('aria-label'));
    }
    // Facebook writes "Sponsored" into a hidden element and points at it.
    for (const el of post.querySelectorAll('[aria-labelledby]')) {
      for (const id of el.getAttribute('aria-labelledby').split(/\s+/)) {
        const ref = document.getElementById(id);
        if (ref) out.push(ref.textContent);
      }
    }
    return out;
  }

  // ---- hiding --------------------------------------------------------------

  // The picture to learn from when you rate a hidden post: the one that got it
  // hidden, or else the biggest one in it.
  const pictures = new WeakMap(); // hidden element -> image URL
  function biggestPicture(el) {
    let best = null, bestArea = 0;
    for (const m of el.querySelectorAll('img, video[poster]')) {
      const url = mediaUrl(m);
      const area = m.offsetWidth * m.offsetHeight;
      if (/^https?:/.test(url) && Math.min(m.offsetWidth, m.offsetHeight) >= 150 && area > bestArea) {
        best = url;
        bestArea = area;
      }
    }
    return best;
  }

  // Our bar, inside `el` so it goes away when the site removes the post.
  // buttons: [[label, onClick], ...]
  function addBar(el, text, buttons) {
    const ph = document.createElement('div');
    ph.className = 'hidetheslop-ph';
    const root = ph.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        :host { all: initial; display: block; }
        div { font: 13px/1.4 system-ui, sans-serif; color: #6b6b6b; background: rgba(127,127,127,.08);
              border: 1px dashed rgba(127,127,127,.35); border-radius: 8px; padding: 8px 12px; margin: 4px 0;
              display: flex; gap: 12px; align-items: center; }
        b { color: #c80000; font-weight: 600; }
        span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        button { all: unset; cursor: pointer; color: inherit; text-decoration: underline; white-space: nowrap; }
      </style>
      <div><b>Hide the Slop</b><span></span></div>`;
    root.querySelector('span').textContent = text;
    for (const [label, onClick] of buttons) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      });
      root.querySelector('div').append(b);
    }
    el.prepend(ph);
    return ph;
  }

  function hide(el, reason, picture) {
    if (!el || el.dataset.hidetheslop) return;
    el.dataset.hidetheslop = 'hidden';
    hidden.push({ el, reason });

    if (settings.mode === 'remove') {
      el.classList.add(isMedia(el) ? 'hidetheslop-img-removed' : 'hidetheslop-removed');
    } else if (isMedia(el)) {
      el.classList.add('hidetheslop-img-blur');
      el.title = `Hide the Slop: ${reason}`;
    } else {
      el.classList.add('hidetheslop-collapsed');
      pictures.set(el, picture || biggestPicture(el));
      addBar(el, `hid this: ${reason}`, [['Show', () => showAndAsk(el)]]);
    }
    report();
  }

  // After Show, ask whether it really was AI. Your answer trains the picture check.
  function showAndAsk(el) {
    reveal(el, true);
    const picture = pictures.get(el);
    if (!picture || !settings.visualCheck) return;
    const ask = addBar(el, 'was this AI?', [
      ['AI, hide it', () => {
        ask.remove();
        api.runtime.sendMessage({ type: 'learn', url: picture, label: 'ai' }).catch(() => {});
        delete el.dataset.hidetheslop;
        hide(el, 'you said it was AI', picture);
      }],
      ['Not AI', () => {
        ask.remove();
        api.runtime.sendMessage({ type: 'learn', url: picture, label: 'real' }).catch(() => {});
        const thanks = addBar(el, "got it, it'll learn from this", []);
        setTimeout(() => thanks.remove(), 2500);
      }],
    ]);
  }

  function reveal(el, keepShown) {
    el.classList.remove('hidetheslop-removed', 'hidetheslop-collapsed', 'hidetheslop-img-blur', 'hidetheslop-img-removed');
    for (const ph of el.querySelectorAll(':scope > .hidetheslop-ph')) ph.remove();
    if (el.title && el.title.startsWith('Hide the Slop:')) el.removeAttribute('title');
    if (keepShown) el.dataset.hidetheslop = 'shown';
    else delete el.dataset.hidetheslop;
    hidden = hidden.filter((h) => h.el !== el);
    report();
  }

  function revealAll() {
    for (const { el } of [...hidden]) reveal(el, false);
    for (const el of document.querySelectorAll('[data-hidetheslop]')) delete el.dataset.hidetheslop;
    postTextLen = new WeakMap();
    seenImages = new WeakSet();
  }

  let reportTimer = 0;
  function report() {
    clearTimeout(reportTimer);
    reportTimer = setTimeout(() => {
      hidden = hidden.filter((h) => h.el.isConnected);
      const reasons = {};
      for (const { reason } of hidden) reasons[reason] = (reasons[reason] || 0) + 1;
      api.runtime.sendMessage({ type: 'stats', count: hidden.length, reasons }).catch(() => {});
    }, 300);
  }

  // ---- post checks ---------------------------------------------------------

  function checkPost(post) {
    if (post.dataset.hidetheslop) return;
    const texts = ownText(post);
    const len = texts.reduce((n, t) => n + t.length, 0);
    if (postTextLen.get(post) === len) return;
    postTextLen.set(post, len);

    const labels = ariaLabels(post);
    const shortBits = texts.map((t) => t.trim()).filter((t) => t && t.length < 60).concat(labels.map((l) => l.trim()));

    if (settings.labels) {
      const hit = shortBits.find(isLabel);
      if (hit) return hide(post, `the site labels it "${normalise(hit)}"`);
    }
    if (settings.hideSponsored && site.sponsored) {
      if (shortBits.some((t) => site.sponsored.test(t)) || (site.scrambledSponsored && hasScrambledSponsored(texts))) {
        return hide(post, 'sponsored post');
      }
    }
    const full = texts.join(' ');
    if (settings.hashtags) {
      const m = full.match(HASHTAG_RE) || full.match(PHRASE_RE);
      if (m) return hide(post, `says "${m[0].trim()}"`);
    }
    if (keywordRe) {
      const m = full.match(keywordRe) || labels.join(' ').match(keywordRe);
      if (m) return hide(post, `matches your blocked "${m[0]}"`);
    }
  }

  // ---- image checks --------------------------------------------------------

  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        checkImage(e.target);
      }
    },
    { rootMargin: '1200px 0px' }
  );

  function hideForImage(img, reason, picture = mediaUrl(img)) {
    const post = postOf(img);
    if (post && post.dataset.hidetheslop) return; // already hidden, or the user chose to see it
    hide(post || img, reason, picture);
  }

  // The frame a video is showing, as a data: URL, or null if it isn't ready yet.
  function grabFrame(video) {
    const side = Math.min(video.videoWidth, video.videoHeight);
    if (video.readyState < 2 || !side) return null;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const x = (video.videoWidth - side) / 2;
    const y = (video.videoHeight - side) / 2;
    try {
      canvas.getContext('2d').drawImage(video, x, y, side, side, 0, 0, 256, 256);
      return canvas.toDataURL('image/jpeg', 0.9);
    } catch {
      return null; // a video from another site that doesn't allow reading its pixels
    }
  }

  // Many feed videos have no thumbnail, so look at a frame of the video itself.
  function checkVideoFrame(video) {
    if (!settings.visualCheck || Math.min(video.offsetWidth, video.offsetHeight) < 150) return;
    const frame = grabFrame(video);
    if (!frame) {
      video.addEventListener('loadeddata', () => checkVideoFrame(video), { once: true });
      return;
    }
    api.runtime.sendMessage({ type: 'classify', url: frame }).then((p) => {
      // The classifier was trained on stills and is less sure of itself on video frames:
      // on a real feed it flagged a screen recording of music software.
      if (p == null || !active() || p < Math.max(settings.visualCutoff, MIN_VIDEO_SCORE)) return;
      hideForImage(video, 'the video looks AI-made', frame);
    }, () => {});
  }

  // `img` is an <img>, or a <video> whose poster (its thumbnail) we look at.
  function checkImage(img) {
    if (!active() || img.dataset.hidetheslop) return;
    const isVideo = img.tagName === 'VIDEO';
    if (isVideo && !img.poster) return checkVideoFrame(img);
    if (!isVideo && !img.complete) {
      img.addEventListener('load', () => checkImage(img), { once: true });
      return;
    }
    const url = mediaUrl(img);
    if (!url) return;
    if (blockedImages.has(imageKey(url))) return hideForImage(img, 'you hid this image before');
    const natural = isVideo ? Infinity : Math.max(img.naturalWidth, img.naturalHeight);

    // No AI metadata: ask the model what the picture looks like.
    const lookAtPicture = () => {
      if (!settings.visualCheck || !/^https?:/.test(url)) return;
      if (natural < MIN_PICTURE_PX || Math.min(img.offsetWidth, img.offsetHeight) < 150) return;
      api.runtime.sendMessage({ type: 'classify', url }).then((p) => {
        if (p == null || !active() || p < settings.visualCutoff) return;
        hideForImage(img, 'the picture looks AI-made');
      }, () => {});
    };
    const handle = (r) => {
      if (!active()) return;
      if (r && (r.ai || (r.edited && settings.includeEdited))) return hideForImage(img, r.reason.toLowerCase());
      lookAtPicture();
    };
    if (!settings.scanImages || natural < MIN_IMAGE_PX) return lookAtPicture();

    if (url.startsWith('data:')) {
      try {
        handle(SlopMeta.scanDataUrl(url, 512 * 1024));
      } catch {
        /* not base64 */
      }
    } else if (/^https?:/.test(url)) {
      api.runtime.sendMessage({ type: 'scan', url }).then(handle, () => {});
    }
  }

  // Look for AI labels anywhere on the page, so a post still gets caught when its
  // box doesn't match site.posts. Walks every text node, so at most once a second.
  let lastSweep = 0;
  function sweepLabels() {
    if (Date.now() - lastSweep < 1000) return;
    lastSweep = Date.now();
    const hits = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.parentElement && isLabel(n.data)) hits.push([n.parentElement, n.data]);
    }
    for (const el of document.querySelectorAll('[aria-label]')) {
      const label = el.getAttribute('aria-label');
      if (isLabel(label)) hits.push([el, label]);
    }
    for (const [el, text] of hits) {
      if (el.closest('[data-hidetheslop], .hidetheslop-ph')) continue;
      const post = postAround(el);
      if (post && !post.closest('[data-hidetheslop]')) hide(post, `the site labels it "${normalise(text)}"`);
    }
  }

  // ---- main loop -----------------------------------------------------------

  function scan() {
    if (!active()) return;
    if (site) {
      for (const post of document.querySelectorAll(site.posts)) checkPost(post);
      if (settings.labels) sweepLabels();
      if (settings.hideSponsored && site.ads) {
        for (const ad of document.querySelectorAll(site.ads)) hide(ad, 'sponsored post');
      }
    }
    for (const img of [...document.images, ...document.querySelectorAll('video')]) {
      if (seenImages.has(img)) continue;
      seenImages.add(img);
      io.observe(img);
    }
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      scan();
    }, 250);
  }

  const mo = new MutationObserver((records) => {
    for (const r of records) {
      // Lazy-loaded images swap their src after we first saw them.
      if (r.type === 'attributes' && isMedia(r.target) && !r.target.dataset.hidetheslop) {
        seenImages.delete(r.target);
      }
    }
    schedule();
  });

  // ---- right-click menu ----------------------------------------------------

  document.addEventListener('contextmenu', (e) => (lastTarget = e.target), true);

  function guessAuthor(post) {
    if (!site || !site.author || !post) return '';
    if (typeof site.author === 'function') return site.author(post) || '';
    for (const el of post.querySelectorAll(site.author)) {
      const t = el.textContent.trim();
      if (t && t.length < 80) return t;
    }
    return '';
  }

  // You marked something as slop (right-click or the hover button): hide its post,
  // keep hiding that image, and count it as an AI rating for the picture check.
  async function hideByHand(target, src) {
    const img = isMedia(target) ? target : null;
    const post = postOf(target);
    src = src || (img && (mediaUrl(img) || (img.tagName === 'VIDEO' && grabFrame(img))));
    if (src && /^https?:/.test(src)) {
      blockedImages.add(imageKey(src));
      const list = [...blockedImages].slice(-1000);
      await api.storage.local.set({ blockedImages: list });
    }
    const el = post || img || target;
    const picture = src && /^(https?|data):/.test(src) ? src : biggestPicture(el);
    if (picture && settings.visualCheck) {
      api.runtime.sendMessage({ type: 'learn', url: picture, label: 'ai' }).catch(() => {});
    }
    if (el.dataset.hidetheslop === 'shown') delete el.dataset.hidetheslop;
    hide(el, 'you hid this', picture);
  }

  async function onMenu(msg) {
    const target = lastTarget;
    if (!target) return;
    const post = postOf(target);

    if (msg.id === 'hide') hideByHand(target, msg.srcUrl);

    if (msg.id === 'block') {
      const name = window.prompt(
        'Hide the Slop: always hide posts that mention this account or word',
        guessAuthor(post)
      );
      if (!name || !name.trim()) return;
      const keywords = [...new Set([...settings.keywords, name.trim()])];
      await api.storage.sync.set({ keywords }); // storage.onChanged rescans the page
    }
  }

  api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'menu') onMenu(msg);
    if (msg.type === 'revealAll') {
      for (const { el } of [...hidden]) reveal(el, true);
    }
    if (msg.type === 'whereAmI' && TOP) {
      sendResponse({ host: HOST, supported: !!site });
    }
    return false;
  });

  // ---- hover button ----------------------------------------------------------
  // Rest the mouse on a big picture and a small "Hide slop" button appears in its
  // corner. It floats in its own layer above the page; the page's images are never
  // changed, and there is only ever one button.

  const HOVER_DELAY = 500;
  let chip = null; // the button's host element
  let chipFor = null; // the picture it's for
  let hoverCandidate = null;
  let hoverTimer = 0;
  let lastMove = 0;

  // The picture under the pointer, if it's big enough to be worth a button. Sites
  // often lay transparent boxes over their images, so look through everything there.
  function pictureAt(x, y) {
    for (const el of document.elementsFromPoint(x, y)) {
      if (el === chip) return chipFor;
      if (!isMedia(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < MIN_PICTURE_PX || r.height < 150) continue; // avatars, icons, play buttons
      if (el.closest('[data-hidetheslop="hidden"]')) return null;
      return el;
    }
    return null;
  }

  function removeChip() {
    if (chip) chip.remove();
    chip = chipFor = null;
  }

  function showChip(pic) {
    if (!pic.isConnected || !active()) return;
    removeChip();
    const r = pic.getBoundingClientRect();
    chip = document.createElement('div');
    chip.setAttribute(
      'style',
      `all: initial; position: fixed; z-index: 2147483647; top: ${Math.max(r.top, 0) + 8}px; ` +
        `left: ${Math.min(r.right, window.innerWidth) - 8}px; transform: translateX(-100%);`
    );
    const root = chip.attachShadow({ mode: 'closed' });
    root.innerHTML = `
      <style>
        button { all: unset; cursor: pointer; display: flex; align-items: center; gap: 6px;
                 font: 600 12px/1 system-ui, sans-serif; color: #fff; background: rgba(28,25,23,.88);
                 padding: 7px 10px 7px 8px; border-radius: 999px; box-shadow: 0 2px 8px rgba(0,0,0,.35); }
        button:hover { background: #b91c1c; }
        svg { width: 14px; height: 14px; }
      </style>
      <button type="button" title="Hide the Slop: hide this and teach it what slop looks like">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
          <circle cx="12" cy="12" r="9.5"/><path d="M5.5 18.5l13-13"/></svg>
        Hide slop
      </button>`;
    // Keep the page from treating this as a click on its picture (opening a photo viewer).
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      chip.addEventListener(type, (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (type === 'click') {
          const target = chipFor;
          removeChip();
          hideByHand(target);
        }
      });
    }
    document.documentElement.append(chip);
    chipFor = pic;
  }

  document.addEventListener(
    'mousemove',
    (e) => {
      if (!settings.hoverButton || !active()) return;
      const now = Date.now();
      if (now - lastMove < 80) return;
      lastMove = now;
      const pic = pictureAt(e.clientX, e.clientY);
      if (pic === hoverCandidate) return;
      hoverCandidate = pic;
      clearTimeout(hoverTimer);
      if (pic !== chipFor) removeChip();
      if (pic && pic !== chipFor) hoverTimer = setTimeout(() => showChip(pic), HOVER_DELAY);
    },
    { capture: true, passive: true }
  );
  window.addEventListener(
    'scroll',
    () => {
      clearTimeout(hoverTimer);
      hoverCandidate = null;
      removeChip();
    },
    { capture: true, passive: true }
  );

  // ---- settings ------------------------------------------------------------

  async function load() {
    settings = await slopGetSettings();
    const local = await api.storage.local.get({ blockedImages: [] });
    blockedImages = new Set(local.blockedImages);
    buildKeywordRe();
  }

  api.storage.onChanged.addListener(async (changes, area) => {
    if (area === 'sync') {
      await load();
      revealAll();
      scan();
    } else if (changes.blockedImages) {
      blockedImages = new Set(changes.blockedImages.newValue || []);
    }
    // Other local changes (your ratings, the retrained classifier) need nothing here.
  });

  load().then(() => {
    mo.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'srcset', 'poster'],
    });
    scan();
  });
})();
