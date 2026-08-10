
// ══════════════════════════════════════════════
//  CONFIG
// ══════════════════════════════════════════════
const SUPABASE_URL      = 'https://havyahjklvinraoamcat.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_2iQW6DDVWX2cKfck5ikY_Q_rpfUJa4K';
// ══════════════════════════════════════════════

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const PAGE_SIZE = 8;

let ALL_PHOTOS        = [];
let homePhotos        = [];   // shuffled order for home tab
let newPhotos         = [];   // chronological order for new tab
let homeOffset        = 0;
let newOffset         = 0;
let homeFetching      = false;
let newFetching       = false;
let homeDone          = false;
let newDone           = false;

let currentUser       = null;
let currentEmail      = null;
let currentUserId     = null;
let userLikes         = [];
let userSaved         = [];
let lbScale = 1, toastT;
let loadingProfileForId = null;
let suppressAuthEvent   = false;

function imgUrl(storagePath) {
  return `${SUPABASE_URL}/storage/v1/object/public/photos/${storagePath}`;
}

// ── BOOTSTRAP ─────────────────────────────────
async function init() {
  applyTheme(localStorage.getItem('xcl_theme') || 'light');

  document.addEventListener('contextmenu', e => {
    if (e.target.tagName === 'IMG') e.preventDefault();
  });

  sb.auth.onAuthStateChange((event, session) => {
    if (suppressAuthEvent) return;
    if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session) {
      loadProfile(session.user);
    } else if (event === 'SIGNED_OUT') {
      currentUser = currentEmail = currentUserId = null;
      userLikes = []; userSaved = [];
      updateNavAvatar(false, '');
    }
  });

  await loadPhotos();
  setupInfiniteScroll();
}

async function loadPhotos() {
  document.getElementById('homeLoading').style.display = 'block';

  const { data: photos, error } = await sb
    .from('photos')
    .select('*')
    .order('added', { ascending: false });

  document.getElementById('homeLoading').style.display = 'none';

  if (error) {
    const msg = error.message || '';
    const isNoTable = msg.includes('does not exist') || msg.includes('42P01') || error.code === '42P01';
    document.getElementById('homeFeed').innerHTML = `
      <div class="empty-feed">
        <span class="material-symbols-outlined empty-icon" style="font-variation-settings:'FILL' 1,'wght' 400,'GRAD' 0,'opsz' 48">warning</span>
        <div class="empty-title">${isNoTable ? 'Setup needed' : 'Could not load photos'}</div>
        <p>${isNoTable
          ? 'Run <b>SUPABASE_SCHEMA.sql</b> in your Supabase SQL Editor first.'
          : msg
        }</p>
      </div>`;
    return;
  }

  ALL_PHOTOS = photos || [];

  // Build per-feed ordered arrays and reset pagination
  homePhotos   = [...ALL_PHOTOS].sort(() => Math.random() - 0.5);
  newPhotos    = [...ALL_PHOTOS];
  homeOffset   = 0; newOffset   = 0;
  homeDone     = false; newDone = false;
  homeFetching = false; newFetching = false;

  // Clear existing content
  document.getElementById('homeFeed').innerHTML = '';
  document.getElementById('newFeed').innerHTML  = '';
  setSentinel('homeSentinel', false, false);
  setSentinel('newSentinel',  false, false);

  const unlocked = getUnlocked();
  renderNextBatch('home');
  renderNextBatch('new');
  renderSearchGrid(ALL_PHOTOS, unlocked);

  document.getElementById('statPosts').textContent = ALL_PHOTOS.length;

  if (userLikes.length || userSaved.length || currentUser) {
    applyLikedSavedUI(userLikes, userSaved);
    renderProfileGrids(userLikes, userSaved);
  }
}

// ── INFINITE SCROLL HELPERS ────────────────────
function setSentinel(id, loading, done) {
  const el = document.getElementById(id);
  el.classList.toggle('loading', loading);
  el.classList.toggle('done', done);
}

function renderNextBatch(feed) {
  const iHome = feed === 'home';
  if (iHome ? homeFetching : newFetching) return;
  if (iHome ? homeDone     : newDone)     return;

  if (iHome) homeFetching = true; else newFetching = true;

  const photos   = iHome ? homePhotos : newPhotos;
  const offset   = iHome ? homeOffset : newOffset;
  const feedEl   = document.getElementById(iHome ? 'homeFeed' : 'newFeed');
  const emptyEl  = document.getElementById(iHome ? 'homeEmpty' : 'newEmpty');
  const sentinel = iHome ? 'homeSentinel' : 'newSentinel';
  const unlocked = getUnlocked();

  const batch = photos.slice(offset, offset + PAGE_SIZE);

  if (!batch.length && offset === 0) {
    emptyEl.style.display = 'block';
    setSentinel(sentinel, false, true);
  } else if (!batch.length) {
    setSentinel(sentinel, false, true);
  } else {
    setSentinel(sentinel, true, false);
    batch.forEach(p => feedEl.appendChild(makeCard(p, unlocked)));
    const nextOff = offset + batch.length;
    if (iHome) homeOffset = nextOff; else newOffset = nextOff;
    const isDone = nextOff >= photos.length;
    setSentinel(sentinel, false, isDone);
    if (iHome) homeDone = isDone; else newDone = isDone;
  }

  if (iHome) homeFetching = false; else newFetching = false;
}

