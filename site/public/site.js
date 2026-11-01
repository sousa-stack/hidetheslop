// The sample feed: flips between the slop and what Hide the Slop leaves behind.
const feed = document.getElementById('feed');
const toggle = document.getElementById('toggle');
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;

toggle.addEventListener('click', () => {
  const clean = feed.classList.toggle('clean');
  toggle.textContent = clean ? 'Show the slop' : 'Hide the slop';
  // Hiding shrinks the feed, which would otherwise leave you looking at the next section.
  feed.querySelector('.slop').scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
});
