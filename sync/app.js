/**
 * MapWarper ↔ Allmaps Sync
 * Compare and sync georeferencing data between MapWarper and Allmaps
 */

const CONFIG = {
  mapwarperBaseUrl: 'https://mapwarper.net',
  allmapsAnnotationsUrl: 'https://annotations.allmaps.org',
  perPage: 20,
};

// Generate IIIF URL for a map
function getMapIiifUrl(mapId) {
  return `${window.location.origin}/mapwarper/maps/${mapId}/iiif`;
}

// Generate compare page URL
function getCompareUrl(mapId, iiifUrl) {
  const mapwarperAnnotationUrl = `${window.location.origin}/mapwarper/maps/${mapId}/annotation.json`;
  const allmapsAnnotationUrl = `https://annotations.allmaps.org/?url=${encodeURIComponent(iiifUrl + '/info.json')}`;
  return `${window.location.origin}/sync/compare.html?mapwarper_url=${encodeURIComponent(mapwarperAnnotationUrl)}&allmaps_url=${encodeURIComponent(allmapsAnnotationUrl)}`;
}

// URL params sync
function getUrlParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    tab: params.get('tab') || 'maps',
    page: parseInt(params.get('page')) || 1,
    q: params.get('q') || '',
    rectified: params.get('rectified') === 'true',
    mosaic: params.get('mosaic') || null,  // Mosaic detail view
    // Tab-specific params
    mapsPage: parseInt(params.get('mapsPage')) || 1,
    mosaicsPage: parseInt(params.get('mosaicsPage')) || 1,
    mapsQ: params.get('mapsQ') || '',
    mosaicsQ: params.get('mosaicsQ') || '',
    mapsRectified: params.get('mapsRectified') === 'true',
  };
}

function updateUrlParams() {
  const params = new URLSearchParams();
  if (state.currentTab !== 'maps') params.set('tab', state.currentTab);
  
  // Tab-specific state
  if (state.currentTab === 'maps') {
    if (state.mapsPage > 1) params.set('page', state.mapsPage);
    if (state.mapsSearchQuery) params.set('q', state.mapsSearchQuery);
    if (state.mapsRectifiedOnly) params.set('rectified', 'true');
  } else {
    if (state.mosaicsPage > 1) params.set('page', state.mosaicsPage);
    if (state.mosaicsSearchQuery) params.set('q', state.mosaicsSearchQuery);
  }
  
  const newUrl = params.toString() 
    ? `${window.location.pathname}?${params.toString()}`
    : window.location.pathname;
  window.history.replaceState({}, '', newUrl);
}

// Parse search query - extract map ID from URL or direct ID
function parseSearchQuery(query) {
  if (!query) return { type: 'text', value: '' };
  
  // Match MapWarper map URL: https://mapwarper.net/maps/102412 or mapwarper.net/maps/102412
  const mapUrlMatch = query.match(/(?:https?:\/\/)?(?:www\.)?mapwarper\.net\/maps\/(\d+)/i);
  if (mapUrlMatch) {
    return { type: 'mapId', value: mapUrlMatch[1] };
  }
  
  // Match MapWarper layer/mosaic URL
  const layerUrlMatch = query.match(/(?:https?:\/\/)?(?:www\.)?mapwarper\.net\/layers\/(\d+)/i);
  if (layerUrlMatch) {
    return { type: 'layerId', value: layerUrlMatch[1] };
  }
  
  // Match pure numeric ID
  if (/^\d+$/.test(query.trim())) {
    return { type: 'id', value: query.trim() };
  }
  
  // Text search
  return { type: 'text', value: query };
}

// State
const state = {
  currentTab: 'maps',
  mapsPage: 1,
  mosaicsPage: 1,
  mosaicMapsPage: 1,
  mapsRectifiedOnly: false,
  mapsSearchQuery: '',
  mosaicsSearchQuery: '',
  mapsData: null,
  mosaicsData: null,
  currentMosaic: null,  // For mosaic detail view
  statusCache: new Map(),
};

// DOM Elements
const elements = {
  mapsGrid: document.getElementById('maps-grid'),
  mosaicsGrid: document.getElementById('mosaics-grid'),
  mapsPagination: document.getElementById('maps-pagination'),
  mosaicsPagination: document.getElementById('mosaics-pagination'),
  mapsContent: document.getElementById('maps-content'),
  mosaicsContent: document.getElementById('mosaics-content'),
  loading: document.getElementById('loading'),
  rectifiedOnly: document.getElementById('rectified-only'),
  refreshBtn: document.getElementById('refresh-btn'),
  rectifiedFilterContainer: document.getElementById('rectified-filter-container'),
  searchInput: document.getElementById('search-input'),
  searchBtn: document.getElementById('search-btn'),
  clearSearchBtn: document.getElementById('clear-search-btn'),
  modal: document.getElementById('status-modal'),
  modalClose: document.getElementById('modal-close'),
  modalTitle: document.getElementById('modal-title'),
  modalBody: document.getElementById('modal-body'),
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  // Load state from URL params
  const params = getUrlParams();
  
  // Check if we're in mosaic detail view
  if (params.mosaic) {
    state.currentMosaic = params.mosaic;
    state.mosaicMapsPage = params.page;
    setupEventListeners();
    loadMosaicDetail(params.mosaic);
    return;
  }
  
  state.currentTab = params.tab;
  if (params.tab === 'maps') {
    state.mapsSearchQuery = params.q;
    state.mapsRectifiedOnly = params.rectified;
    state.mapsPage = params.page;
  } else {
    state.mosaicsSearchQuery = params.q;
    state.mosaicsPage = params.page;
  }
  
  // Update UI to match state for current tab
  const currentQuery = state.currentTab === 'maps' ? state.mapsSearchQuery : state.mosaicsSearchQuery;
  elements.searchInput.value = currentQuery;
  elements.rectifiedOnly.checked = state.mapsRectifiedOnly;
  if (currentQuery) {
    elements.clearSearchBtn.classList.remove('hidden');
  }
  
  // Set active tab UI
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`[data-tab="${state.currentTab}"]`).classList.add('active');
  
  setupEventListeners();
  
  // Load initial tab
  if (state.currentTab === 'maps') {
    elements.mapsContent.classList.remove('hidden');
    elements.mosaicsContent.classList.add('hidden');
    elements.rectifiedFilterContainer.style.display = 'flex';
    loadMaps();
  } else {
    elements.mapsContent.classList.add('hidden');
    elements.mosaicsContent.classList.remove('hidden');
    elements.rectifiedFilterContainer.style.display = 'none';
    loadMosaics();
  }
});

function setupEventListeners() {
  // Tab switching
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // Filter
  elements.rectifiedOnly.addEventListener('change', () => {
    state.mapsRectifiedOnly = elements.rectifiedOnly.checked;
    state.mapsPage = 1;
    loadMaps();
  });

  // Search
  elements.searchBtn.addEventListener('click', performSearch);
  elements.searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') performSearch();
  });
  elements.clearSearchBtn.addEventListener('click', clearSearch);

  // Refresh
  elements.refreshBtn.addEventListener('click', () => {
    state.statusCache.clear();
    if (state.currentTab === 'maps') {
      loadMaps();
    } else {
      loadMosaics();
    }
  });

  // Modal close
  elements.modalClose.addEventListener('click', closeModal);
  elements.modal.addEventListener('click', (e) => {
    if (e.target === elements.modal) closeModal();
  });
}

