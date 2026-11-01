// The sample feed: flips between the slop and what Hide the Slop leaves behind.
const feed = document.getElementById('feed');
const toggle = document.getElementById('toggle');
const section = document.querySelector('.try');
const side = section.querySelector('.side');
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;

// On a phone the button waits offscreen until you've seen the first flyer, then slides
// up. It slides away again if you scroll back above it.
const flyerEnd = feed.querySelector('.slop .photo p');
const untilSeen = new IntersectionObserver(([entry]) => {
  section.classList.toggle('waiting', !entry.isIntersecting && entry.boundingClientRect.top > 0);
});
untilSeen.observe(flyerEnd);

toggle.addEventListener('click', () => {
  untilSeen.disconnect(); // hiding removes the flyer it watches
  const clean = feed.classList.toggle('clean');
  toggle.textContent = clean ? 'Show the slop' : 'Hide the slop';
  side.classList.add('used'); // the note has done its job
  // Hiding shrinks the feed, which would otherwise leave you looking at the next section.
  feed.querySelector('.slop').scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
});

// Plays once, the first time the button is on screen. Phones hide the note, so they
// just get the shake.
const doodle = document.querySelector('.doodle');
const shake = () => toggle.classList.add('shake');
new IntersectionObserver((seen, watcher) => {
  if (!seen[0].isIntersecting || calm) return;
  watcher.disconnect();
  if (getComputedStyle(doodle).display === 'none') return shake();
  side.classList.add('draw');
  doodle.querySelector('.tip').addEventListener('animationend', shake);
}, { threshold: 1 }).observe(toggle);
toggle.addEventListener('animationend', () => toggle.classList.remove('shake'));