function setupInfiniteScroll() {
  const appBody = document.getElementById('appBody');
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const id = entry.target.id;
      if (id === 'homeSentinel' && !homeDone && !homeFetching) renderNextBatch('home');
      if (id === 'newSentinel'  && !newDone  && !newFetching)  renderNextBatch('new');
    });
  }, { root: appBody, rootMargin: '0px 0px 200px 0px', threshold: 0 });

  observer.observe(document.getElementById('homeSentinel'));
  observer.observe(document.getElementById('newSentinel'));
}

async function loadProfile(user, goHome = false) {
  if (loadingProfileForId === user.id) return;
  loadingProfileForId = user.id;

  let { data: profile } = await sb
    .from('profiles')
    .select('username, email, likes, saved')
    .eq('id', user.id)
    .single();

  if (!profile) {
    const username = user.user_metadata?.username
      || user.email?.split('@')[0]?.replace(/[^a-z0-9_]/gi, '') + '_' + user.id.slice(0, 4)
      || 'user_' + user.id.slice(0, 6);

    const { data: created } = await sb
      .from('profiles')
      .upsert({
        id: user.id, username, email: user.email,
        likes: [], saved: [], joined: new Date().toISOString(),
      }, { onConflict: 'id' })
      .select('username, email, likes, saved')
      .single();

    profile = created || { username, email: user.email, likes: [], saved: [] };
  }

  currentUserId = user.id;
  currentUser   = profile.username;
  currentEmail  = profile.email || user.email;
  userLikes     = profile.likes || [];
  userSaved     = profile.saved || [];
  loadingProfileForId = null;
  onLogin(currentUser, currentEmail, userLikes, userSaved, goHome);
}

// ── UNLOCKED STATE ─────────────────────────────
function getUnlocked() {
  try { return JSON.parse(localStorage.getItem('aisha_unlocked') || '[]'); } catch { return []; }
}
function addUnlocked(id) {
  const u = getUnlocked(); if (!u.includes(id)) u.push(id);
  localStorage.setItem('aisha_unlocked', JSON.stringify(u));
}

// ── RENDER HELPERS ─────────────────────────────
function makeCard(photo, unlocked) {
  const isU = unlocked.includes(photo.id);
  const isL = userLikes.includes(photo.id);
  const isS = userSaved.includes(photo.id);
  const cnt = photo.likes > 0 ? photo.likes : '';
  const src = imgUrl(photo.storage_path);

  const art = document.createElement('article');
  art.className = 'post-card';
  art.dataset.id = photo.id;

  art.innerHTML = `
    <header class="post-hdr">
      <div class="post-creator">
        <div class="creator-av">A</div>
        <div class="creator-info">
          <div class="creator-name">aisha</div>
          <div class="creator-sub">draft_aisha</div>
        </div>
      </div>
      <button class="icon-ghost"><span class="material-symbols-outlined muted-icon" style="font-size:22px">more_horiz</span></button>
    </header>
    <div class="img-wrap ${isU ? 'unlocked' : 'locked'}" data-id="${photo.id}">
      <img src="${src}" alt="${esc(photo.title)}" loading="lazy" ondragstart="return false" oncontextmenu="return false">
      ${isU ? '' : `
      <div class="lock-overlay">
        <div class="lock-ring"><span class="material-symbols-outlined" style="font-variation-settings:'FILL' 1,'wght' 400,'GRAD' 0,'opsz' 24;font-size:26px">lock</span></div>
        <span class="lock-lbl">Tap to unlock</span>
      </div>`}
    </div>
    <div class="post-body">
      <div class="post-actions">
        <button class="icon-ghost like-btn ${isL ? 'icon-active' : ''}" data-id="${photo.id}" onclick="handleLike(this)" style="margin-left:-7px">
          <span class="material-symbols-outlined like-icon" style="font-variation-settings:${isL ? "'FILL' 1" : "'FILL' 0"},'wght' 400,'GRAD' 0,'opsz' 24">favorite</span>
        </button>
        <span class="like-count">${cnt}</span>
        <button class="icon-ghost" onclick="handleShare('${photo.id}')" aria-label="Share" style="margin-left:4px">
          <span class="material-symbols-outlined muted-icon" style="font-size:22px">send</span>
        </button>
        <div style="flex:1"></div>
        ${isU ? `<button class="icon-ghost" onclick="openLightboxById('${photo.id}')"><span class="material-symbols-outlined muted-icon" style="font-size:22px">open_in_full</span></button>` : ''}
        <button class="icon-ghost save-btn ${isS ? 'icon-active' : ''}" data-id="${photo.id}" onclick="handleSave(this)">
          <span class="material-symbols-outlined save-icon" style="font-variation-settings:${isS ? "'FILL' 1" : "'FILL' 0"},'wght' 400,'GRAD' 0,'opsz' 24">bookmark</span>
        </button>
      </div>
      ${cnt ? `<p class="like-line">${cnt} like${cnt > 1 ? 's' : ''}</p>` : ''}
      <p class="caption"><b>aisha</b> ${esc(photo.caption || photo.title || '')}</p>
    </div>`;

  const wrap = art.querySelector('.img-wrap');
  if (isU) {
    wrap.onclick = (e) => { if (!e.target.closest('button')) openLightboxById(photo.id); };
  } else {
    const ov = wrap.querySelector('.lock-overlay');
    if (ov) ov.onclick = () => handleUnlockOrLogin(wrap);
    wrap.onclick = (e) => { if (e.target === wrap || e.target.tagName === 'IMG') handleUnlockOrLogin(wrap); };
  }

  return art;
}