function performSearch() {
  const query = elements.searchInput.value.trim();
  
  if (state.currentTab === 'maps') {
    state.mapsSearchQuery = query;
    state.mapsPage = 1;
  } else {
    state.mosaicsSearchQuery = query;
    state.mosaicsPage = 1;
  }
  
  if (query) {
    elements.clearSearchBtn.classList.remove('hidden');
  } else {
    elements.clearSearchBtn.classList.add('hidden');
  }
  
  updateUrlParams();
  
  if (state.currentTab === 'maps') {
    loadMaps();
  } else {
    loadMosaics();
  }
}

function clearSearch() {
  if (state.currentTab === 'maps') {
    state.mapsSearchQuery = '';
    state.mapsPage = 1;
  } else {
    state.mosaicsSearchQuery = '';
    state.mosaicsPage = 1;
  }
  elements.searchInput.value = '';
  elements.clearSearchBtn.classList.add('hidden');
  
  updateUrlParams();
  
  if (state.currentTab === 'maps') {
    loadMaps();
  } else {
    loadMosaics();
  }
}

function switchTab(tab) {
  state.currentTab = tab;
  
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
  
  // Update search placeholder and restore tab-specific state
  if (tab === 'maps') {
    elements.searchInput.placeholder = 'Search maps by title, ID, or URL...';
    elements.searchInput.value = state.mapsSearchQuery;
    elements.rectifiedOnly.checked = state.mapsRectifiedOnly;
  } else {
    elements.searchInput.placeholder = 'Search mosaics by name, ID, or URL...';
    elements.searchInput.value = state.mosaicsSearchQuery;
  }
  
  // Update clear button visibility
  const currentQuery = tab === 'maps' ? state.mapsSearchQuery : state.mosaicsSearchQuery;
  if (currentQuery) {
    elements.clearSearchBtn.classList.remove('hidden');
  } else {
    elements.clearSearchBtn.classList.add('hidden');
  }
  
  updateUrlParams();
  
  if (tab === 'maps') {
    elements.mapsContent.classList.remove('hidden');
    elements.mosaicsContent.classList.add('hidden');
    elements.rectifiedFilterContainer.style.display = 'flex';
    if (!state.mapsData) loadMaps();
  } else {
    elements.mapsContent.classList.add('hidden');
    elements.mosaicsContent.classList.remove('hidden');
    elements.rectifiedFilterContainer.style.display = 'none';
    if (!state.mosaicsData) loadMosaics();
  }
}

// API Functions
async function fetchMapWarperMaps(page = 1) {
  const parsed = parseSearchQuery(state.mapsSearchQuery);
  
  // If searching by map ID, fetch that specific map
  if (parsed.type === 'mapId' || (parsed.type === 'id' && state.currentTab === 'maps')) {
    try {
      const response = await fetch(`${CONFIG.mapwarperBaseUrl}/api/v1/maps/${parsed.value}`);
      if (response.ok) {
        const mapData = await response.json();
        return { data: [mapData.data], meta: { total_entries: 1, total_pages: 1 } };
      }
    } catch (e) {
      // Fall through to regular search
    }
  }
  
  const params = new URLSearchParams({
    page: page.toString(),
    per_page: CONFIG.perPage.toString(),
    sort_key: 'updated_at',
    sort_order: 'desc',
  });
  
  if (state.mapsRectifiedOnly) {
    params.set('show_warped', '1');
  }
  
  if (parsed.type === 'text' && parsed.value) {
    params.set('query', parsed.value);
  }
  
  const response = await fetch(`${CONFIG.mapwarperBaseUrl}/api/v1/maps?${params}`);
  if (!response.ok) throw new Error('Failed to fetch maps');
  return response.json();
}

async function fetchMapWarperLayers(page = 1) {
  const parsed = parseSearchQuery(state.mosaicsSearchQuery);
  
  // If searching by layer ID, fetch that specific layer
  if (parsed.type === 'layerId' || (parsed.type === 'id' && state.currentTab === 'mosaics')) {
    try {
      const response = await fetch(`${CONFIG.mapwarperBaseUrl}/api/v1/layers/${parsed.value}`);
      if (response.ok) {
        const layerData = await response.json();
        return { data: [layerData.data], meta: { total_entries: 1, total_pages: 1 } };
      }
    } catch (e) {
      // Fall through to regular search
    }
  }
  
  const params = new URLSearchParams({
    page: page.toString(),
    per_page: CONFIG.perPage.toString(),
    sort_key: 'updated_at',
    sort_order: 'desc',
  });
  
  if (parsed.type === 'text' && parsed.value) {
    params.set('query', parsed.value);
  }
  
  const response = await fetch(`${CONFIG.mapwarperBaseUrl}/api/v1/layers?${params}`);
  if (!response.ok) throw new Error('Failed to fetch layers');
  return response.json();
}

async function fetchMapWarperGCPs(mapId) {
  const response = await fetch(`${CONFIG.mapwarperBaseUrl}/api/v1/maps/${mapId}/gcps`);
  if (!response.ok) {
    if (response.status === 404) return { data: [] };
    throw new Error('Failed to fetch GCPs');
  }
  return response.json();
}

async function fetchMapWarperMask(mapId) {
  // Fetch the mask through our proxy (avoids CORS issues)
  const response = await fetch(`${window.location.origin}/mapwarper/maps/${mapId}/mask.json`);
  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error('Failed to fetch mask');
  }
  const data = await response.json();
  return data.coords || null;
}

function parseGmlMask(gmlText) {
  // Parse GML coordinates from format like: "x1,y1 x2,y2 x3,y3"
  const coordsMatch = gmlText.match(/<gml:coordinates[^>]*>([^<]+)<\/gml:coordinates>/);
  if (!coordsMatch) return null;
  
  const coordsStr = coordsMatch[1].trim();
  const pairs = coordsStr.split(/\s+/).map(pair => {
    const [x, y] = pair.split(',').map(Number);
    return [x, y];
  });
  
  // Remove last point if it's the same as first (closed polygon)
  if (pairs.length > 1 && 
      pairs[0][0] === pairs[pairs.length - 1][0] && 
      pairs[0][1] === pairs[pairs.length - 1][1]) {
    pairs.pop();
  }
  
  return pairs;
}

function formatMaskAsPlainText(coords) {
  return coords.map(([x, y]) => `${x},${y}`).join('\n');
}

function formatMaskAsJson(coords) {
  return JSON.stringify(coords);
}

function formatMaskAsSvg(coords) {
  const points = coords.map(([x, y]) => `${x},${y}`).join(' ');
  return `<polygon points="${points}"/>`;
}

async function generateAllmapsId(iiifUrl) {
  const encoder = new TextEncoder();
  const data = encoder.encode(iiifUrl);
  const hashBuffer = await crypto.subtle.digest('SHA-1', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex.substring(0, 16);
}

async function fetchAllmapsAnnotation(iiifUrl) {
  // Use URL-based lookup which redirects to the correct annotation
  const infoJsonUrl = iiifUrl.endsWith('/info.json') ? iiifUrl : `${iiifUrl}/info.json`;
  const response = await fetch(`${CONFIG.allmapsAnnotationsUrl}/?url=${encodeURIComponent(infoJsonUrl)}`);
  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error('Failed to fetch Allmaps annotation');
  }
  return response.json();
}

