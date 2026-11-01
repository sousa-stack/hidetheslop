const api = SLOP_API;
const $ = (id) => document.getElementById(id);

const lines = (text) => [...new Set(text.split('\n').map((l) => l.trim()).filter(Boolean))];

let savedTimer = 0;
async function save(patch) {
  await api.storage.sync.set(patch);
  $('saved').textContent = 'Saved';
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => ($('saved').textContent = ''), 1200);
}

async function checkPermission() {
  const ok = await api.permissions.contains({ origins: SLOP_ORIGINS }).catch(() => true);
  $('perm').hidden = ok;
}

(async () => {
  const s = await slopGetSettings();
  $('version').textContent = `v${api.runtime.getManifest().version}`;

  // Switches with data-on/data-off say what they do right now: Hide when on, Show when off.
  function showWording(box) {
    if (!box.dataset.on) return;
    box.closest('label').querySelector('b').textContent = box.checked ? box.dataset.on : box.dataset.off;
  }
  for (const box of document.querySelectorAll('input[type=checkbox][data-key]')) {
    box.checked = !!s[box.dataset.key];
    showWording(box);
    box.addEventListener('change', () => {
      showWording(box);
      save({ [box.dataset.key]: box.checked });
    });
  }
  for (const radio of document.querySelectorAll('input[name=mode]')) {
    radio.checked = radio.value === s.mode;
    radio.addEventListener('change', () => save({ mode: radio.value }));
  }

  // Picture check: needs the model downloaded before it can be switched on.
  const vbox = $('visualCheck');
  const status = (t) => ($('visualStatus').textContent = t);
  async function showModelState() {
    const have = await SlopVision.isDownloaded();
    $('modelState').textContent = have ? 'Downloaded (89 MB).' : 'Not downloaded.';
    $('deleteModel').hidden = !have;
    if (vbox.checked && !have) status('The model is missing. Turn this off and on again to download it.');
  }
  vbox.checked = s.visualCheck;
  showWording(vbox);
  vbox.addEventListener('change', async () => {
    showWording(vbox);
    if (!vbox.checked) {
      status('');
      return save({ visualCheck: false });
    }
    vbox.disabled = true;
    try {
      await SlopVision.download((f) => status(`Downloading the model… ${Math.round(f * 100)}%`));
      status('');
      await save({ visualCheck: true });
    } catch (e) {
      vbox.checked = false;
      showWording(vbox);
      status(`Couldn't download the model: ${e.message}`);
    }
    vbox.disabled = false;
    showModelState();
  });
  $('deleteModel').addEventListener('click', async () => {
    await SlopVision.remove();
    vbox.checked = false;
    showWording(vbox);
    await save({ visualCheck: false });
    showModelState();
  });
  showModelState();

  // Ratings: kept in storage.local by background.js.
  async function showRatings() {
    const { visionRatings: r } = await api.storage.local.get('visionRatings');
    const ai = r ? r.ai.length : 0;
    const real = r ? r.real.length : 0;
    $('ratingCount').textContent = ai + real ? `${ai} rated AI, ${real} rated not AI.` : 'No ratings yet.';
    $('exportRatings').hidden = $('forgetRatings').hidden = !(ai + real);
  }
  $('exportRatings').addEventListener('click', async () => {
    const { visionRatings: r } = await api.storage.local.get('visionRatings');
    // Only the pictures' 512-number summaries, not the pictures or where they came from.
    const file = {
      about: 'Hide the Slop picture ratings: CLIP ViT-B/32 embeddings. Merge with eval/probe.mjs --export --with <file>.',
      saved: new Date().toISOString().slice(0, 10),
      ai: r.ai.map((x) => x.e),
      real: r.real.map((x) => x.e),
    };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: 'application/json' }));
    a.download = `hidetheslop-ratings-${file.saved}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  });
  $('forgetRatings').addEventListener('click', async () => {
    if (!window.confirm('Forget all your ratings and go back to the shipped classifier?')) return;
    await api.storage.local.remove(['visionRatings', 'visionModel']);
  });
  api.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.visionRatings) showRatings();
  });
  showRatings();

  const cutoff = $('visualCutoff');
  const showCutoff = () => ($('cutoffOut').textContent = `${cutoff.value}%`);
  cutoff.value = Math.round(s.visualCutoff * 100);
  showCutoff();
  cutoff.addEventListener('input', showCutoff);
  cutoff.addEventListener('change', () => save({ visualCutoff: cutoff.value / 100 }));

  $('keywords').value = s.keywords.join('\n');
  $('keywords').addEventListener('change', () => save({ keywords: lines($('keywords').value) }));
  $('disabledSites').value = s.disabledSites.join('\n');
  $('disabledSites').addEventListener('change', () => save({ disabledSites: lines($('disabledSites').value) }));

  const { blockedImages = [] } = await api.storage.local.get('blockedImages');
  $('blockedCount').textContent = blockedImages.length;
  $('clearImages').addEventListener('click', async () => {
    await api.storage.local.set({ blockedImages: [] });
    $('blockedCount').textContent = '0';
  });

  // Keep the textarea in sync when a right-click adds an account while this page is open.
  api.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.keywords && document.activeElement !== $('keywords')) {
      $('keywords').value = (changes.keywords.newValue || []).join('\n');
    }
  });

  $('grant').addEventListener('click', async () => {
    await api.permissions.request({ origins: SLOP_ORIGINS }).catch(() => {});
    checkPermission();
  });
  checkPermission();
})();