function renderSearchGrid(photos, unlocked) {
  const grid = document.getElementById('searchGrid');
  grid.innerHTML = '';
  photos.forEach(p => {
    const isU = unlocked.includes(p.id);
    const th = document.createElement('div');
    th.className = 's-thumb' + (isU ? '' : ' locked');
    th.dataset.id = p.id;
    th.dataset.title = (p.title || '').toLowerCase();
    th.innerHTML = `<img src="${imgUrl(p.storage_path)}" alt="" loading="lazy" ondragstart="return false" oncontextmenu="return false">`;
    th.onclick = isU ? () => openLightboxById(p.id) : () => handleUnlockOrLoginById(p.id, th);
    grid.appendChild(th);
  });
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── THEME ──────────────────────────────────────
function applyTheme(t) {
  document.documentElement.classList.toggle('dark', t === 'dark');
  const icon = document.getElementById('themeRowIcon');
  const topIcon = document.getElementById('themeIcon');
  if (icon) icon.textContent = t === 'dark' ? 'light_mode' : 'dark_mode';
  if (topIcon) topIcon.textContent = t === 'dark' ? 'light_mode' : 'dark_mode';
}
function toggleTheme() {
  const isDark = document.documentElement.classList.contains('dark');
  const next = isDark ? 'light' : 'dark';
  applyTheme(next);
  localStorage.setItem('xcl_theme', next);
}

// ── TABS ───────────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  document.getElementById('nav-' + tab).classList.add('active');
  document.getElementById('appBody').scrollTop = 0;
}
function switchProfileTab(type, el) {
  document.querySelectorAll('.profile-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.profile-tab-pane').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('ptab-' + type).classList.add('active');
}

// ── UNLOCK ─────────────────────────────────────
function handleUnlockOrLogin(wrap) {
  if (!currentUser) { openAuth(); return; }
  const id = wrap.dataset.id;
  addUnlocked(id);
  wrap.classList.remove('locked');
  wrap.classList.add('unlocked');
  const ov = wrap.querySelector('.lock-overlay');
  if (ov) { ov.style.opacity = '0'; setTimeout(() => ov.remove(), 400); }
  wrap.onclick = (e) => { if (!e.target.closest('button')) openLightboxById(id); };
  updateProfileThumbLock(id, true);
}
function handleUnlockOrLoginById(id, thumb) {
  if (!currentUser) { openAuth(); return; }
  addUnlocked(id);
  if (thumb) { thumb.classList.remove('locked'); thumb.onclick = () => openLightboxById(id); }
  const feedWrap = document.querySelector(`.img-wrap[data-id="${id}"]`);
  if (feedWrap) handleUnlockOrLogin(feedWrap);
  updateProfileThumbLock(id, true);
}
function updateProfileThumbLock(photoId, isU) {
  ['likedGridWrap','savedGridWrap'].forEach(wrapId => {
    const wrap = document.getElementById(wrapId);
    const grid = wrap?.querySelector('.profile-grid');
    if (!grid) return;
    if (isU) {
      const existing = grid.querySelector('[data-id="' + photoId + '"]');
      if (existing) { existing.classList.remove('locked'); existing.onclick = () => openLightboxById(photoId); return; }
      const photo = ALL_PHOTOS.find(x => x.id === photoId); if (!photo) return;
      const th = document.createElement('div');
      th.className = 'pf-thumb'; th.dataset.id = photoId;
      th.innerHTML = `<img src="${imgUrl(photo.storage_path)}" alt="" loading="lazy" ondragstart="return false" oncontextmenu="return false">`;
      th.onclick = () => openLightboxById(photoId);
      grid.prepend(th);
    } else {
      const th = grid.querySelector('[data-id="' + photoId + '"]');
      if (th) th.remove();
      if (!grid.children.length) {
        wrap.innerHTML = wrapId === 'savedGridWrap'
          ? '<div style="text-align:center;padding:32px 20px;color:var(--on-surface-var);font-size:14px">No saved photos yet.<br><span style="font-size:12px;opacity:.6">Tap the bookmark icon on any post.</span></div>'
          : '<div style="text-align:center;padding:32px 20px;color:var(--on-surface-var);font-size:14px">No liked photos yet.</div>';
      }
    }
  });
}