// Load functions
async function loadMaps() {
  showLoading();
  try {
    const data = await fetchMapWarperMaps(state.mapsPage);
    state.mapsData = data;
    renderMaps(data);
  } catch (error) {
    console.error('Error loading maps:', error);
    elements.mapsGrid.innerHTML = `<p class="error">Error loading maps: ${error.message}</p>`;
  }
  hideLoading();
}

async function loadMosaics() {
  showLoading();
  try {
    const data = await fetchMapWarperLayers(state.mosaicsPage);
    state.mosaicsData = data;
    renderMosaics(data);
  } catch (error) {
    console.error('Error loading mosaics:', error);
    elements.mosaicsGrid.innerHTML = `<p class="error">Error loading mosaics: ${error.message}</p>`;
  }
  hideLoading();
}

async function loadMosaicDetail(layerId) {
  showLoading();
  
  // Hide normal UI, show mosaic detail view
  document.querySelector('.tabs').style.display = 'none';
  document.querySelector('.filters').style.display = 'none';
  elements.mapsContent.classList.add('hidden');
  elements.mosaicsContent.classList.add('hidden');
  
  // Create mosaic detail container if not exists
  let detailContainer = document.getElementById('mosaic-detail');
  if (!detailContainer) {
    detailContainer = document.createElement('div');
    detailContainer.id = 'mosaic-detail';
    document.querySelector('main').appendChild(detailContainer);
  }
  detailContainer.classList.remove('hidden');
  
  try {
    // Fetch mosaic info
    const response = await fetch(`${CONFIG.mapwarperBaseUrl}/api/v1/layers/${layerId}`);
    if (!response.ok) throw new Error('Failed to fetch mosaic');
    const layerData = await response.json();
    const layer = layerData.data;
    const attrs = layer.attributes;
    
    // Get map IDs from relationships
    const mapIds = layer.relationships?.maps?.data?.map(m => m.id) || [];
    
    // Paginate map IDs
    const perPage = CONFIG.perPage;
    const totalPages = Math.ceil(mapIds.length / perPage);
    const startIdx = (state.mosaicMapsPage - 1) * perPage;
    const pageMapIds = mapIds.slice(startIdx, startIdx + perPage);
    
    // Fetch map details for current page
    const mapPromises = pageMapIds.map(id => 
      fetch(`${CONFIG.mapwarperBaseUrl}/api/v1/maps/${id}`).then(r => r.json()).catch(() => null)
    );
    const mapResults = await Promise.all(mapPromises);
    const maps = mapResults.filter(m => m).map(m => m.data);
    
    // Render mosaic detail
    const thumbUrl = `${CONFIG.mapwarperBaseUrl}/layers/thumb/${layer.id}`;
    const shareUrl = `${window.location.origin}${window.location.pathname}?mosaic=${layer.id}`;
    // MapWarper georeferencing → Allmaps viewer
    const mwAnnotationUrl = `${window.location.origin}/mapwarper/mosaic/${layer.id}/annotation.json`;
    const mwAnnotationUrlRefresh = `${mwAnnotationUrl}?refresh`;
    const mwViewUrl = `https://viewer.allmaps.org/?url=${encodeURIComponent(mwAnnotationUrl)}`;
    const mwViewUrlRefresh = `https://viewer.allmaps.org/?url=${encodeURIComponent(mwAnnotationUrlRefresh)}`;
    // Allmaps georeferencing → Allmaps viewer
    const amAnnotationUrl = `${window.location.origin}/allmaps/mosaic/${layer.id}/annotation.json`;
    const amAnnotationUrlRefresh = `${amAnnotationUrl}?refresh`;
    const amViewUrl = `https://viewer.allmaps.org/?url=${encodeURIComponent(amAnnotationUrl)}`;
    const amViewUrlRefresh = `https://viewer.allmaps.org/?url=${encodeURIComponent(amAnnotationUrlRefresh)}`;
    
    detailContainer.innerHTML = `
      <div style="margin-bottom:1rem;">
        <a href="${window.location.pathname}?tab=mosaics" class="btn btn-secondary btn-small">← Back to Mosaics</a>
      </div>
      <div class="cards-grid" style="margin-bottom:1rem;">
        <div class="card" data-id="${layer.id}" data-type="mosaic" style="max-width:500px;">
          <div class="card-row">
            <div class="card-left">
              <img class="card-thumbnail" src="${thumbUrl}" alt="${attrs.name}" loading="lazy">
              <div class="card-info">
                <div class="card-title" title="${attrs.name}">
                  ${attrs.name || 'Untitled'}
                  <a href="${shareUrl}" onclick="event.preventDefault();copyToClipboard('${shareUrl}')" title="Copy share link" style="margin-left:0.25rem;text-decoration:none;font-size:0.8rem;">🔗</a>
                </div>
                <div class="card-meta">ID: ${layer.id}</div>
                <div class="card-meta">Maps: ${attrs.maps_count} | Rectified: ${attrs.rectified_percent}%</div>
                <div class="card-actions" style="margin-top:0.25rem;display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">
                  <a href="${CONFIG.mapwarperBaseUrl}/layers/${layer.id}" target="_blank" class="btn btn-small" style="background:#e67e22;color:white;font-size:0.7rem;padding:0.2rem 0.4rem;">MapWarper</a>
                  <a id="mw-view-detail-${layer.id}" href="${mwViewUrl}" target="_blank" class="btn btn-small" style="background:#9b59b6;color:white;font-size:0.7rem;padding:0.2rem 0.4rem;" title="View MapWarper georeferencing in Allmaps">View MW</a>
                  <a id="am-view-detail-${layer.id}" href="${amViewUrl}" target="_blank" class="btn btn-small" style="background:#8e44ad;color:white;font-size:0.7rem;padding:0.2rem 0.4rem;" title="View Allmaps georeferencing in Allmaps">View AM</a>
                  <label style="font-size:0.65rem;display:flex;align-items:center;gap:0.2rem;cursor:pointer;" title="Refresh cached annotation data">
                    <input type="checkbox" onchange="toggleMosaicRefresh('detail-${layer.id}', '${mwViewUrl}', '${mwViewUrlRefresh}', '${amViewUrl}', '${amViewUrlRefresh}', this.checked)" style="margin:0;">
                    Refresh
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <hr style="margin:1.5rem 0;border:none;border-top:1px solid #ddd;">
      <h3 style="margin-bottom:1rem;">Maps in this Mosaic (${mapIds.length} total)</h3>
      <div id="mosaic-maps-grid" class="cards-grid"></div>
      <div id="mosaic-maps-pagination" class="pagination"></div>
    `;
    
    // Render map cards
    const mapsGrid = document.getElementById('mosaic-maps-grid');
    mapsGrid.innerHTML = maps.map(map => renderMapCard(map)).join('');
    
    // Render pagination
    const paginationContainer = document.getElementById('mosaic-maps-pagination');
    renderMosaicMapsPagination(paginationContainer, { total_entries: mapIds.length, total_pages: totalPages }, layerId);
    
  } catch (error) {
    console.error('Error loading mosaic detail:', error);
    detailContainer.innerHTML = `<p class="error">Error loading mosaic: ${error.message}</p>`;
  }
  hideLoading();
}

