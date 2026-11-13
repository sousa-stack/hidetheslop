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
  // The hash of the picture the crowd's list hid, for Report this. Set only when hide()
  // ran for that picture, and cleared by any later hide(), so a post hidden for another
  // reason never offers it.
  const crowdHashes = new WeakMap(); // hidden element -> phash
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
  // Red with a cross for AI, green with a tick for not AI, so the answers read at a glance,
  // and still apart if you can't tell red from green. Show is neutral: it isn't a verdict,
  // and neither is a plain link, which has no icon.
  const BAR_ICONS = {
    show: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    ai: '<path d="M6 6l12 12M18 6L6 18"/>',
    ok: '<path d="M4.5 12.5l5 5L19.5 7"/>',
  };

  // Sites draw their own dark mode, which prefers-color-scheme doesn't see, so look at
  // the background the bar will sit on.
  function onDarkPage(el) {
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      const m = getComputedStyle(node).backgroundColor.match(/[\d.]+/g);
      if (!m || (m.length > 3 && +m[3] === 0)) continue;
      return 0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2] < 128;
    }
    return false;
  }

  // `buttons` are [label, onClick, kind], kind being show, ai, ok or link.
  function addBar(el, text, buttons) {
    const ph = document.createElement('div');
    ph.className = 'hidetheslop-ph';
    const root = ph.attachShadow({ mode: 'open' });
    const dark = onDarkPage(el);
    root.innerHTML = `
      <style>
        :host { all: initial; display: block; }
        div { font: 13px/1.4 system-ui, sans-serif; color: ${dark ? '#b0b3b8' : '#65676b'};
              background: rgba(127,127,127,.08); border: 1px solid rgba(127,127,127,.3); border-radius: 8px;
              padding: 7px 8px 7px 12px; margin: 4px 0; display: flex; flex-wrap: wrap; gap: 8px 10px; align-items: center; }
        b { color: ${dark ? '#ff6b6b' : '#c80000'}; font-weight: 700; }
        span { flex: 1; min-width: 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        button { all: unset; cursor: pointer; white-space: nowrap; display: inline-flex; align-items: center; gap: 5px;
                 font-weight: 600; padding: 6px 11px; border-radius: 6px; }
        button:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
        button svg { width: 13px; height: 13px; flex: none; }
        .show { color: inherit; border: 1px solid currentColor; padding: 5px 10px; }
        .ai { color: #fff; background: #c80000; }
        .ok { color: #fff; background: #1d7a3e; }
        .ai:hover { background: #a30000; }
        .ok:hover { background: #166532; }
        .link { color: inherit; text-decoration: underline; text-underline-offset: 2px; padding: 6px 4px; }
      </style>
      <div><b>Hide the Slop</b><span></span></div>`;
    root.querySelector('span').textContent = text;
    for (const [label, onClick, kind] of buttons) {
      const b = document.createElement('button');
      b.type = 'button';
      if (kind) b.className = kind;
      if (BAR_ICONS[kind]) {
        b.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${kind === 'show' ? 2.4 : 3.2}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${BAR_ICONS[kind]}</svg>`;
      }
      b.append(label);
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


  // Returns whether it hid `el`.
  function hide(el, reason, picture) {
    if (!el || el.dataset.hidetheslop) return false;
    el.dataset.hidetheslop = 'hidden';
    crowdHashes.delete(el);
    hidden.push({ el, reason });

    if (settings.mode === 'remove') {
      el.classList.add(isMedia(el) ? 'hidetheslop-img-removed' : 'hidetheslop-removed');
    } else if (isMedia(el)) {
      el.classList.add('hidetheslop-img-blur');
      el.title = `Hide the Slop: ${reason}`;
    } else {
      el.classList.add('hidetheslop-collapsed');
      pictures.set(el, picture || biggestPicture(el));
      addBar(el, `hid this: ${reason}`, [['Show', () => showAndAsk(el), 'show']]);
    }
    report();
    return true;
  }

  // After Show, ask whether it really was AI. Your answer trains the picture check.
  function showAndAsk(el) {
    reveal(el, true);
    const picture = pictures.get(el);
    if (!picture || !settings.visualCheck) return;
    const buttons = [
      ['AI, hide it', () => {
        ask.remove();
        api.runtime.sendMessage({ type: 'learn', url: picture, label: 'ai', source: 'rated' }).catch(() => {});
        delete el.dataset.hidetheslop;
        hide(el, 'you said it was AI', picture);
      }, 'ai'],
      ['Not AI', () => {
        ask.remove();
        api.runtime.sendMessage({ type: 'learn', url: picture, label: 'real', source: 'rated' }).catch(() => {});
        const thanks = addBar(el, "got it, it'll learn from this", []);
        setTimeout(() => thanks.remove(), 2500);
      }, 'ok'],
    ];
    // A wrong crowd verdict hides the picture for everyone, so it can go to Kevin as well.
    const phash = crowdHashes.get(el);
    if (phash) {
      buttons.push(['Report this', () => {
        api.runtime.sendMessage({ type: 'reportPicture', phash }).catch(() => {});
      }, 'link']);
    }
    const ask = addBar(el, 'was this AI?', buttons);
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

  // Returns the element it hid, or null.
  function hideForImage(img, reason, picture = mediaUrl(img)) {
    const post = postOf(img);
    if (post && post.dataset.hidetheslop) return null; // already hidden, or the user chose to see it
    const el = post || img;
    return hide(el, reason, picture) ? el : null;
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
    api.runtime.sendMessage({ type: 'check', url: frame, picture: true }).then((r) => {
      // The classifier was trained on stills and is less sure of itself on video frames:
      // on a real feed it flagged a screen recording of music software.
      if (!r || !active() || r.score < Math.max(settings.visualCutoff, MIN_VIDEO_SCORE)) return;
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

    const meta = settings.scanImages && natural >= MIN_IMAGE_PX;
    if (url.startsWith('data:')) {
      if (!meta) return;
      try {
        const r = SlopMeta.scanDataUrl(url, 512 * 1024);
        if (r && (r.ai || (r.edited && settings.includeEdited))) hideForImage(img, r.reason.toLowerCase());
      } catch {
        /* not base64 */
      }
      return;
    }
    if (!/^https?:/.test(url)) return;

    const picture =
      settings.visualCheck && natural >= MIN_PICTURE_PX && Math.min(img.offsetWidth, img.offsetHeight) >= 150;
    if (!meta && !picture) return;
    api.runtime.sendMessage({ type: 'check', url, meta, picture }).then((r) => {
      if (!r || !active()) return;
      if (r.meta && (r.meta.ai || (r.meta.edited && settings.includeEdited))) {
        hideForImage(img, r.meta.reason.toLowerCase());
      } else if (r.crowd) {
        // Confirmed by people who share their ratings, so your robot's score doesn't matter.
        const el = hideForImage(img, 'the crowd flagged it');
        if (el && r.phash) crowdHashes.set(el, r.phash);
      } else if (r.score != null && r.score >= settings.visualCutoff) {
        hideForImage(img, 'the picture looks AI-made');
      }
    }, () => {});
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
      api.runtime.sendMessage({ type: 'learn', url: picture, label: 'ai', source: 'hid' }).catch(() => {});
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
  // often lay transparent boxes over their images, so look through those. But the first
  // picture found decides: a small one, or one drawn in SVG, is an avatar or icon, and
  // looking further would hand the button to whatever's behind it, such as a profile
  // photo's cover. Facebook draws avatars as an SVG <image>.
  function pictureAt(x, y) {
    for (const el of document.elementsFromPoint(x, y)) {
      if (el === chip) return chipFor;
      if (el instanceof SVGElement && (el.tagName === 'image' || el.querySelector('image'))) return null;
      if (!isMedia(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < MIN_PICTURE_PX || r.height < 150) return null; // avatars, icons, play buttons
      if (isRound(el, r)) return null;
      // A lone picture or video blurred in place has no bar to show it again, so the
      // button does that instead.
      if (el.dataset.hidetheslop === 'hidden') return el;
      if (el.closest('[data-hidetheslop="hidden"]')) return null;
      if (isBackdrop(el)) return null;
      return el;
    }
    return null;
  }

  // Off the feeds, a big photo with a headline drawn over it is the page's scenery, not
  // something anyone posted, so it gets no button. Looking through overlays is what puts
  // the button on it, and on the feeds that looking through is needed: carousel arrows,
  // "+3" tiles and captions over reels sit on real posts. So this never runs on a feed
  // site, and it's worked out once per picture from the layout, never on each mouse move.
  let backdrops = new WeakMap(); // picture -> true or false
  window.addEventListener('resize', () => (backdrops = new WeakMap()), { passive: true });

  function isBackdrop(pic) {
    if (site) return false;
    let known = backdrops.get(pic);
    if (known === undefined) {
      known = looksLikeBackdrop(pic);
      backdrops.set(pic, known);
    }
    return known;
  }

  function looksLikeBackdrop(pic) {
    if (pic.tagName === 'VIDEO' && pic.controls) return false; // made to be watched
    const r = pic.getBoundingClientRect();
    if (r.width < Math.min(window.innerWidth, scrollerWidth(pic)) * 0.6) return false;
    // Laid out as scenery: the picture, or a wrapper with the same box (what object-fit:
    // cover gives a picture filling its parent), is pinned to the window or pushed behind
    // the page. Absolute position alone doesn't count: many sites place an article's main
    // photo that way (Next.js images, for one), and an AI header on a blog post is exactly
    // the kind of picture the button is for.
    for (let node = pic, i = 0; node && node !== document.body && i < 5; node = node.parentElement, i++) {
      if (i && !sameBox(node.getBoundingClientRect(), r)) break;
      const style = getComputedStyle(node);
      if (style.position === 'fixed' || parseInt(style.zIndex, 10) < 0) return true;
    }
    // Or a block of text sits on it, from a part of the page beside it rather than around
    // it. Short bits like "+3", "ALT" or "0:15" are badges on a real picture. A fixed or
    // sticky menu bar only covers it because of where the page happens to be scrolled.
    for (let node = pic, i = 0; node.parentElement && node.parentElement !== document.documentElement && i < 4; node = node.parentElement, i++) {
      const kids = node.parentElement.children;
      for (let k = 0; k < kids.length && k < 100; k++) {
        const other = kids[k];
        if (other === node || other.classList.contains('hidetheslop-ph')) continue;
        if (!overlaps(other.getBoundingClientRect(), r) || !hasText(other, 20)) continue;
        if (!/fixed|sticky/.test(getComputedStyle(other).position)) return true;
      }
    }
    return false;
  }

  // The width the picture is measured against: its scrolling box's, or else the window's.
  function scrollerWidth(pic) {
    for (let node = pic.parentElement; node && node !== document.body; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (/auto|scroll|overlay/.test(style.overflowX + style.overflowY)) return node.clientWidth;
    }
    return window.innerWidth;
  }

  const sameBox = (a, b) =>
    Math.abs(a.left - b.left) < 2 && Math.abs(a.top - b.top) < 2 && Math.abs(a.right - b.right) < 2 && Math.abs(a.bottom - b.bottom) < 2;
  const overlaps = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;

  // Counts letters until it has enough, so a big neighbour costs no more than a small one.
  function hasText(el, min) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let count = 0;
    for (let n = walker.nextNode(), i = 0; n && i < 200; n = walker.nextNode(), i++) {
      count += n.data.replace(/\s+/g, '').length;
      if (count >= min) return true;
    }
    return false;
  }

  // A big square picture cut into a circle is a profile photo, not a post.
  function isRound(el, r) {
    if (Math.abs(r.width - r.height) > r.width * 0.1) return false;
    for (let node = el, i = 0; node && i < 3; node = node.parentElement, i++) {
      const style = getComputedStyle(node);
      if (/circle|ellipse/.test(style.clipPath)) return true;
      const radius = parseFloat(style.borderTopLeftRadius);
      if (style.borderTopLeftRadius.endsWith('%') ? radius >= 40 : radius >= r.width * 0.4) return true;
    }
    return false;
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
    const showing = pic.dataset.hidetheslop === 'hidden';
    const root = chip.attachShadow({ mode: 'closed' });
    root.innerHTML = `
      <style>
        button { all: unset; cursor: pointer; display: flex; align-items: center; gap: 6px;
                 font: 600 12px/1 system-ui, sans-serif; color: #fff; background: rgba(28,25,23,.88);
                 padding: 7px 10px 7px 8px; border-radius: 999px; box-shadow: 0 2px 8px rgba(0,0,0,.35); }
        button:hover { background: #b91c1c; }
        button.show:hover { background: #1c1917; }
        svg { width: 14px; height: 14px; }
      </style>
      ${
        showing
          ? `<button type="button" class="show" title="Hide the Slop hid this. Show it again">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
          <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>
        Show
      </button>`
          : `<button type="button" title="Hide the Slop: hide this and teach it what slop looks like">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
          <circle cx="12" cy="12" r="9.5"/><path d="M5.5 18.5l13-13"/></svg>
        Hide slop
      </button>`
      }`;
    // Keep the page from treating this as a click on its picture (opening a photo viewer).
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      chip.addEventListener(type, (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (type === 'click') {
          const target = chipFor;
          removeChip();
          if (target.dataset.hidetheslop === 'hidden') reveal(target, true);
          else hideByHand(target);
        }
      });
    }
    document.documentElement.append(chip);
    chipFor = pic;
  }

  document.addEventListener(
    'mousemove',
    (e) => {
      if (!active()) return;
      const now = Date.now();
      if (now - lastMove < 80) return;
      lastMove = now;
      let pic = pictureAt(e.clientX, e.clientY);
      // With the hover button off, it still appears to show a blurred picture again.
      if (pic && !settings.hoverButton && pic.dataset.hidetheslop !== 'hidden') pic = null;
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