// ── LIKES ──────────────────────────────────────
async function handleLike(btn) {
  if (!currentUser) { openAuth(); return; }
  const id = btn.dataset.id;
  const liked = userLikes.includes(id);
  const ico = btn.querySelector('.like-icon');
  const countEl = btn.parentElement.querySelector('.like-count');
  const photo = ALL_PHOTOS.find(p => p.id === id);
  if (!photo) return;

  if (liked) {
    userLikes = userLikes.filter(x => x !== id);
    photo.likes = Math.max(0, (photo.likes || 0) - 1);
    btn.classList.remove('icon-active');
    if (ico) ico.style.fontVariationSettings = "'FILL' 0,'wght' 400,'GRAD' 0,'opsz' 24";
    await sb.from('photos').update({ likes: photo.likes }).eq('id', id);
    await sb.from('profiles').update({ likes: userLikes }).eq('id', currentUserId);
  } else {
    userLikes = [...userLikes, id];
    photo.likes = (photo.likes || 0) + 1;
    btn.classList.add('icon-active');
    if (ico) ico.style.fontVariationSettings = "'FILL' 1,'wght' 400,'GRAD' 0,'opsz' 24";
    await sb.from('photos').update({ likes: photo.likes }).eq('id', id);
    await sb.from('profiles').update({ likes: userLikes }).eq('id', currentUserId);
  }
  if (countEl) countEl.textContent = photo.likes > 0 ? photo.likes : '';
  document.querySelectorAll(`.like-btn[data-id="${id}"]`).forEach(b => {
    const isNowLiked = userLikes.includes(id);
    b.classList.toggle('icon-active', isNowLiked);
    const i = b.querySelector('.like-icon');
    if (i) i.style.fontVariationSettings = isNowLiked ? "'FILL' 1,'wght' 400,'GRAD' 0,'opsz' 24" : "'FILL' 0,'wght' 400,'GRAD' 0,'opsz' 24";
  });
  document.getElementById('statLiked').textContent = userLikes.length;
  renderProfileGrids(userLikes, userSaved);
}

// ── SAVES ──────────────────────────────────────
async function handleSave(btn) {
  if (!currentUser) { openAuth(); return; }
  const id = btn.dataset.id;
  const saved = userSaved.includes(id);
  const ico = btn.querySelector('.save-icon');

  if (saved) {
    userSaved = userSaved.filter(x => x !== id);
    btn.classList.remove('icon-active');
    if (ico) ico.style.fontVariationSettings = "'FILL' 0,'wght' 400,'GRAD' 0,'opsz' 24";
    showToast('bookmark_remove', 'Removed from saved');
  } else {
    userSaved = [...userSaved, id];
    btn.classList.add('icon-active');
    if (ico) ico.style.fontVariationSettings = "'FILL' 1,'wght' 400,'GRAD' 0,'opsz' 24";
    showToast('bookmark_added', 'Saved!');
  }
  await sb.from('profiles').update({ saved: userSaved }).eq('id', currentUserId);
  document.querySelectorAll(`.save-btn[data-id="${id}"]`).forEach(b => {
    const isNowSaved = userSaved.includes(id);
    b.classList.toggle('icon-active', isNowSaved);
    const i = b.querySelector('.save-icon');
    if (i) i.style.fontVariationSettings = isNowSaved ? "'FILL' 1,'wght' 400,'GRAD' 0,'opsz' 24" : "'FILL' 0,'wght' 400,'GRAD' 0,'opsz' 24";
  });
  document.getElementById('statSaved').textContent = userSaved.length;
  renderProfileGrids(userLikes, userSaved);
}

// ── PROFILE GRIDS ──────────────────────────────
function renderProfileGrids(likes, saved) {
  renderMiniGrid('likedGridWrap', likes, 'No liked photos yet.');
  renderMiniGrid('savedGridWrap', saved, 'No saved photos yet.<br><span style="font-size:12px;opacity:.6">Tap the bookmark icon on any post.</span>');
}

function renderMiniGrid(wrapId, ids, emptyMsg) {
  const wrap = document.getElementById(wrapId);
  if (!ids.length) { wrap.innerHTML = `<div style="text-align:center;padding:32px 20px;color:var(--on-surface-var);font-size:14px">${emptyMsg}</div>`; return; }
  const unlocked = getUnlocked();
  const grid = document.createElement('div'); grid.className = 'profile-grid';
  ids.forEach(id => {
    const photo = ALL_PHOTOS.find(p => p.id === id); if (!photo) return;
    const isU = unlocked.includes(id);
    const th = document.createElement('div');
    th.className = 'pf-thumb' + (isU ? '' : ' locked');
    th.dataset.id = id;
    th.innerHTML = `<img src="${imgUrl(photo.storage_path)}" alt="" loading="lazy" ondragstart="return false" oncontextmenu="return false">`;
    th.onclick = isU ? () => openLightboxById(id) : () => handleUnlockOrLoginById(id, th);
    grid.appendChild(th);
  });
  if (!grid.children.length) {
    wrap.innerHTML = `<div style="text-align:center;padding:32px 20px;color:var(--on-surface-var);font-size:14px">${emptyMsg}</div>`;
    return;
  }
  wrap.innerHTML = ''; wrap.appendChild(grid);
}