function renderMosaicMapsPagination(container, meta, layerId) {
  const totalPages = meta.total_pages || 1;
  const currentPage = state.mosaicMapsPage;
  
  container.innerHTML = `
    <button ${currentPage <= 1 ? 'disabled' : ''} onclick="goToMosaicMapsPage(${currentPage - 1}, '${layerId}')">← Prev</button>
    <span class="page-info">Page ${currentPage} of ${totalPages} (${meta.total_entries} maps)</span>
    <button ${currentPage >= totalPages ? 'disabled' : ''} onclick="goToMosaicMapsPage(${currentPage + 1}, '${layerId}')">Next →</button>
  `;
}

function goToMosaicMapsPage(page, layerId) {
  state.mosaicMapsPage = page;
  const params = new URLSearchParams();
  params.set('mosaic', layerId);
  if (page > 1) params.set('page', page);
  window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
  loadMosaicDetail(layerId);
}

// Reusable map card renderer
function renderMapCard(map) {
  const attrs = map.attributes;
  let thumbUrl = map.links?.thumb;
  if (thumbUrl && thumbUrl.startsWith('/')) {
    thumbUrl = CONFIG.mapwarperBaseUrl + thumbUrl;
  } else if (!thumbUrl) {
    thumbUrl = `${CONFIG.mapwarperBaseUrl}/maps/thumb/${map.id}`;
  }
  const iiifUrl = `${getMapIiifUrl(map.id)}`;
  const allmapsEditorUrl = `https://editor.allmaps.org/#/georeference?url=${encodeURIComponent(iiifUrl + '/info.json')}`;
  const shareUrl = `${window.location.origin}${window.location.pathname}?q=${map.id}`;
  
  return `
    <div class="card" data-id="${map.id}" data-type="map">
      <div class="card-row">
        <div class="card-left">
          <img class="card-thumbnail" src="${thumbUrl}" alt="${attrs.title}" loading="lazy" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 70 100%22><rect fill=%22%23eee%22 width=%2270%22 height=%22100%22/><text x=%2235%22 y=%2250%22 text-anchor=%22middle%22 dy=%22.3em%22 fill=%22%23999%22 font-size=%228%22>No img</text></svg>'">
          <div class="card-info">
            <div class="card-title" title="${attrs.title}">
              ${attrs.title || 'Untitled'}
              <a href="${shareUrl}" onclick="event.preventDefault();copyToClipboard('${shareUrl}')" title="Copy share link" style="margin-left:0.25rem;text-decoration:none;font-size:0.8rem;">🔗</a>
            </div>
            <div class="card-meta">ID: ${map.id}</div>
            <div class="card-meta">Status: ${attrs.status}</div>
            <div class="card-actions" style="margin-top:0.25rem;">
              <a href="${CONFIG.mapwarperBaseUrl}/maps/${map.id}" target="_blank" class="btn btn-small" style="background:#e67e22;color:white;font-size:0.7rem;padding:0.2rem 0.4rem;">MapWarper</a>
              <a href="${allmapsEditorUrl}" target="_blank" class="btn btn-small" style="background:#9b59b6;color:white;font-size:0.7rem;padding:0.2rem 0.4rem;">Allmaps</a>
            </div>
          </div>
        </div>
        <div class="card-right">
          <button class="btn btn-primary btn-small" style="width:100%;" onclick="fetchStatus('${map.id}', 'map')">Fetch Status</button>
          <div id="status-${map.id}" class="status-container"></div>
        </div>
      </div>
      <div class="card-metadata">
        <button class="card-metadata-toggle" onclick="toggleMetadata('${map.id}')">
          <span id="metadata-arrow-${map.id}">▶</span> More details
        </button>
        <div id="metadata-${map.id}" class="card-metadata-content" data-loaded="false"></div>
      </div>
    </div>
  `;
}

// Render functions
function renderMaps(data) {
  const maps = data.data || [];
  elements.mapsGrid.innerHTML = maps.map(map => renderMapCard(map)).join('');
  renderPagination(elements.mapsPagination, data.meta, 'maps');
}

function renderMosaics(data) {
  const layers = data.data || [];
  
  elements.mosaicsGrid.innerHTML = layers.map(layer => {
    const attrs = layer.attributes;
    
    // Use layer thumb endpoint
    const thumbUrl = `${CONFIG.mapwarperBaseUrl}/layers/thumb/${layer.id}`;
    const shareUrl = `${window.location.origin}${window.location.pathname}?tab=mosaics&q=${layer.id}`;
    // MapWarper georeferencing → Allmaps viewer
    const mwAnnotationUrl = `${window.location.origin}/mapwarper/mosaic/${layer.id}/annotation.json`;
    const mwAnnotationUrlRefresh = `${mwAnnotationUrl}?refresh`;
    const mwViewUrl = `https://viewer.allmaps.org/?url=${encodeURIComponent(mwAnnotationUrl)}`;
    const mwViewUrlRefresh = `https://viewer.allmaps.org/?url=${encodeURIComponent(mwAnnotationUrlRefresh)}`;
    // Allmaps georeferencing → Allmaps viewer
    const amAnnotationUrl = `${window.location.origin}/allmaps/mosaic/${layer.id}/annotation.json`;
    const amAnnotationUrlRefresh = `${amAnnotationUrl}?refresh`;
    const amViewUrl = `https://viewer.allmaps.org/?url=${encodeURIComponent(amAnnotationUrl)}`;
    const amViewUrlRefresh = `https://viewer.allmaps.org/?url=${encodeURIComponent(amAnnotationUrlRefresh)}`;
    
    return `
      <div class="card" data-id="${layer.id}" data-type="mosaic">
        <div class="card-row">
          <div class="card-left">
            <img class="card-thumbnail" src="${thumbUrl}" alt="${attrs.name}" loading="lazy" onerror="this.outerHTML='<div class=\\'card-thumbnail\\' style=\\'display:flex;align-items:center;justify-content:center;background:#e0e0e0;color:#666;width:70px;height:100px;border-radius:4px;font-size:0.6rem;\\'><span>No img</span></div>'">
            <div class="card-info">
              <div class="card-title" title="${attrs.name}">
                <a href="?mosaic=${layer.id}" style="color:inherit;text-decoration:none;">${attrs.name || 'Untitled'}</a>
                <a href="${shareUrl}" onclick="event.preventDefault();copyToClipboard('${shareUrl}')" title="Copy share link" style="margin-left:0.25rem;text-decoration:none;font-size:0.8rem;">🔗</a>
              </div>
              <div class="card-meta">ID: ${layer.id}</div>
              <div class="card-meta">Maps: ${attrs.maps_count} | Rectified: ${attrs.rectified_percent}%</div>
              <div class="card-actions" style="margin-top:0.25rem;display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">
                <a href="${CONFIG.mapwarperBaseUrl}/layers/${layer.id}" target="_blank" class="btn btn-small" style="background:#e67e22;color:white;font-size:0.7rem;padding:0.2rem 0.4rem;">MapWarper</a>
                <a id="mw-view-${layer.id}" href="${mwViewUrl}" target="_blank" class="btn btn-small" style="background:#9b59b6;color:white;font-size:0.7rem;padding:0.2rem 0.4rem;" title="View MapWarper georeferencing in Allmaps">View MW</a>
                <a id="am-view-${layer.id}" href="${amViewUrl}" target="_blank" class="btn btn-small" style="background:#8e44ad;color:white;font-size:0.7rem;padding:0.2rem 0.4rem;" title="View Allmaps georeferencing in Allmaps">View AM</a>
                <label style="font-size:0.65rem;display:flex;align-items:center;gap:0.2rem;cursor:pointer;" title="Refresh cached annotation data">
                  <input type="checkbox" onchange="toggleMosaicRefresh('${layer.id}', '${mwViewUrl}', '${mwViewUrlRefresh}', '${amViewUrl}', '${amViewUrlRefresh}', this.checked)" style="margin:0;">
                  Refresh
                </label>
              </div>
            </div>
          </div>
        </div>
        <div class="card-metadata">
          <button class="card-metadata-toggle" onclick="toggleMosaicMetadata('${layer.id}')">
            <span id="mosaic-metadata-arrow-${layer.id}">▶</span> More details
          </button>
          <div id="mosaic-metadata-${layer.id}" class="card-metadata-content" data-loaded="false"></div>
        </div>
      </div>
    `;
  }).join('');
  
  renderPagination(elements.mosaicsPagination, data.meta, 'mosaics');
}

