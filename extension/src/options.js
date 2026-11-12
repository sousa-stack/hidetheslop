const api = SLOP_API;
const $ = (id) => document.getElementById(id);

const lines = (text) => [...new Set(text.split('\n').map((l) => l.trim()).filter(Boolean))];

let savedTimer = 0;
function saved() {
  $('saved').textContent = 'Saved';
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => ($('saved').textContent = ''), 1200);
}
async function save(patch) {
  await api.storage.sync.set(patch);
  saved();
}

async function checkPermission() {
  $('perm').hidden = await slopCanSeeSites();
  // Safari doesn't let an extension ask for every site, so the button would do nothing there.
  // Show Safari's own steps instead.
  if (slopIsSafari()) {
    $('grant').hidden = true;
    $('permHelp').hidden = false;
  }
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
    const sentNote = share.checked ? " Ratings you've already shared can't be taken back." : '';
    if (!window.confirm(`Forget all your ratings and go back to the shipped classifier?${sentNote}`)) return;
    await api.storage.local.remove(['visionRatings', 'visionModel', 'ownVerdicts']);
    await api.runtime.sendMessage({ type: 'voteClear' }).catch(() => {});
    showVotes();
  });
  api.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.visionRatings) showRatings();
  });
  showRatings();

  // Sharing lives in storage.local, per install, so it has no data-key. The queue belongs
  // to the background, so the count and Send now go through messages.
  // Only what helps fix it, written by you: the version and browser, and nothing about the
  // page you were on unless you add it.
  const browser = slopIsSafari() ? 'Safari' : slopIsFirefox() ? 'Firefox' : 'Chrome, Edge or similar';
  const report = `What went wrong:\n\n\nWhich site, if it's about one (just the site, like facebook.com):\n\n\n---\nHide the Slop ${api.runtime.getManifest().version}, ${browser}`;
  $('reportProblem').href = `mailto:hello@hidetheslop.com?subject=${encodeURIComponent('Hide the Slop: a problem')}&body=${encodeURIComponent(report)}`;

  const share = $('shareRatings');
  async function showVotes(reply) {
    const votes = reply || (await api.runtime.sendMessage({ type: 'voteState' }).catch(() => null));
    const waiting = votes ? votes.waiting : 0;
    $('votes').hidden = !share.checked;
    $('voteCount').textContent = waiting ? `${waiting} ${waiting === 1 ? 'rating' : 'ratings'} waiting to send.` : 'Nothing waiting to send.';
    $('sendNow').hidden = !waiting;
    if (!share.checked) return;
    // Hide slop still hides the post with your robot off, so nothing else would tell you
    // that the rating didn't count.
    if (!vbox.checked) $('shareStatus').textContent = "Your robot is off, so your ratings can't count. Turn it on above.";
    else if (votes) $('shareStatus').textContent = votes.stuck ? "Couldn't send, try updating the extension." : '';
  }
  function showShare(on) {
    share.checked = on;
    showWording(share);
    showVotes();
  }
  // On click, not change, and before any await: Firefox only asks from inside a click.
  share.addEventListener('click', () => {
    $('shareStatus').textContent = '';
    if (!share.checked) {
      api.storage.local.set({ shareRatings: false }).then(saved);
      return showShare(false);
    }
    slopAskToShare().then(async (yes) => {
      if (yes) {
        await api.storage.local.set({ shareRatings: true });
        saved();
      } else {
        $('shareStatus').textContent = 'Firefox needs your OK to share, so this stayed off.';
      }
      showShare(yes);
    });
  });
  $('sendNow').addEventListener('click', async () => {
    const before = Number.parseInt($('voteCount').textContent, 10) || 0;
    $('sendNow').disabled = true;
    const reply = await api.runtime.sendMessage({ type: 'voteSend' }).catch(() => null);
    $('sendNow').disabled = false;
    await showVotes(reply);
    if (reply && reply.waiting >= before) $('voteCount').textContent = `Couldn't send those yet, so they'll try again later. ${before} waiting.`;
  });
  api.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.visualCheck) showVotes();
    if (area !== 'local') return;
    if (changes.shareRatings) showShare(changes.shareRatings.newValue === true);
    else if (changes.voteQueue) showVotes();
  });
  showShare(await slopGetShare());

  // The crowd's list is downloaded by the background, and only while your robot is on.
  const crowdBox = $('useCrowdList');
  async function showCrowd() {
    const say = (t, calm = true) => {
      $('crowdStatus').textContent = t;
      $('crowdStatus').classList.toggle('calm', calm);
    };
    if (!vbox.checked) return say('This needs your robot, which is off. Turn it on above.', false);
    if (!crowdBox.checked) return say('');
    const { crowdList, crowdFetchedAt } = await api.storage.local.get(['crowdList', 'crowdFetchedAt']);
    const n = Array.isArray(crowdList) ? crowdList.length : 0;
    if (!crowdFetchedAt) say('The list arrives within half an hour.');
    else say(n ? `${n.toLocaleString()} ${n === 1 ? 'picture' : 'pictures'} on the list.` : 'Nothing on the list yet.');
  }
  crowdBox.addEventListener('change', showCrowd);
  api.storage.onChanged.addListener((changes, area) => {
    if ((area === 'sync' && changes.visualCheck) || (area === 'local' && changes.crowdList)) showCrowd();
  });
  showCrowd();

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
    await checkPermission();
    // Safari may not grant every site from here, so say where its own switch is.
    $('permHelp').hidden = $('perm').hidden || !slopIsSafari();
  });
  checkPermission();
})();