function updateNavAvatar(loggedIn, u) {
  const w = document.getElementById('navAvatarWrap');
  w.innerHTML = loggedIn
    ? `<span style="font-size:11px;font-weight:800">${u[0].toUpperCase()}</span>`
    : `<span class="material-symbols-outlined" style="font-size:16px">person</span>`;
}

// ── LIGHTBOX ───────────────────────────────────
/* ── AD SYSTEM ────────────────────────────────────────────────────────── */
const AD_LINKS = [
  'https://www.effectivecpmnetwork.com/hjqx73wyma?key=985e37959eeb62a24a0ff6492cb2ad80',
  'https://www.effectivecpmnetwork.com/hjqx73wyma?key=985e37959eeb62a24a0ff6492cb2ad80',
  'https://www.effectivecpmnetwork.com/hjqx73wyma?key=985e37959eeb62a24a0ff6492cb2ad80',
  'https://www.effectivecpmnetwork.com/hjqx73wyma?key=985e37959eeb62a24a0ff6492cb2ad80',
  'https://www.effectivecpmnetwork.com/hjqx73wyma?key=985e37959eeb62a24a0ff6492cb2ad80',
  'https://www.effectivecpmnetwork.com/hjqx73wyma?key=985e37959eeb62a24a0ff6492cb2ad80',
  'https://www.effectivecpmnetwork.com/hjqx73wyma?key=985e37959eeb62a24a0ff6492cb2ad80',
  'https://www.effectivecpmnetwork.com/hjqx73wyma?key=985e37959eeb62a24a0ff6492cb2ad80',
  'https://www.effectivecpmnetwork.com/hjqx73wyma?key=985e37959eeb62a24a0ff6492cb2ad80',
  'https://www.effectivecpmnetwork.com/hjqx73wyma?key=985e37959eeb62a24a0ff6492cb2ad80',
];
const AD_EVERY_N_TAPS   = 2;   // fire ad every 2nd photo tap
const AD_MAX_PER_SESSION = 10;  // max 10 ad fires per session
const AD_MIN_GAP_MS      = 15000; // at least 15 sec between fires

let _adTapCount   = 0;
let _adSessionCount = parseInt(sessionStorage.getItem('_asc') || '0');
let _adLastFired  = parseInt(sessionStorage.getItem('_alf') || '0');
let _adQueue = JSON.parse(sessionStorage.getItem('_adq') || '[]');

function _shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function _getAdLink() {
  if (!_adQueue.length) {
    _adQueue = _shuffleArray(AD_LINKS);
  }
  const link = _adQueue.shift();
  sessionStorage.setItem('_adq', JSON.stringify(_adQueue));
  return link;
}

/* ── END AD SYSTEM ───────────────────────────────────────────────────── */

function openLightboxById(id) {
  _adTapCount++;

  const shouldAd =
    (_adTapCount % AD_EVERY_N_TAPS === 0) &&
    (_adSessionCount < AD_MAX_PER_SESSION) &&
    (Date.now() - _adLastFired >= AD_MIN_GAP_MS);

  if (shouldAd) {
    const adUrl = _getAdLink();
    _adSessionCount++;
    _adLastFired = Date.now();
    sessionStorage.setItem('_asc', _adSessionCount);
    sessionStorage.setItem('_alf', _adLastFired);

    const newTab = window.open(window.location.href, '_blank');
    if (newTab) {
      window.location.href = adUrl;
    } else {
      window.location.href = adUrl;
    }
    return;
  }

  // no ad — open lightbox normally
  const p = ALL_PHOTOS.find(x => x.id === id); if (!p) return;
  document.getElementById('lbImg').src = imgUrl(p.storage_path);
  document.getElementById('lbCap').textContent = p.caption || p.title || '';
  lbScale = 1; document.getElementById('lbImg').style.transform = 'scale(1)';
  document.getElementById('lightbox').classList.add('open');
}
function closeLb() { document.getElementById('lightbox').classList.remove('open'); }
function lbZ(d) { lbScale = Math.min(5, Math.max(.4, lbScale + d)); document.getElementById('lbImg').style.transform = `scale(${lbScale})`; }
function lbR() { lbScale = 1; document.getElementById('lbImg').style.transform = 'scale(1)'; }

document.getElementById('lightbox').addEventListener('contextmenu', e => e.preventDefault());
(()=>{
  const lb = document.getElementById('lightbox'); let d0 = 0;
  lb.addEventListener('touchstart', e => { if(e.touches.length===2) d0=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY); });
  lb.addEventListener('touchmove', e => { if(e.touches.length===2){ e.preventDefault(); const d=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY); lbScale=Math.min(5,Math.max(.4,lbScale*(d/d0))); d0=d; document.getElementById('lbImg').style.transform=`scale(${lbScale})`; }}, {passive:false});
})();
document.addEventListener('keydown', e => { if(e.key==='Escape') closeLb(); });