function toggleMosaicRefresh(layerId, mwUrl, mwUrlRefresh, amUrl, amUrlRefresh, isChecked) {
  const mwLink = document.getElementById(`mw-view-${layerId}`);
  const amLink = document.getElementById(`am-view-${layerId}`);
  if (mwLink) mwLink.href = isChecked ? mwUrlRefresh : mwUrl;
  if (amLink) amLink.href = isChecked ? amUrlRefresh : amUrl;
}

function renderPagination(container, meta, type) {
  if (!meta) {
    container.innerHTML = '';
    return;
  }
  
  const totalPages = meta.total_pages || 1;
  const currentPage = type === 'maps' ? state.mapsPage : state.mosaicsPage;
  
  let html = `
    <button ${currentPage <= 1 ? 'disabled' : ''} onclick="goToPage(${currentPage - 1}, '${type}')">← Prev</button>
    <span class="page-info">Page ${currentPage} of ${totalPages} (${meta.total_entries} items)</span>
    <button ${currentPage >= totalPages ? 'disabled' : ''} onclick="goToPage(${currentPage + 1}, '${type}')">Next →</button>
  `;
  
  container.innerHTML = html;
}

function renderStatusBadge(status) {
  const badges = {
    'none': '<span class="status-badge status-none">No georeferencing</span>',
    'mapwarper-only': '<span class="status-badge status-mapwarper-only">MapWarper only</span>',
    'allmaps-only': '<span class="status-badge status-allmaps-only">Allmaps only</span>',
    'match': '<span class="status-badge status-match">✓ Synced</span>',
    'mismatch': '<span class="status-badge status-mismatch">⚠ Mismatch</span>',
  };
  return badges[status.type] || '';
}

// Status fetching
async function fetchStatus(mapId, type = 'map') {
  const statusContainer = document.getElementById(`status-${mapId}`);
  statusContainer.innerHTML = '<span class="status-badge">Loading...</span>';
  
  try {
    const iiifUrl = `${getMapIiifUrl(mapId)}`;
    
    // Fetch IIIF info.json to get image dimensions
    const iiifInfo = await fetch(`${iiifUrl}/info.json`).then(r => r.json());
    
    // Fetch MapWarper GCPs and mask in parallel
    const [gcpsData, maskCoords] = await Promise.all([
      fetchMapWarperGCPs(mapId),
      fetchMapWarperMask(mapId).catch(() => null),
    ]);
    const mapwarperGcps = gcpsData.data || [];
    
    // Fetch Allmaps annotation
    const allmapsAnnotation = await fetchAllmapsAnnotation(iiifUrl);
    
    // Parse Allmaps GCPs and mask if available
    let allmapsGcps = [];
    let allmapsMask = null;
    if (allmapsAnnotation) {
      allmapsGcps = parseAllmapsGcps(allmapsAnnotation);
      allmapsMask = parseAllmapsMask(allmapsAnnotation);
    }
    
    // Determine status with full comparison
    const status = determineStatus(mapwarperGcps, allmapsGcps, maskCoords, allmapsMask);
    status.mapwarperGcps = mapwarperGcps;
    status.allmapsGcps = allmapsGcps;
    status.allmapsAnnotation = allmapsAnnotation;
    status.iiifUrl = iiifUrl;
    status.iiifInfo = iiifInfo;
    status.mapId = mapId;
    status.maskCoords = maskCoords;
    status.allmapsMask = allmapsMask;
    
    // Cache status
    state.statusCache.set(`map-${mapId}`, status);
    
    // Render inline status with sync buttons
    const hasMapwarperGcps = mapwarperGcps.length > 0;
    const hasAllmapsGcps = allmapsGcps.length > 0;
    const isSynced = status.synced === true;
    
    let html = `
      <div class="status-info" style="margin-top:0.5rem;">
        <div style="display:flex;justify-content:space-between;gap:0.25rem;margin-bottom:0.5rem;">
          <div style="padding:0.25rem 0.5rem;border-radius:4px;font-size:0.65rem;min-width:75px;text-align:center;${hasMapwarperGcps ? 'background:#d4edda;color:#155724;' : 'background:#f8d7da;color:#721c24;'}" title="${hasMapwarperGcps ? 'Georeferencing available in MapWarper' : 'No georeferencing in MapWarper'}">
            ${hasMapwarperGcps ? '✓ MapWarper' : '✗ MapWarper'}
          </div>
          <div style="padding:0.25rem 0.5rem;border-radius:4px;font-size:0.65rem;min-width:75px;text-align:center;${hasAllmapsGcps ? 'background:#d4edda;color:#155724;' : 'background:#f8d7da;color:#721c24;'}" title="${hasAllmapsGcps ? 'Georeferencing available in Allmaps' : 'No georeferencing in Allmaps'}">
            ${hasAllmapsGcps ? '✓ Allmaps' : '✗ Allmaps'}
          </div>
        </div>
        ${isSynced ? `
        <div style="padding:0.25rem 0.5rem;border-radius:4px;font-size:0.7rem;text-align:center;background:#d4edda;color:#155724;margin-bottom:0.5rem;">
          ✓ Synced - GCPs and mask match
        </div>
        ` : `
        <div class="card-actions" style="justify-content:space-between;">
          ${hasMapwarperGcps ? `<button class="btn btn-primary btn-small" style="min-width:90px;" onclick="showSyncToAllmaps('${mapId}')">→ Allmaps</button>` : '<button class="btn btn-secondary btn-small" style="min-width:90px;" disabled>→ Allmaps</button>'}
          ${hasAllmapsGcps ? `<button class="btn btn-primary btn-small" style="min-width:90px;" onclick="showSyncToMapwarper('${mapId}')">MapWarper ←</button>` : '<button class="btn btn-secondary btn-small" style="min-width:90px;" disabled>MapWarper ←</button>'}
        </div>
        ${hasMapwarperGcps && hasAllmapsGcps ? `
        <div class="card-actions" style="margin-top:0.25rem;">
          <a href="${getCompareUrl(mapId, iiifUrl)}" target="_blank" class="btn btn-success" style="width:100%;">🔍 Compare</a>
        </div>
        ` : ''}
        `}
      </div>
    `;
    
    statusContainer.innerHTML = html;
    
  } catch (error) {
    console.error('Error fetching status:', error);
    statusContainer.innerHTML = `<span class="status-badge status-none">Error: ${error.message}</span>`;
  }
}

