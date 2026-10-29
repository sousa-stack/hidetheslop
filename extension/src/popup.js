const api = SLOP_API;
const $ = (id) => document.getElementById(id);

(async () => {
  const settings = await slopGetSettings();
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });

  $('enabled').checked = settings.enabled;
  $('enabled').addEventListener('change', () => api.storage.sync.set({ enabled: $('enabled').checked }));
  $('options').addEventListener('click', () => api.runtime.openOptionsPage());

  const stats = await api.runtime.sendMessage({ type: 'tabStats', tabId: tab.id }).catch(() => null);
  if (stats) {
    $('count').textContent = stats.count;
    $('count-label').textContent = stats.count === 1 ? 'thing hidden on this page' : 'things hidden on this page';
    for (const [reason, n] of Object.entries(stats.reasons).sort((a, b) => b[1] - a[1])) {
      const li = document.createElement('li');
      li.textContent = n > 1 ? `${n} × ${reason}` : reason;
      $('reasons').append(li);
    }
  }

  $('reveal').addEventListener('click', async () => {
    await api.tabs.sendMessage(tab.id, { type: 'revealAll' }).catch(() => {});
    window.close();
  });

  const where = await api.tabs.sendMessage(tab.id, { type: 'whereAmI' }, { frameId: 0 }).catch(() => null);
  if (!where) {
    $('pause').disabled = true;
    $('pause').textContent = 'Not running on this page';
    $('reveal').disabled = true;
    return;
  }
  const paused = settings.disabledSites.includes(where.host);
  $('pause').textContent = paused ? `Resume on ${where.host}` : `Pause on ${where.host}`;
  $('pause').addEventListener('click', async () => {
    const sites = new Set(settings.disabledSites);
    if (paused) sites.delete(where.host);
    else sites.add(where.host);
    await api.storage.sync.set({ disabledSites: [...sites] });
    window.close();
  });
})();
