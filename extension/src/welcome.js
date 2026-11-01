const api = SLOP_API;
const $ = (id) => document.getElementById(id);

async function checkPermission() {
  const ok = await api.permissions.contains({ origins: SLOP_ORIGINS }).catch(() => true);
  $('perm').hidden = ok;
}

function offerDone(text, on) {
  $('offer').hidden = true;
  $('status').textContent = text;
  if (!on) return;
  $('pictureRule').textContent = 'Hide AI pictures nobody labeled';
  $('pictureRule').classList.remove('off');
}

(async () => {
  checkPermission();
  $('grant').addEventListener('click', async () => {
    await api.permissions.request({ origins: SLOP_ORIGINS }).catch(() => {});
    checkPermission();
  });

  const settings = await slopGetSettings();

  // Each sentence says what its switch does right now: Hide when on, Show when off.
  for (const box of document.querySelectorAll('input[data-key]')) {
    const rule = box.closest('.toggle').querySelector('.rule');
    const show = () => (rule.textContent = box.checked ? rule.dataset.on : rule.dataset.off);
    box.checked = !!settings[box.dataset.key];
    show();
    box.addEventListener('change', () => {
      show();
      api.storage.sync.set({ [box.dataset.key]: box.checked });
    });
  }

  // Unticked until you tick it. Same as the switch in Settings: on click, not change,
  // and before any await, because Firefox only asks from inside a click.
  const share = $('shareRatings');
  const shareRule = share.closest('.toggle').querySelector('.rule');
  const showShare = (on) => {
    share.checked = on;
    shareRule.textContent = on ? shareRule.dataset.on : shareRule.dataset.off;
  };
  showShare(await slopGetShare());
  share.addEventListener('click', () => {
    $('shareStatus').textContent = '';
    if (!share.checked) {
      api.storage.local.set({ shareRatings: false });
      return showShare(false);
    }
    slopAskToShare().then(async (yes) => {
      if (yes) await api.storage.local.set({ shareRatings: true });
      else $('shareStatus').textContent = 'Firefox needs your OK to share, so this stayed off.';
      showShare(yes);
    });
  });

  // Same as the switch in Settings: the setting only goes on once the model is here.
  if (settings.visualCheck && (await SlopVision.isDownloaded())) offerDone('The picture check is on.', true);

  $('turnOn').addEventListener('click', async () => {
    $('turnOn').disabled = $('later').disabled = true;
    const progress = (f) => ($('status').textContent = `Downloading the model… ${Math.round(f * 100)}%. Keep this page open.`);
    progress(0);
    try {
      await SlopVision.download(progress);
      await api.storage.sync.set({ visualCheck: true });
      offerDone('The picture check is on. Reload your tabs to use it on them.', true);
    } catch (e) {
      $('turnOn').textContent = 'Try again';
      $('turnOn').disabled = $('later').disabled = false;
      $('status').textContent = `Couldn't download the model: ${e.message}`;
    }
  });
  $('later').addEventListener('click', () => offerDone('You can turn it on any time in Settings.'));

  // A stand-in for the real button and bar in content.js, which only run on web pages.
  const post = document.querySelector('.demo-post');
  const bar = document.querySelector('.demo-bar');
  $('demoHide').addEventListener('click', () => {
    post.hidden = true;
    bar.hidden = false;
  });
  $('demoShow').addEventListener('click', () => {
    bar.hidden = true;
    post.hidden = false;
  });

  $('settings').addEventListener('click', () => api.runtime.openOptionsPage());
})();