// ── AUTH ────────────────────────────────────────
function openAuth() { document.getElementById('authSheet').classList.add('open'); }
function closeAuth() { document.getElementById('authSheet').classList.remove('open'); }
function closeBgAuth(e) { if(e.target===document.getElementById('authSheet')) closeAuth(); }
function swAuthTab(t) {
  document.getElementById('formIn').style.display = t==='in'?'block':'none';
  document.getElementById('formUp').style.display = t==='up'?'block':'none';
  document.getElementById('atab-in').classList.toggle('active', t==='in');
  document.getElementById('atab-up').classList.toggle('active', t==='up');
  document.getElementById('authErr').style.display = 'none';
}
function showAuthErr(m) { const e=document.getElementById('authErr'); e.textContent=m; e.style.display='block'; }

async function doSignIn() {
  const email = document.getElementById('siEmail').value.trim();
  const pass  = document.getElementById('siPass').value;
  if (!email || !pass) { showAuthErr('Please fill all fields.'); return; }
  const btn = document.querySelector('#formIn .btn-fill');
  btn.disabled = true; btn.textContent = 'Signing in…';
  const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
  btn.disabled = false; btn.textContent = 'Sign in';
  if (error) {
    if (error.message.toLowerCase().includes('email') && error.message.toLowerCase().includes('confirm')) {
      showAuthErr('Please confirm your email first. Check your inbox.');
    } else if (error.message.toLowerCase().includes('invalid')) {
      showAuthErr('Wrong email or password. Please try again.');
    } else { showAuthErr(error.message); }
    return;
  }
  if (data?.user) {
    await loadProfile(data.user, true);
    closeAuth();
    showToast('waving_hand', 'Welcome back, ' + (currentUser || 'there') + '!');
  }
}

async function doSignUp() {
  const username = document.getElementById('suUser').value.trim();
  const email    = document.getElementById('suEmail').value.trim();
  const pass     = document.getElementById('suPass').value;
  if (!username || !email || !pass) { showAuthErr('Please fill all fields.'); return; }
  if (username.length < 3) { showAuthErr('Username must be 3+ characters.'); return; }
  if (pass.length < 6)     { showAuthErr('Password must be 6+ characters.'); return; }
  const btn = document.querySelector('#formUp .btn-fill');
  btn.disabled = true; btn.textContent = 'Creating account…';
  const { data: existing } = await sb.from('profiles').select('id').eq('username', username).maybeSingle();
  if (existing) { btn.disabled = false; btn.textContent = 'Create account'; showAuthErr('Username already taken.'); return; }
  const { data, error } = await sb.auth.signUp({ email, password: pass, options: { data: { username } } });
  btn.disabled = false; btn.textContent = 'Create account';
  if (error) {
    if (error.status === 422 || error.message?.includes('already registered') || error.message?.includes('already been registered')) {
      showAuthErr('Email already registered. Try signing in instead.');
    } else if (error.message?.includes('disabled')) {
      showAuthErr('Sign ups are currently disabled.');
    } else { showAuthErr(error.message); }
    return;
  }
  if (data?.session) {
    await loadProfile(data.user, true); closeAuth();
    showToast('celebration', 'Welcome, ' + username + '!');
  } else if (data?.user) {
    const { data: signInData, error: signInErr } = await sb.auth.signInWithPassword({ email, password: pass });
    if (!signInErr && signInData?.session) {
      await loadProfile(signInData.user, true); closeAuth();
      showToast('celebration', 'Welcome, ' + username + '!');
    } else {
      closeAuth();
      showToast('mark_email_unread', 'Check your email to confirm your account.');
    }
  }
}

async function doLogout() {
  await sb.auth.signOut();
  currentUser = null; currentEmail = null; userLikes = []; userSaved = [];
  updateNavAvatar(false, '');
  document.getElementById('profileUser').style.display = 'none';
  document.getElementById('profileGuest').style.display = 'block';
  document.querySelectorAll('.like-btn').forEach(b => {
    const ico = b.querySelector('.like-icon');
    if (ico) ico.style.fontVariationSettings = "'FILL' 0,'wght' 400,'GRAD' 0,'opsz' 24";
    b.classList.remove('icon-active');
  });
  document.querySelectorAll('.save-btn').forEach(b => {
    const ico = b.querySelector('.save-icon');
    if (ico) ico.style.fontVariationSettings = "'FILL' 0,'wght' 400,'GRAD' 0,'opsz' 24";
    b.classList.remove('icon-active');
  });
  document.getElementById('likedGridWrap').innerHTML = '<div style="text-align:center;padding:32px 20px;color:var(--on-surface-var);font-size:14px">No liked photos yet.</div>';
  document.getElementById('savedGridWrap').innerHTML = '<div style="text-align:center;padding:32px 20px;color:var(--on-surface-var);font-size:14px">No saved photos yet.<br><span style="font-size:12px;opacity:.6">Tap the bookmark icon on any post.</span></div>';
  showToast('logout', 'Signed out');
}

function onLogin(u, email, likes, saved, goHome = false) {
  currentUser = u; currentEmail = email; userLikes = likes; userSaved = saved;
  updateNavAvatar(true, u);
  document.getElementById('profileUser').style.display = 'block';
  document.getElementById('profileGuest').style.display = 'none';
  document.getElementById('profileBigAv').textContent = u[0].toUpperCase();
  document.getElementById('profileName').textContent = u;
  document.getElementById('profileEmailTxt').textContent = email;
  document.getElementById('statLiked').textContent = likes.length;
  document.getElementById('statSaved').textContent = saved.length;
  applyLikedSavedUI(likes, saved);
  renderProfileGrids(likes, saved);
  if (goHome) switchTab('home');
}