async function fetchMosaicStatus(layerId) {
  const statusContainer = document.getElementById(`status-mosaic-${layerId}`);
  statusContainer.innerHTML = '<span class="status-badge">Mosaics: check individual maps</span>';
}

function parseAllmapsGcps(annotation) {
  try {
    // Handle different annotation formats
    let gcps = [];
    
    // Handle AnnotationPage (items array)
    if (annotation.type === 'AnnotationPage' && annotation.items) {
      annotation.items.forEach(ann => {
        if (ann.body?.features) {
          ann.body.features.forEach(f => {
            gcps.push({
              x: f.properties?.resourceCoords?.[0],
              y: f.properties?.resourceCoords?.[1],
              lon: f.geometry?.coordinates?.[0],
              lat: f.geometry?.coordinates?.[1],
            });
          });
        }
      });
    } else if (annotation.body && annotation.body.features) {
      // Single annotation
      gcps = annotation.body.features.map(f => ({
        x: f.properties?.resourceCoords?.[0],
        y: f.properties?.resourceCoords?.[1],
        lon: f.geometry?.coordinates?.[0],
        lat: f.geometry?.coordinates?.[1],
      }));
    } else if (Array.isArray(annotation)) {
      // Handle array of annotations
      annotation.forEach(ann => {
        if (ann.body?.features) {
          ann.body.features.forEach(f => {
            gcps.push({
              x: f.properties?.resourceCoords?.[0],
              y: f.properties?.resourceCoords?.[1],
              lon: f.geometry?.coordinates?.[0],
              lat: f.geometry?.coordinates?.[1],
            });
          });
        }
      });
    }
    
    return gcps.filter(g => g.x !== undefined && g.lat !== undefined);
  } catch (e) {
    console.error('Error parsing Allmaps GCPs:', e);
    return [];
  }
}

// Parse mask from Allmaps annotation SVG selector
function parseAllmapsMask(annotation) {
  try {
    let svgValue = null;
    
    if (annotation.type === 'AnnotationPage' && annotation.items?.[0]) {
      svgValue = annotation.items[0].target?.selector?.value;
    } else if (annotation.target?.selector?.value) {
      svgValue = annotation.target.selector.value;
    }
    
    if (!svgValue) return null;
    
    // Parse polygon points from SVG: <svg ...><polygon points="x1,y1 x2,y2 ..." /></svg>
    const match = svgValue.match(/points="([^"]+)"/);
    if (!match) return null;
    
    const coords = match[1].split(/\s+/).map(pair => {
      const [x, y] = pair.split(',').map(Number);
      return [x, y];
    });
    
    return coords;
  } catch (e) {
    console.error('Error parsing Allmaps mask:', e);
    return null;
  }
}

// Compare GCPs with tolerance
function compareGcps(mwGcps, amGcps, tolerance = 1) {
  const differences = [];
  
  if (mwGcps.length !== amGcps.length) {
    differences.push(`GCP count differs: MapWarper ${mwGcps.length}, Allmaps ${amGcps.length}`);
    return { match: false, differences };
  }
  
  // Sort both by x then y for consistent comparison
  const sortFn = (a, b) => (a.x - b.x) || (a.y - b.y);
  const mwSorted = [...mwGcps].map(g => ({ x: g.attributes?.x ?? g.x, y: g.attributes?.y ?? g.y, lon: g.attributes?.lon ?? g.lon, lat: g.attributes?.lat ?? g.lat })).sort(sortFn);
  const amSorted = [...amGcps].sort(sortFn);
  
  for (let i = 0; i < mwSorted.length; i++) {
    const mw = mwSorted[i];
    const am = amSorted[i];
    
    const xDiff = Math.abs(mw.x - am.x);
    const yDiff = Math.abs(mw.y - am.y);
    const lonDiff = Math.abs(mw.lon - am.lon);
    const latDiff = Math.abs(mw.lat - am.lat);
    
    if (xDiff > tolerance || yDiff > tolerance) {
      differences.push(`GCP ${i+1} pixel coords differ: MW(${mw.x.toFixed(2)},${mw.y.toFixed(2)}) vs AM(${am.x.toFixed(2)},${am.y.toFixed(2)})`);
    }
    if (lonDiff > 0.0001 || latDiff > 0.0001) {
      differences.push(`GCP ${i+1} geo coords differ: MW(${mw.lon.toFixed(6)},${mw.lat.toFixed(6)}) vs AM(${am.lon.toFixed(6)},${am.lat.toFixed(6)})`);
    }
  }
  
  return { match: differences.length === 0, differences };
}

// Compare masks with tolerance
function compareMasks(mwMask, amMask, tolerance = 1) {
  const differences = [];
  
  if (!mwMask && !amMask) return { match: true, differences: [] };
  if (!mwMask || !amMask) {
    differences.push(`Mask exists only in ${mwMask ? 'MapWarper' : 'Allmaps'}`);
    return { match: false, differences };
  }
  
  if (mwMask.length !== amMask.length) {
    differences.push(`Mask point count differs: MapWarper ${mwMask.length}, Allmaps ${amMask.length}`);
    return { match: false, differences };
  }
  
  // Sort both by x then y for consistent comparison
  const sortFn = (a, b) => (a[0] - b[0]) || (a[1] - b[1]);
  const mwSorted = [...mwMask].sort(sortFn);
  const amSorted = [...amMask].sort(sortFn);
  
  for (let i = 0; i < mwSorted.length; i++) {
    const mw = mwSorted[i];
    const am = amSorted[i];
    
    const xDiff = Math.abs(mw[0] - am[0]);
    const yDiff = Math.abs(mw[1] - am[1]);
    
    if (xDiff > tolerance || yDiff > tolerance) {
      differences.push(`Mask point ${i+1} differs: MW(${mw[0].toFixed(2)},${mw[1].toFixed(2)}) vs AM(${am[0].toFixed(2)},${am[1].toFixed(2)})`);
    }
  }
  
  return { match: differences.length === 0, differences };
}

