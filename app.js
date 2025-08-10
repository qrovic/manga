(function(){
  const appEl = document.getElementById('app');
  const searchForm = document.getElementById('search-form');
  const searchInput = document.getElementById('search-input');
  const genreSelect = document.getElementById('genre-select');

  const API_BASE = 'https://gomanga-api.vercel.app';
  // Always call the API directly (no PHP proxy; suitable for GitHub Pages)
  const viaProxy = (url) => url;

  // Ensure sticky toolbars sit below the header height
  function updateHeaderOffset(){
    const header = document.querySelector('.site-header');
    if (!header) return;
    const headerHeight = Math.ceil(header.getBoundingClientRect().height);
    const offsetPx = Math.max(0, headerHeight + 8); // small spacing
    document.documentElement.style.setProperty('--header-offset', offsetPx + 'px');
  }

  function buildCorsFallbackUrls(url){
    // Try direct first, then a couple of public CORS proxies as a last resort
    // Note: Public proxies can be unreliable; this is only to make Pages work without server code
    return [
      url,
      `https://cors.isomorphic-git.org/${url}`,
      `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    ];
  }

  async function fetchWithTimeout(resource, options={}){
    const { timeoutMs = 12000, ...rest } = options;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(resource, { ...rest, signal: controller.signal, mode: 'cors', credentials: 'omit', cache: 'default', headers: { Accept: 'application/json', ...(rest.headers||{}) } });
    } finally {
      clearTimeout(id);
    }
  }

  const state = {
    genres: [],
    cache: new Map(), // url -> data
  };

  // LocalStorage helpers for progress and bookmarks
  const STORAGE_KEYS = {
    progress: 'gomanga.progress', // { [mangaId]: { chapterId, title, cover, time } }
    bookmarks: 'gomanga.bookmarks', // { [mangaId]: { chapterId, title, cover, time } }
  };

  function loadStorageMap(key){
    try { return JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch { return {}; }
  }
  function saveStorageMap(key, obj){
    try { localStorage.setItem(key, JSON.stringify(obj || {})); } catch {}
  }
  function getProgress(mangaId){
    const map = loadStorageMap(STORAGE_KEYS.progress);
    return map?.[mangaId] || null;
  }
  function setProgress(mangaId, chapterId, title, cover){
    const map = loadStorageMap(STORAGE_KEYS.progress);
    map[mangaId] = { chapterId: String(chapterId), title: title || '', cover: cover || '', time: Date.now() };
    saveStorageMap(STORAGE_KEYS.progress, map);
  }
  function isBookmarked(mangaId){
    const map = loadStorageMap(STORAGE_KEYS.bookmarks);
    return Boolean(map?.[mangaId]);
  }
  function getBookmark(mangaId){
    const map = loadStorageMap(STORAGE_KEYS.bookmarks);
    return map?.[mangaId] || null;
  }
  function setBookmark(mangaId, chapterId, title, cover){
    const map = loadStorageMap(STORAGE_KEYS.bookmarks);
    const normalizedChapterId = (chapterId === undefined || chapterId === null) ? '' : String(chapterId);
    map[mangaId] = { chapterId: normalizedChapterId, title: title || '', cover: cover || '', time: Date.now() };
    saveStorageMap(STORAGE_KEYS.bookmarks, map);
  }
  function removeBookmark(mangaId){
    const map = loadStorageMap(STORAGE_KEYS.bookmarks);
    delete map[mangaId];
    saveStorageMap(STORAGE_KEYS.bookmarks, map);
  }

  function slugifyGenre(name){
    return name.trim().toLowerCase()
      .replace(/&/g, 'and')
      .replace(/\s+\/\s+/g, '-')
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9\-]/g, '');
  }

  async function fetchJSON(url){
    const key = `json:${url}`;
    if (state.cache.has(key)) return state.cache.get(key);
    const candidates = buildCorsFallbackUrls(viaProxy(url));
    let lastError = null;
    for (const attemptUrl of candidates){
      try {
        const res = await fetchWithTimeout(attemptUrl, { timeoutMs: 15000 });
        if (!res.ok) { lastError = new Error(`HTTP ${res.status}`); continue; }
        // Try to parse JSON; if content-type is wrong, still attempt JSON, fallback to text->JSON
        try {
          const data = await res.json();
          state.cache.set(key, data);
          return data;
        } catch (parseErr) {
          const text = await res.text();
          try {
            const data = JSON.parse(text);
            state.cache.set(key, data);
            return data;
          } catch {
            lastError = new Error('Invalid JSON from API');
            continue;
          }
        }
      } catch (err) {
        lastError = err;
        continue;
      }
    }
    console.error('fetchJSON error', url, lastError);
    throw lastError || new Error('Request failed');
  }

  function setLoading(message='Loading...'){
    appEl.innerHTML = `<div class="loading"><div class="spinner"></div><div>${escapeHtml(message)}</div></div>`;
  }
  function setError(e){
    appEl.innerHTML = `<div class="error">${e?.message || 'Something went wrong'}<br/><small>Try again.</small></div>`;
  }

  function gridCard(item){
    const img = item.imgUrl || item.image || item.imageUrl || '';
    const desc = item.description || '';
    const latest = item.latestChapter || (item.latestChapters && item.latestChapters[0]?.name) || '';
    return `
      <a class="card" href="#/manga/${encodeURIComponent(item.id)}" title="${escapeHtml(item.title)}">
        <img loading="lazy" src="${img}" alt="${escapeHtml(item.title)}"/>
        <div class="content">
          <div class="title">${escapeHtml(item.title)}</div>
          ${latest ? `<div class="meta">${escapeHtml(latest)}</div>` : ''}
          ${desc ? `<div class="desc">${escapeHtml(desc)}</div>` : ''}
        </div>
      </a>
    `;
  }

  function escapeHtml(s){
    return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
  }

  async function ensureGenres(){
    if (state.genres.length) return;
    try {
      const data = await fetchJSON(`${API_BASE}/api/genre`);
      state.genres = data.genre || [];
      // populate select
      const opts = ['<option value="">Genres</option>'].concat(state.genres.map(g => {
        const slug = slugifyGenre(g);
        return `<option value="${slug}">${escapeHtml(g)}</option>`;
      }));
      genreSelect.innerHTML = opts.join('');
      // Header height may change when select is populated
      updateHeaderOffset();
    } catch (e) {
      console.warn('Failed to load genres', e);
    }
  }

  async function renderHome(page=1){
    setLoading('Loading latest...');
    ensureGenres();
    try {
      const data = await fetchJSON(`${API_BASE}/api/manga-list/${page}`);
      const grid = (data.data || []).map(gridCard).join('');
      const totalPages = data.pagination?.[4] || 1;
      appEl.innerHTML = `
        <div class="toolbar">
          <div class="section-title">Latest Manga</div>
          <div class="pager">
            <button ${page<=1?'disabled':''} onclick="location.hash='#/latest/${page-1}'">Prev</button>
            <span class="page">Page ${page} / ${totalPages}</span>
            <button ${page>=totalPages?'disabled':''} onclick="location.hash='#/latest/${page+1}'">Next</button>
          </div>
        </div>
        <div class="grid">${grid}</div>
      `;
    } catch (e) { setError(e); }
  }

  async function renderSearch(q){
    setLoading('Searching...');
    ensureGenres();
    try {
      const data = await fetchJSON(`${API_BASE}/api/search/${encodeURIComponent(q)}`);
      const results = (data.manga || []).map(gridCard).join('');
      appEl.innerHTML = `
        <div class="toolbar">
          <div class="section-title">Search: ${escapeHtml(q)}</div>
          <button class="button" onclick="history.back()">Back</button>
        </div>
        <div class="grid">${results || '<div class="loading">No results</div>'}</div>
      `;
    } catch (e) { setError(e); }
  }

  async function renderGenre(slug, page=1){
    setLoading('Loading genre...');
    ensureGenres();
    try {
      const data = await fetchJSON(`${API_BASE}/api/genre/${encodeURIComponent(slug)}/${page}`);
      const items = (data.manga || []).map(gridCard).join('');
      const totalPages = data.pagination?.[4] || 1;
      appEl.innerHTML = `
        <div class="toolbar">
          <div class="section-title">Genre: ${escapeHtml(slug)}</div>
          <div class="pager">
            <button ${page<=1?'disabled':''} onclick="location.hash='#/genre/${encodeURIComponent(slug)}/${page-1}'">Prev</button>
            <span class="page">Page ${page} / ${totalPages}</span>
            <button ${page>=totalPages?'disabled':''} onclick="location.hash='#/genre/${encodeURIComponent(slug)}/${page+1}'">Next</button>
          </div>
        </div>
        <div class="grid">${items}</div>
      `;
    } catch (e) { setError(e); }
  }

  async function renderBookmarks(){
    setLoading('Loading bookmarks...');
    ensureGenres();
    try {
      const bookmarksMap = loadStorageMap(STORAGE_KEYS.bookmarks);
      const entries = Object.entries(bookmarksMap);
      const cards = entries.map(([mangaId, meta]) => {
        const progress = getProgress(mangaId);
        const desc = progress?.chapterId ? `Continue Ch ${progress.chapterId}` : 'Bookmarked';
        const item = { id: mangaId, title: meta.title || mangaId, imageUrl: meta.cover || '', description: desc };
        return gridCard(item);
      }).join('');
      appEl.innerHTML = `
        <div class="toolbar">
          <div class="section-title">Bookmarks</div>
          <a class="button" href="#/">Home</a>
        </div>
        <div class="grid">${cards || '<div class="loading">No bookmarks</div>'}</div>
      `;
    } catch (e) { setError(e); }
  }

  async function renderManga(id){
    setLoading('Loading manga...');
    ensureGenres();
    try {
      const decodedId = decodeURIComponent(id || '');
      const data = await fetchJSON(`${API_BASE}/api/manga/${decodedId}`);
      const progress = getProgress(decodedId);
      const bookmarked = isBookmarked(decodedId);
      const chips = (data.genres||[]).map(g => `<span class="chip">${escapeHtml(g)}</span>`).join('');
      const chapters = (data.chapters||[]).map(ch => {
        const chId = ch.chapterId;
        return `<a class="chapter-link" href="#/read/${encodeURIComponent(id)}/${encodeURIComponent(chId)}">Ch ${escapeHtml(chId)}</a>`;
      }).join('');
      appEl.innerHTML = `
        <div class="toolbar">
          <button class="button" onclick="history.back()">Back</button>
          <a class="button" href="#/">Home</a>
          <button id="bookmark-toggle" class="button ${bookmarked ? 'primary' : ''}">${bookmarked ? 'Bookmarked' : 'Bookmark'}</button>
           ${progress ? `<a class="button primary" href="#/read/${encodeURIComponent(decodedId)}/${encodeURIComponent(progress.chapterId)}">Continue Ch ${escapeHtml(progress.chapterId)}</a>` : ''}
        </div>
        <div class="detail">
          <img class="cover" src="${data.imageUrl || ''}" alt="${escapeHtml(data.title)}"/>
          <div class="info">
            <div class="section-title">${escapeHtml(data.title)}</div>
            <div class="meta">By ${escapeHtml(data.author || 'Unknown')} • ${escapeHtml(data.status || '')}</div>
            <div class="meta">Updated: ${escapeHtml(data.lastUpdated || '')} • Views: ${escapeHtml(data.views || '')}</div>
             ${progress ? `<div class="meta">Last read: Chapter ${escapeHtml(progress.chapterId)}</div>` : ''}
            <div class="chips">${chips}</div>
            <div class="section-title" style="margin-top:10px;">Chapters</div>
            <div class="chapters">${chapters}</div>
          </div>
        </div>
      `;

      // Wire bookmark toggle on manga detail
      const btn = document.getElementById('bookmark-toggle');
      if (btn) {
        btn.addEventListener('click', () => {
          if (isBookmarked(decodedId)) {
            removeBookmark(decodedId);
            btn.classList.remove('primary');
            btn.textContent = 'Bookmark';
          } else {
            setBookmark(decodedId, '', data.title, data.imageUrl);
            btn.classList.add('primary');
            btn.textContent = 'Bookmarked';
          }
        });
      }
    } catch (e) { setError(e); }
  }

  async function renderReader(id, chapter){
    setLoading('Loading chapter...');
    try {
      const decodedId = decodeURIComponent(id || '');
      const decodedChapter = decodeURIComponent(chapter || '');
      const [imgs, detail] = await Promise.all([
        fetchJSON(`${API_BASE}/api/manga/${decodedId}/${decodedChapter}`),
        fetchJSON(`${API_BASE}/api/manga/${decodedId}`)
      ]);

      const imageUrls = imgs.imageUrls || [];

      // compute prev/next
      const chs = (detail.chapters||[]);
      const idx = chs.findIndex(c => String(c.chapterId) === String(chapter));
      const prev = idx >= 0 && idx < chs.length - 1 ? chs[idx+1].chapterId : null; // likely sorted latest-first
      const next = idx > 0 ? chs[idx-1].chapterId : null;

      // Save reading progress automatically
      setProgress(decodedId, decodedChapter, detail.title, detail.imageUrl);

      appEl.innerHTML = `
        <div class="reader">
          <div class="reader-toolbar">
            <a class="button" href="#/manga/${encodeURIComponent(decodedId)}">Chapters</a>
            <button class="button" onclick="history.back()">Back</button>
            <div style="flex:1"></div>
            <button class="button" ${prev ? '' : 'disabled'} onclick="location.hash='#/read/${encodeURIComponent(id)}/${encodeURIComponent(prev)}'">Prev</button>
            <div class="page">Ch ${escapeHtml(decodedChapter)}</div>
            <button class="button" ${next ? '' : 'disabled'} onclick="location.hash='#/read/${encodeURIComponent(id)}/${encodeURIComponent(next)}'">Next</button>
          </div>
          <div id="reader-images" class="reader-images"></div>
          <div id="reader-sentinel" class="reader-sentinel" aria-hidden="true"></div>
        </div>
      `;

      // Smooth scroll top on chapter load
      window.scrollTo({ top: 0, behavior: 'smooth' });

      // Incremental image appending: load first, then progressively append more as you scroll
      setupIncrementalReaderImages(imageUrls);

    } catch (e) { setError(e); }
  }

  function activateLazyImages(){
    const imgs = document.querySelectorAll('.reader img[data-src]');
    if (!imgs.length) return;
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries, obs) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const img = entry.target;
            img.src = img.getAttribute('data-src');
            img.removeAttribute('data-src');
            obs.unobserve(img);
          }
        });
      }, { root: null, rootMargin: '200px 0px', threshold: 0.01 });
      imgs.forEach(img => io.observe(img));
    } else {
      imgs.forEach(img => {
        img.src = img.getAttribute('data-src');
        img.removeAttribute('data-src');
      });
    }
  }

  function setupIncrementalReaderImages(imageUrls){
    const container = document.getElementById('reader-images');
    const sentinel = document.getElementById('reader-sentinel');
    if (!container) return;

    let currentIndex = 0;
    const isMobile = window.matchMedia('(max-width: 640px)').matches;
    const batchSize = isMobile ? 2 : 4;

    function appendNextBatch(){
      if (currentIndex >= imageUrls.length) return;
      const end = Math.min(currentIndex + batchSize, imageUrls.length);
      for (let i = currentIndex; i < end; i++){
        const img = document.createElement('img');
        img.setAttribute('loading', 'lazy');
        img.setAttribute('decoding', 'async');
        img.setAttribute('data-src', imageUrls[i]);
        img.setAttribute('alt', 'page');
        container.appendChild(img);
      }
      currentIndex = end;
      // Kick lazy loader for any newly added images
      activateLazyImages();
    }

    appendNextBatch();

    if ('IntersectionObserver' in window && sentinel){
      const io = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            appendNextBatch();
            if (currentIndex >= imageUrls.length) io.disconnect();
          }
        });
      }, { root: null, rootMargin: '300px 0px', threshold: 0 });
      io.observe(sentinel);
    } else {
      // Fallback: on scroll near bottom, append more
      const onScroll = () => {
        const nearBottom = window.innerHeight + window.scrollY >= document.body.offsetHeight - 600;
        if (nearBottom) appendNextBatch();
        if (currentIndex >= imageUrls.length) window.removeEventListener('scroll', onScroll);
      };
      window.addEventListener('scroll', onScroll, { passive: true });
    }
  }

  // Router
  function parseHash(){
    const h = (location.hash || '#/').replace(/^#/, '');
    const parts = h.split('/').filter(Boolean);
    if (parts.length === 0) return { route: 'home', params: [] };
    if (parts[0] === '') return { route: 'home', params: [] };
    if (parts[0] === 'latest') return { route: 'latest', params: [Number(parts[1]||'1')] };
    if (parts[0] === 'search') return { route: 'search', params: [decodeURIComponent(parts.slice(1).join('/'))] };
    if (parts[0] === 'genre') return { route: 'genre', params: [parts[1] || '', Number(parts[2]||'1')] };
    if (parts[0] === 'manga') return { route: 'manga', params: [parts[1]] };
    if (parts[0] === 'read') return { route: 'read', params: [parts[1], parts[2]] };
    if (parts[0] === 'bookmarks') return { route: 'bookmarks', params: [] };
    return { route: 'home', params: [] };
  }

  async function route(){
    const { route, params } = parseHash();
    try {
      switch(route){
        case 'home':
          return renderHome(1);
        case 'latest':
          return renderHome(params[0]);
        case 'search':
          return renderSearch(params[0] || '');
        case 'genre':
          return renderGenre(params[0] || '', params[1] || 1);
        case 'manga':
          return renderManga(params[0]);
        case 'read':
          return renderReader(params[0], params[1]);
        case 'bookmarks':
          return renderBookmarks();
        default:
          return renderHome(1);
      }
    } catch (e) { setError(e); }
  }

  // Events
  searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = searchInput.value.trim();
    if (!q) return;
    location.hash = `#/search/${encodeURIComponent(q)}`;
  });

  genreSelect.addEventListener('change', (e) => {
    const val = e.target.value;
    if (!val) return;
    location.hash = `#/genre/${encodeURIComponent(val)}/1`;
  });

  window.addEventListener('hashchange', route);
  window.addEventListener('resize', updateHeaderOffset);
  window.addEventListener('load', updateHeaderOffset);

  // Init
  (async function init(){
    ensureGenres();
    updateHeaderOffset();
    if (!location.hash) location.hash = '#/';
    route();
  })();
})();
