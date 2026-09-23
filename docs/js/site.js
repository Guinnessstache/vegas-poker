// Site interactions: hero scene, gallery, tabs, copy buttons, nav.
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// Live 3D hero (falls back to a screenshot if WebGL is unavailable).
const heroEl = $('#hero-canvas');
const fallback = () => heroEl.classList.add('fallback');
import('./hero.js')
  .then(({ startHero }) => {
    const hero = startHero(heroEl, { onFail: fallback });
    if (!hero) return;
    const toast = $('#hand-toast');
    hero.onHand((name) => {
      toast.textContent = name;
      toast.classList.remove('show');
      void toast.offsetWidth;
      toast.classList.add('show');
    });
  })
  .catch((e) => { console.warn('hero failed', e); fallback(); });

// Nav background once scrolled
const nav = $('#nav');
const onScroll = () => nav.classList.toggle('scrolled', scrollY > 30);
addEventListener('scroll', onScroll, { passive: true });
onScroll();

// Gallery
$$('.thumb').forEach((t) => t.addEventListener('click', () => {
  $$('.thumb').forEach((x) => x.classList.toggle('active', x === t));
  const img = $('#gallery-img');
  img.classList.add('swap');
  setTimeout(() => {
    img.src = t.dataset.src;
    img.alt = t.querySelector('img').alt;
    $('#gallery-cap').textContent = t.dataset.cap;
    img.onload = () => img.classList.remove('swap');
  }, 150);
}));

// Tabs
$$('.tab').forEach((t) => t.addEventListener('click', () => {
  $$('.tab').forEach((x) => x.classList.toggle('active', x === t));
  $$('.panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === t.dataset.tab));
}));

// Copy buttons
$$('.code .copy').forEach((b) => b.addEventListener('click', async () => {
  const text = b.parentElement.querySelector('code').textContent;
  try { await navigator.clipboard.writeText(text); b.textContent = 'Copied'; }
  catch { b.textContent = 'Select & copy'; }
  setTimeout(() => { b.textContent = 'Copy'; }, 1600);
}));

// Reveal on scroll
const io = new IntersectionObserver((entries) => entries.forEach((e) => {
  if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
}), { threshold: 0.12 });
$$('.feature, .steps li, .stat, .gallery-main, .arch, details').forEach((el) => { el.classList.add('reveal'); io.observe(el); });