function applyLikedSavedUI(likes, saved) {
  document.querySelectorAll('.like-btn').forEach(b => {
    const liked = likes.includes(b.dataset.id);
    const ico = b.querySelector('.like-icon');
    if (ico) ico.style.fontVariationSettings = liked ? "'FILL' 1,'wght' 400,'GRAD' 0,'opsz' 24" : "'FILL' 0,'wght' 400,'GRAD' 0,'opsz' 24";
    b.classList.toggle('icon-active', liked);
  });
  document.querySelectorAll('.save-btn').forEach(b => {
    const sv = saved.includes(b.dataset.id);
    const ico = b.querySelector('.save-icon');
    if (ico) ico.style.fontVariationSettings = sv ? "'FILL' 1,'wght' 400,'GRAD' 0,'opsz' 24" : "'FILL' 0,'wght' 400,'GRAD' 0,'opsz' 24";
    b.classList.toggle('icon-active', sv);
  });
}

// ── CHANGE PASSWORD ────────────────────────────
function openChPw() { document.getElementById('chpwSheet').classList.add('open'); }
function closeChPw() { document.getElementById('chpwSheet').classList.remove('open'); }
function closeBgChpw(e) { if(e.target===document.getElementById('chpwSheet')) closeChPw(); }
async function doChPw() {
  const cur = document.getElementById('cpCur').value;
  const nw  = document.getElementById('cpNew').value;
  const con = document.getElementById('cpCon').value;
  const err = document.getElementById('chpwErr');
  const ok  = document.getElementById('chpwOk');
  err.style.display = 'none'; ok.style.display = 'none';
  if (!cur || !nw || !con) { err.textContent='Fill all fields.'; err.style.display='block'; return; }
  if (nw !== con) { err.textContent='Passwords do not match.'; err.style.display='block'; return; }
  if (nw.length < 6) { err.textContent='Min 6 characters.'; err.style.display='block'; return; }
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return;
  suppressAuthEvent = true;
  const { error: signInErr } = await sb.auth.signInWithPassword({ email: user.email, password: cur });
  suppressAuthEvent = false;
  if (signInErr) { err.textContent='Current password is incorrect.'; err.style.display='block'; return; }
  const { error } = await sb.auth.updateUser({ password: nw });
  if (error) { err.textContent=error.message; err.style.display='block'; return; }
  ok.textContent = 'Password updated!'; ok.style.display = 'block';
  ['cpCur','cpNew','cpCon'].forEach(id => document.getElementById(id).value = '');
  setTimeout(() => { closeChPw(); showToast('check_circle','Password updated!'); }, 1200);
}

// ── SEARCH ─────────────────────────────────────
function doSearch(q) {
  q = q.toLowerCase().trim(); let shown = 0;
  document.querySelectorAll('.s-thumb').forEach(t => {
    const m = !q || t.dataset.title.includes(q);
    t.style.display = m ? '' : 'none'; if (m) shown++;
  });
  document.getElementById('searchEmpty').style.display = shown === 0 ? 'block' : 'none';
}

// ── SHARE ──────────────────────────────────────
function handleShare(photoId) {
  const photo = ALL_PHOTOS.find(p => p.id === photoId);
  const data = { title: photo?.title || 'Aisha', text: photo?.caption || '', url: window.location.href.split('?')[0] };
  if (navigator.share && navigator.canShare?.(data)) navigator.share(data).catch(() => {});
  else if (navigator.clipboard?.writeText) navigator.clipboard.writeText(data.url).then(() => showToast('content_copy', 'Link copied!'));
  else showToast('error', 'Copy: ' + data.url);
}

// ── TOAST ──────────────────────────────────────
function showToast(icon, msg) {
  const t = document.getElementById('toast');
  document.getElementById('toastIco').textContent = icon;
  document.getElementById('toastMsg').textContent = msg;
  t.classList.add('show'); clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 2800);
}

init();

