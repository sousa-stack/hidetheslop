// The made-up feed: flips between the slop and what Hide the Slop leaves behind.
const feed = document.getElementById('feed');
const toggle = document.getElementById('toggle');
toggle.addEventListener('click', () => {
  const clean = feed.classList.toggle('clean');
  toggle.textContent = clean ? 'Show the slop' : 'Hide the slop';
});