function determineStatus(mapwarperGcps, allmapsGcps, mwMask, amMask) {
  const hasMw = mapwarperGcps.length > 0;
  const hasAm = allmapsGcps.length > 0;
  
  if (!hasMw && !hasAm) {
    return { type: 'none', synced: false };
  }
  
  if (hasMw && !hasAm) {
    return { type: 'mapwarper-only', synced: false };
  }
  
  if (!hasMw && hasAm) {
    return { type: 'allmaps-only', synced: false };
  }
  
  // Both have GCPs - compare them in detail
  const gcpComparison = compareGcps(mapwarperGcps, allmapsGcps);
  const maskComparison = compareMasks(mwMask, amMask);
  
  const allDifferences = [...gcpComparison.differences, ...maskComparison.differences];
  
  if (allDifferences.length > 0) {
    console.log('=== Georeferencing Differences ===');
    allDifferences.forEach(d => console.log(d));
    console.log('==================================');
    return { type: 'mismatch', synced: false, differences: allDifferences };
  }
  
  console.log('=== Georeferencing Match ===');
  console.log(`GCPs: ${mapwarperGcps.length} points match`);
  console.log(`Mask: ${mwMask?.length || 0} points match`);
  console.log('============================');
  return { type: 'match', synced: true };
}

// Modal functions
function closeModal() {
  elements.modal.classList.add('hidden');
}

async function showSyncToAllmaps(mapId) {
  const status = state.statusCache.get(`map-${mapId}`);
  if (!status) return;
  
  elements.modalTitle.textContent = `Map ${mapId} - Sync to Allmaps`;
  
  // Generate URLs
  const allmapsEditorUrl = `https://editor.allmaps.org/#/georeference?url=${encodeURIComponent(status.iiifUrl + '/info.json')}`;
  const annotationUrl = `${window.location.origin}/mapwarper/maps/${mapId}/annotation.json`;
  const allmapsViewerWithAnnotationUrl = `https://viewer.allmaps.org/?url=${encodeURIComponent(annotationUrl)}`;
  
  // Annotation section
  const annotationSection = `
  <div class="comparison-section">
    <h3>MapWarper Georeferencing as Allmaps Annotation</h3>
    <p style="margin-bottom:0.5rem;">This annotation is auto-generated from MapWarper GCPs:</p>
    <div style="margin-bottom:1rem;">
      <input type="text" value="${annotationUrl}" readonly style="width:100%;padding:0.5rem;font-size:0.8rem;margin-top:0.25rem;">
      <div style="margin-top:0.5rem;">
        <button class="btn btn-small" onclick="copyToClipboard('${annotationUrl}')">📋 Copy URL</button>
        <a href="${annotationUrl}" target="_blank" class="btn btn-secondary btn-small">View JSON</a>
        <a href="${allmapsViewerWithAnnotationUrl}" target="_blank" class="btn btn-success btn-small">🗺️ View in Allmaps Viewer</a>
      </div>
    </div>
  </div>
  `;
  
  // Allmaps Editor URL section
  const editorSection = `
  <div class="comparison-section">
    <h3>Edit in Allmaps</h3>
    <p style="margin-bottom:0.5rem;">Open Allmaps Editor to manually add/modify georeferencing:</p>
    <div>
      <input type="text" value="${allmapsEditorUrl}" readonly style="width:100%;padding:0.5rem;font-size:0.8rem;">
      <div style="margin-top:0.5rem;">
        <button class="btn btn-small" onclick="copyToClipboard('${allmapsEditorUrl}')">📋 Copy URL</button>
        <a href="${allmapsEditorUrl}" target="_blank" class="btn btn-success btn-small">Open Allmaps Editor</a>
      </div>
    </div>
  </div>
  `;
  
  // Mask export section if mask exists
  let maskSection = '';
  if (status.maskCoords && status.maskCoords.length > 0) {
    const svgFormat = formatMaskAsSvg(status.maskCoords);
    
    maskSection = `
    <div class="comparison-section">
      <h3>Mask for Allmaps (${status.maskCoords.length} points)</h3>
      <p style="margin-bottom:0.5rem;">Copy this SVG and paste into Allmaps Editor resource mask:</p>
      <textarea id="mask-svg" style="width:100%;height:80px;font-family:monospace;font-size:0.8rem;" readonly>${escapeHtml(svgFormat)}</textarea>
      <button class="btn btn-small" onclick="copyMaskFormat('svg')">📋 Copy SVG</button>
    </div>
    `;
  }
  
  // GCPs export section
  const gcpsPlain = formatGcpsAsPlainText(status.mapwarperGcps);
  const gcpsSection = `
  <div class="comparison-section">
    <h3>GCPs for Allmaps (${status.mapwarperGcps.length} points)</h3>
    <p style="margin-bottom:0.5rem;">GDAL format (pixelX pixelY lon lat):</p>
    <textarea id="gcps-plain" style="width:100%;height:120px;font-family:monospace;font-size:0.8rem;" readonly>${gcpsPlain}</textarea>
    <button class="btn btn-small" onclick="copyGcpsFormat()">📋 Copy GCPs</button>
  </div>
  `;
  
  elements.modalBody.innerHTML = `
    ${annotationSection}
    ${editorSection}
    ${gcpsSection}
    ${maskSection}
  `;
  
  elements.modal.classList.remove('hidden');
}

async function showSyncToMapwarper(mapId) {
  const status = state.statusCache.get(`map-${mapId}`);
  if (!status || !status.allmapsAnnotation) return;
  
  elements.modalTitle.textContent = `Map ${mapId} - Sync to MapWarper`;
  
  // Parse GCPs from Allmaps annotation
  const allmapsGcps = status.allmapsGcps || [];
  
  // Format GCPs for MapWarper upload (CSV format: id,x,y,lon,lat)
  const gcpsForMapwarper = allmapsGcps.map((gcp, i) => {
    return `${gcp.x},${gcp.y},${gcp.lon},${gcp.lat}`;
  }).join('\n');
  
  const mapwarperEditUrl = `${CONFIG.mapwarperBaseUrl}/maps/${mapId}/warp`;
  
  // Get Allmaps annotation URL for viewer
  const allmapsAnnotationUrl = `https://annotations.allmaps.org/?url=${encodeURIComponent(status.iiifUrl + '/info.json')}`;
  const allmapsViewerUrl = `https://viewer.allmaps.org/?url=${encodeURIComponent(allmapsAnnotationUrl)}`;
  
  const viewerSection = `
  <div class="comparison-section">
    <h3>View Allmaps Georeferencing</h3>
    <p style="margin-bottom:0.5rem;">See how this map is georeferenced in Allmaps:</p>
    <a href="${allmapsViewerUrl}" target="_blank" class="btn btn-success">🗺️ Open in Allmaps Viewer</a>
  </div>
  `;
  
  const gcpsSection = `
  <div class="comparison-section">
    <h3>GCPs from Allmaps (${allmapsGcps.length} points)</h3>
    <p style="margin-bottom:0.5rem;">Format: x,y,lon,lat (MapWarper compatible)</p>
    <textarea id="allmaps-gcps" style="width:100%;height:150px;font-family:monospace;font-size:0.8rem;" readonly>${gcpsForMapwarper}</textarea>
    <div style="display:flex;gap:0.5rem;margin-top:0.5rem;">
      <button class="btn btn-small" onclick="copyAllmapsGcps()">📋 Copy GCPs</button>
      <button class="btn btn-small" onclick="downloadGcpsCsv('${mapId}')">⬇️ Download CSV</button>
    </div>
  </div>
  `;
  
  const editSection = `
  <div class="comparison-section">
    <h3>Edit in MapWarper</h3>
    <p style="margin-bottom:0.5rem;">Open MapWarper to manually add control points:</p>
    <a href="${mapwarperEditUrl}" target="_blank" class="btn btn-primary">Open MapWarper Warp Editor</a>
  </div>
  `;
  
  elements.modalBody.innerHTML = `
    ${viewerSection}
    ${gcpsSection}
    ${editSection}
  `;
  
  elements.modal.classList.remove('hidden');
}