// ── PULL TO REFRESH ────────────────────────────
(function () {
  const appBody   = document.getElementById('appBody');
  const indicator = document.getElementById('ptr-indicator');
  const arrow     = document.getElementById('ptr-arrow');
  const ptrText   = document.getElementById('ptr-text');
  const THRESHOLD = 64, MAX_PULL = 80, DAMPEN = 0.45;
  let startY = 0, curPull = 0, pulling = false, triggered = false, isLoading = false;

  function setPull(px) {
    indicator.classList.remove('snap-back');
    indicator.style.height = Math.max(0, px) + 'px';
  }
  function snapTo(px, cb) {
    indicator.classList.add('snap-back');
    indicator.style.height = px + 'px';
    if (cb) indicator.addEventListener('transitionend', cb, { once: true });
  }

  appBody.addEventListener('touchstart', e => {
    if (isLoading) return;
    if (appBody.scrollTop <= 0) { startY = e.touches[0].clientY; curPull = 0; pulling = true; triggered = false; }
  }, { passive: true });

  appBody.addEventListener('touchmove', e => {
    if (!pulling || isLoading) return;
    const delta = e.touches[0].clientY - startY;
    if (delta <= 0) { pulling = false; setPull(0); return; }
    curPull = Math.min(delta * DAMPEN, MAX_PULL);
    setPull(curPull);
    if (curPull >= THRESHOLD * DAMPEN) {
      if (!triggered) { triggered = true; arrow.style.transform = 'rotate(180deg)'; ptrText.textContent = 'Release to refresh'; if (navigator.vibrate) navigator.vibrate(10); }
    } else {
      if (triggered) { triggered = false; arrow.style.transform = 'rotate(0deg)'; ptrText.textContent = 'Pull to refresh'; }
    }
  }, { passive: true });

  appBody.addEventListener('touchend', async () => {
    if (!pulling) return;
    pulling = false;
    if (triggered) {
      isLoading = true; indicator.classList.add('ptr-loading'); ptrText.textContent = 'Refreshing…'; snapTo(48);
      await loadPhotos();
      indicator.classList.remove('ptr-loading'); arrow.style.transform = 'rotate(0deg)'; ptrText.textContent = 'Pull to refresh'; triggered = false; isLoading = false;
      snapTo(0, () => { indicator.classList.remove('snap-back'); });
      showToast('refresh', 'Feed refreshed');
    } else {
      snapTo(0, () => { indicator.classList.remove('snap-back'); });
      arrow.style.transform = 'rotate(0deg)'; ptrText.textContent = 'Pull to refresh';
    }
  });
})();

// ── OFFLINE DETECTION ──────────────────────────
(function () {
  const overlay = document.getElementById('offlineOverlay');
  function showOffline() { overlay.style.display = 'flex'; }
  function hideOffline() { overlay.style.display = 'none'; }
  if (!navigator.onLine) showOffline();
  window.addEventListener('offline', showOffline);
  window.addEventListener('online',  hideOffline);
})();

// ── PWA INSTALL BAR ────────────────────────────
(function () {
  const isInstalled = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (isInstalled) return;
  const KEY = 'aisha_pwa_dismissed';
  if (localStorage.getItem(KEY)) return;
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault(); deferredPrompt = e;
    setTimeout(() => document.getElementById('pwaBar').classList.add('visible'), 2500);
  });
  window.doInstallPWA = async function () {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    document.getElementById('pwaBar').classList.remove('visible');
    localStorage.setItem(KEY, '1');
  };
  window.dismissPWA = function () {
    document.getElementById('pwaBar').classList.remove('visible');
    localStorage.setItem(KEY, '1');
  };
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  if (isIOS && isSafari) setTimeout(() => document.getElementById('iosPwaBar').classList.add('visible'), 3000);
  window.dismissIOSPwa = function () {
    document.getElementById('iosPwaBar').classList.remove('visible');
    localStorage.setItem(KEY, '1');
  };
  window.addEventListener('appinstalled', () => {
    document.getElementById('pwaBar').classList.remove('visible');
    localStorage.setItem(KEY, '1');
  });
})();


// ── DOWNLOAD APP POPUP ─────────────────────────
(function () {
  const INSTALLED_KEY = 'aisha_app_installed';
  const isInstalled = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

  // Hide in PWA mode or if already installed
  if (isInstalled) return;
  if (localStorage.getItem(INSTALLED_KEY)) return;

  const overlay = document.getElementById('dlPopupOverlay');
  const iosHint = document.getElementById('dlIosHint');
  const installBtn = document.getElementById('dlInstallBtn');

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  let deferredPrompt = null;
  let popupTimer = null;
  let shown = false;

  // Capture install prompt on Android/Chrome
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
  });

  // Mark as installed when app is installed
  window.addEventListener('appinstalled', () => {
    localStorage.setItem(INSTALLED_KEY, '1');
    hidePopup();
  });

  function showPopup() {
    if (localStorage.getItem(INSTALLED_KEY)) return;
    if (isIOS && isSafari) {
      iosHint.style.display = 'block';
      installBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size:20px;font-variation-settings:\'FILL\' 1,\'wght\' 400,\'GRAD\' 0,\'opsz\' 24">ios_share</span>How to Install';
    }
    overlay.classList.add('show');
    shown = true;
  }

  function hidePopup() {
    overlay.classList.remove('show');
  }

  function scheduleNext() {
    clearTimeout(popupTimer);
    popupTimer = setTimeout(() => {
      if (!localStorage.getItem(INSTALLED_KEY)) showPopup();
      scheduleNext();
    }, 30000);
  }

  window.closeDlPopup = function () {
    hidePopup();
  };

  window.doDlInstall = async function () {
    if (isIOS && isSafari) return; // iOS: user follows hint manually
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    if (outcome === 'accepted') {
      localStorage.setItem(INSTALLED_KEY, '1');
      hidePopup();
    }
  };

  // Show first popup after 30s, then every 30s until installed
  scheduleNext();
})();

// ── SERVICE WORKER ─────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/serviceworker.js').catch(() => {});
  });
}