function copyAllmapsGcps() {
  const textarea = document.getElementById('allmaps-gcps');
  if (textarea) {
    navigator.clipboard.writeText(textarea.value)
      .then(() => alert('GCPs copied to clipboard!'))
      .catch(err => alert('Failed to copy: ' + err));
  }
}

function downloadGcpsCsv(mapId) {
  const textarea = document.getElementById('allmaps-gcps');
  if (textarea) {
    // MapWarper CSV format: x,y,lon,lat (pixel coords, then geo coords)
    const csvContent = 'x,y,lon,lat\n' + textarea.value;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `gcps_map_${mapId}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text)
    .then(() => alert('Copied to clipboard!'))
    .catch(err => alert('Failed to copy: ' + err));
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatGcpsAsPlainText(gcps, imageHeight) {
  // GDAL format: resourceX resourceY geoX geoY (space-separated)
  // This is the default format Allmaps uses, with resource origin at top-left, Y-axis pointing down
  return gcps.map(gcp => {
    const a = gcp.attributes;
    return `${a.x} ${a.y} ${a.lon} ${a.lat}`;
  }).join('\n');
}

function copyMaskFormat(format) {
  const textarea = document.getElementById(`mask-${format}`);
  if (textarea) {
    navigator.clipboard.writeText(textarea.value)
      .then(() => alert('Mask copied to clipboard!'))
      .catch(err => alert('Failed to copy: ' + err));
  }
}

function copyGcpsFormat() {
  const textarea = document.getElementById('gcps-plain');
  if (textarea) {
    navigator.clipboard.writeText(textarea.value)
      .then(() => alert('GCPs copied to clipboard!'))
      .catch(err => alert('Failed to copy: ' + err));
  }
}

async function copyAnnotation(mapId) {
  const annotationUrl = `${window.location.origin}/mapwarper/maps/${mapId}/annotation.json`;
  try {
    const response = await fetch(annotationUrl);
    const annotation = await response.json();
    await navigator.clipboard.writeText(JSON.stringify(annotation, null, 2));
    alert('Annotation copied to clipboard!');
  } catch (err) {
    alert('Failed to copy: ' + err);
  }
}

async function downloadAnnotation(mapId) {
  const annotationUrl = `${window.location.origin}/mapwarper/maps/${mapId}/annotation.json`;
  try {
    const response = await fetch(annotationUrl);
    const annotation = await response.json();
    const blob = new Blob([JSON.stringify(annotation, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mapwarper-${mapId}-annotation.json`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert('Failed to download: ' + err);
  }
}

// Navigation
function goToPage(page, type) {
  if (type === 'maps') {
    state.mapsPage = page;
    updateUrlParams();
    loadMaps();
  } else {
    state.mosaicsPage = page;
    updateUrlParams();
    loadMosaics();
  }
}

// Helpers
function showLoading() {
  elements.loading.classList.remove('hidden');
}

function hideLoading() {
  elements.loading.classList.add('hidden');
}

// Toggle metadata and load if first time
async function toggleMetadata(mapId) {
  const content = document.getElementById(`metadata-${mapId}`);
  const arrow = document.getElementById(`metadata-arrow-${mapId}`);
  
  if (content.classList.contains('expanded')) {
    content.classList.remove('expanded');
    arrow.textContent = '▶';
    return;
  }
  
  // Load metadata if not loaded yet
  if (content.dataset.loaded === 'false') {
    content.innerHTML = '<em>Loading...</em>';
    content.classList.add('expanded');
    arrow.textContent = '▼';
    
    try {
      const response = await fetch(`${CONFIG.mapwarperBaseUrl}/api/v1/maps/${mapId}`);
      if (!response.ok) throw new Error('Failed to fetch');
      const data = await response.json();
      const attrs = data.data.attributes;
      
      const createdAt = attrs.created_at ? new Date(attrs.created_at).toLocaleDateString() : 'N/A';
      const updatedAt = attrs.updated_at ? new Date(attrs.updated_at).toLocaleDateString() : 'N/A';
      
      content.innerHTML = `
        <div style="display:grid;grid-template-columns:auto 1fr;gap:0.25rem 0.5rem;">
          <strong>Created:</strong><span>${createdAt}</span>
          <strong>Updated:</strong><span>${updatedAt}</span>
          ${attrs.description ? `<strong>Description:</strong><span>${attrs.description}</span>` : ''}
          ${attrs.source_uri ? `<strong>Source:</strong><span><a href="${attrs.source_uri}" target="_blank">${attrs.source_uri}</a></span>` : ''}
          ${attrs.bbox ? `<strong>Bbox:</strong><span>${attrs.bbox}</span>` : ''}
        </div>
      `;
      content.dataset.loaded = 'true';
    } catch (err) {
      content.innerHTML = '<em>Failed to load metadata</em>';
    }
  } else {
    content.classList.add('expanded');
    arrow.textContent = '▼';
  }
}

// Toggle mosaic metadata and load if first time
async function toggleMosaicMetadata(layerId) {
  const content = document.getElementById(`mosaic-metadata-${layerId}`);
  const arrow = document.getElementById(`mosaic-metadata-arrow-${layerId}`);
  
  if (content.classList.contains('expanded')) {
    content.classList.remove('expanded');
    arrow.textContent = '▶';
    return;
  }
  
  // Load metadata if not loaded yet
  if (content.dataset.loaded === 'false') {
    content.innerHTML = '<em>Loading...</em>';
    content.classList.add('expanded');
    arrow.textContent = '▼';
    
    try {
      const response = await fetch(`${CONFIG.mapwarperBaseUrl}/api/v1/layers/${layerId}`);
      if (!response.ok) throw new Error('Failed to fetch');
      const data = await response.json();
      const attrs = data.data.attributes;
      
      const createdAt = attrs.created_at ? new Date(attrs.created_at).toLocaleDateString() : 'N/A';
      const updatedAt = attrs.updated_at ? new Date(attrs.updated_at).toLocaleDateString() : 'N/A';
      
      content.innerHTML = `
        <div style="display:grid;grid-template-columns:auto 1fr;gap:0.25rem 0.5rem;">
          <strong>Created:</strong><span>${createdAt}</span>
          <strong>Updated:</strong><span>${updatedAt}</span>
          ${attrs.description ? `<strong>Description:</strong><span>${attrs.description}</span>` : ''}
          ${attrs.bbox ? `<strong>Bbox:</strong><span>${attrs.bbox}</span>` : ''}
        </div>
      `;
      content.dataset.loaded = 'true';
    } catch (err) {
      content.innerHTML = '<em>Failed to load metadata</em>';
    }
  } else {
    content.classList.add('expanded');
    arrow.textContent = '▼';
  }
}
