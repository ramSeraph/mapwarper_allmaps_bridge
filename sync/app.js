/**
 * MapWarper ↔ Allmaps Sync
 * Compare and sync georeferencing data between MapWarper and Allmaps
 */

import { generateAnnotation } from 'https://esm.sh/@allmaps/annotation@1.0.0-beta.36';

const CONFIG = {
  mapwarperBaseUrl: 'https://mapwarper.net',
  allmapsAnnotationsUrl: 'https://annotations.allmaps.org',
  perPage: 20,
};

// Generate IIIF URL for a map
function getMapIiifUrl(mapId) {
  return `${window.location.origin}/mapwarper/maps/${mapId}/iiif`;
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
  loadingBar: document.getElementById('loading-bar'),
  rectifiedOnly: document.getElementById('rectified-only'),
  refreshBtn: document.getElementById('refresh-btn'),
  rectifiedFilterContainer: document.getElementById('rectified-filter-container'),
  searchInput: document.getElementById('search-input'),
  searchBtn: document.getElementById('search-btn'),
  clearSearchBtn: document.getElementById('clear-search-btn'),
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
}

async function performSearch() {
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
    await loadMaps();
  } else {
    await loadMosaics();
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
  showLoadingBar();
  try {
    const data = await fetchMapWarperMaps(state.mapsPage);
    state.mapsData = data;
    renderMaps(data);
  } catch (error) {
    console.error('Error loading maps:', error);
    elements.mapsGrid.innerHTML = `<p class="error">Error loading maps: ${error.message}</p>`;
  }
  hideLoadingBar();
}

async function loadMosaics() {
  showLoadingBar();
  try {
    const data = await fetchMapWarperLayers(state.mosaicsPage);
    state.mosaicsData = data;
    renderMosaics(data);
  } catch (error) {
    console.error('Error loading mosaics:', error);
    elements.mosaicsGrid.innerHTML = `<p class="error">Error loading mosaics: ${error.message}</p>`;
  }
  hideLoadingBar();
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
                </div>
                <div class="card-links">
                  <button class="btn-link" onclick="generateMosaicViewerUrl('${layer.id}', '${mapIds.join(',')}')">View MW in Allmaps</button>
                  <span id="mosaic-viewer-url-${layer.id}" class="generated-url"></span>
                  <button class="btn-link" onclick="generateAllmapsMosaicViewerUrl('${layer.id}', '${mapIds.join(',')}')">View Allmaps in Allmaps</button>
                  <span id="allmaps-mosaic-viewer-url-${layer.id}" class="generated-url"></span>
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
  const editorAllmapsUrl = `editor.html?map=${map.id}&mode=allmaps`;
  const editorMapwarperUrl = `editor.html?map=${map.id}&mode=mapwarper`;
  const shareUrl = `${window.location.origin}${window.location.pathname}?q=${map.id}`;
  
  // Links
  const mwWarpUrl = `${CONFIG.mapwarperBaseUrl}/maps/${map.id}/warp`;
  const allmapsEditorUrl = `https://editor.allmaps.org/#/georeference?url=${encodeURIComponent(iiifUrl + '/info.json')}`;
  const allmapsViewerUrl = `https://viewer.allmaps.org/?url=${encodeURIComponent(iiifUrl + '/info.json')}`;
  
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
              <a href="${editorAllmapsUrl}" target="_blank" class="btn btn-small" style="background:#9b59b6;color:white;font-size:0.7rem;padding:0.2rem 0.4rem;" title="Sync georeferencing to Allmaps">Sync to Allmaps</a>
              <a href="${editorMapwarperUrl}" target="_blank" class="btn btn-small" style="background:#e67e22;color:white;font-size:0.7rem;padding:0.2rem 0.4rem;" title="Sync georeferencing to MapWarper">Sync to MW</a>
            </div>
            <div class="card-links">
              <a href="${mwWarpUrl}" target="_blank">Edit in MW</a>
              <a href="${allmapsEditorUrl}" target="_blank">Edit in Allmaps</a>
              <a href="${allmapsViewerUrl}" target="_blank">View in Allmaps</a>
              <button class="btn-link" onclick="generateMwViewerUrl('${map.id}', '${iiifUrl}')">View MW in Allmaps</button>
              <span id="mw-viewer-url-${map.id}" class="generated-url"></span>
            </div>
          </div>
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
    
    return `
      <div class="card" data-id="${layer.id}" data-type="mosaic">
        <div class="card-row">
          <div class="card-left">
            <img class="card-thumbnail" src="${thumbUrl}" alt="${attrs.name}" loading="lazy" onerror="this.outerHTML='<div class=\\'card-thumbnail\\' style=\\'display:flex;align-items:center;justify-content:center;background:#e0e0e0;color:#666;width:70px;height:100px;border-radius:4px;font-size:0.6rem;\\'><span>No img</span></div>'">
            <div class="card-info">
              <div class="card-title" title="${attrs.name}">
                ${attrs.name || 'Untitled'}
                <a href="${shareUrl}" onclick="event.preventDefault();copyToClipboard('${shareUrl}')" title="Copy share link" style="margin-left:0.25rem;text-decoration:none;font-size:0.8rem;">🔗</a>
              </div>
              <div class="card-meta">ID: ${layer.id}</div>
              <div class="card-meta">Maps: ${attrs.maps_count} | Rectified: ${attrs.rectified_percent}%</div>
              <div class="card-actions" style="margin-top:0.25rem;display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">
                <a href="?mosaic=${layer.id}" class="btn btn-small" style="background:#3498db;color:white;font-size:0.7rem;padding:0.2rem 0.4rem;">List Maps</a>
                <a href="${CONFIG.mapwarperBaseUrl}/layers/${layer.id}" target="_blank" class="btn btn-small" style="background:#e67e22;color:white;font-size:0.7rem;padding:0.2rem 0.4rem;">MapWarper</a>
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
function copyToClipboard(text) {
  navigator.clipboard.writeText(text)
    .then(() => alert('Copied to clipboard!'))
    .catch(err => alert('Failed to copy: ' + err));
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

function showLoadingBar() {
  elements.loadingBar.classList.remove('hidden');
}

function hideLoadingBar() {
  elements.loadingBar.classList.add('hidden');
}

// Generate MW viewer URL by fetching GCPs and mask, then creating annotation
async function generateMwViewerUrl(mapId, iiifUrl) {
  const urlSpan = document.getElementById(`mw-viewer-url-${mapId}`);
  urlSpan.textContent = 'Loading...';
  
  try {
    // Fetch GCPs and image info
    const [gcpsRes, infoRes, maskRes] = await Promise.all([
      fetch(`${CONFIG.mapwarperBaseUrl}/api/v1/maps/${mapId}/gcps`),
      fetch(`${iiifUrl}/info.json`),
      fetch(`${window.location.origin}/mapwarper/maps/${mapId}/mask.json`)
    ]);
    
    if (!gcpsRes.ok) throw new Error('Failed to fetch GCPs');
    if (!infoRes.ok) throw new Error('Failed to fetch IIIF info');
    
    const gcpsData = await gcpsRes.json();
    const iiifInfo = await infoRes.json();
    const gcps = gcpsData.data || [];
    
    if (gcps.length === 0) {
      urlSpan.textContent = 'No GCPs';
      return;
    }
    
    // Get mask coords (use image perimeter if no mask)
    let maskCoords;
    if (maskRes.ok) {
      const maskData = await maskRes.json();
      maskCoords = maskData.coordinates || [[0, 0], [iiifInfo.width, 0], [iiifInfo.width, iiifInfo.height], [0, iiifInfo.height]];
    } else {
      maskCoords = [[0, 0], [iiifInfo.width, 0], [iiifInfo.width, iiifInfo.height], [0, iiifInfo.height]];
    }
    
    // Build GeoreferencedMap object for @allmaps/annotation
    const georeferencedMap = {
      type: 'GeoreferencedMap',
      resource: {
        id: iiifUrl,
        type: 'ImageService2',
        width: iiifInfo.width,
        height: iiifInfo.height
      },
      gcps: gcps.map(gcp => ({
        resource: [parseFloat(gcp.attributes.x), parseFloat(gcp.attributes.y)],
        geo: [parseFloat(gcp.attributes.lon), parseFloat(gcp.attributes.lat)]
      })),
      resourceMask: maskCoords
    };
    
    const annotation = generateAnnotation(georeferencedMap);
    const jsonStr = JSON.stringify(annotation, null, 0);
    const viewerUrl = `https://viewer.allmaps.org/?data=${encodeURIComponent(jsonStr)}`;
    
    // Check if URL is too long
    if (viewerUrl.length > 8000) {
      urlSpan.innerHTML = `<span style="color:#e67e22;">URL too long</span> 
        <button class="btn-link" onclick="copyMapAnnotation('${mapId}')">Copy JSON</button>`;
      window._mapAnnotations = window._mapAnnotations || {};
      window._mapAnnotations[mapId] = jsonStr;
    } else {
      urlSpan.innerHTML = `<a href="${viewerUrl}" target="_blank">Open ↗</a>`;
    }
  } catch (err) {
    urlSpan.textContent = 'Error';
    console.error('Failed to generate MW viewer URL:', err);
  }
}

// Generate mosaic viewer URL by fetching GCPs and mask for all maps
async function generateMosaicViewerUrl(layerId, mapIdsStr) {
  const urlSpan = document.getElementById(`mosaic-viewer-url-${layerId}`);
  urlSpan.textContent = 'Loading...';
  
  const mapIds = mapIdsStr.split(',').filter(id => id);
  const chunkSize = 20;
  
  try {
    // Helper to fetch data for a single map
    const fetchMapData = async (mapId) => {
      const iiifUrl = getMapIiifUrl(mapId);
      const [gcpsRes, infoRes, maskRes] = await Promise.all([
        fetch(`${CONFIG.mapwarperBaseUrl}/api/v1/maps/${mapId}/gcps`),
        fetch(`${iiifUrl}/info.json`),
        fetch(`${window.location.origin}/mapwarper/maps/${mapId}/mask.json`)
      ]);
      
      if (!gcpsRes.ok || !infoRes.ok) return null;
      
      const gcpsData = await gcpsRes.json();
      const iiifInfo = await infoRes.json();
      const gcps = gcpsData.data || [];
      
      if (gcps.length === 0) return null;
      
      // Get mask coords (use image perimeter if no mask)
      let maskCoords;
      if (maskRes.ok) {
        const maskData = await maskRes.json();
        maskCoords = maskData.coordinates || [[0, 0], [iiifInfo.width, 0], [iiifInfo.width, iiifInfo.height], [0, iiifInfo.height]];
      } else {
        maskCoords = [[0, 0], [iiifInfo.width, 0], [iiifInfo.width, iiifInfo.height], [0, iiifInfo.height]];
      }
      
      return {
        type: 'GeoreferencedMap',
        resource: {
          id: iiifUrl,
          type: 'ImageService2',
          width: iiifInfo.width,
          height: iiifInfo.height
        },
        gcps: gcps.map(gcp => ({
          resource: [parseFloat(gcp.attributes.x), parseFloat(gcp.attributes.y)],
          geo: [parseFloat(gcp.attributes.lon), parseFloat(gcp.attributes.lat)]
        })),
        resourceMask: maskCoords
      };
    };
    
    // Process in chunks of 20
    const georeferencedMaps = [];
    for (let i = 0; i < mapIds.length; i += chunkSize) {
      const chunk = mapIds.slice(i, i + chunkSize);
      urlSpan.textContent = `Loading... (${i}/${mapIds.length})`;
      const chunkResults = await Promise.all(chunk.map(fetchMapData));
      georeferencedMaps.push(...chunkResults.filter(m => m));
    }
    
    if (georeferencedMaps.length === 0) {
      urlSpan.textContent = 'No GCPs';
      return;
    }
    
    const annotation = generateAnnotation(georeferencedMaps);
    const jsonStr = JSON.stringify(annotation, null, 0);
    const viewerUrl = `https://viewer.allmaps.org/?data=${encodeURIComponent(jsonStr)}`;
    
    // Check if URL is too long (browsers typically limit to ~2000-8000 chars)
    if (viewerUrl.length > 8000) {
      urlSpan.innerHTML = `<span style="color:#e67e22;">${georeferencedMaps.length} maps - URL too long</span> 
        <button class="btn-link" onclick="copyMosaicAnnotation('${layerId}')">Copy JSON</button>`;
      // Store annotation for copy
      window._mosaicAnnotations = window._mosaicAnnotations || {};
      window._mosaicAnnotations[layerId] = jsonStr;
    } else {
      urlSpan.innerHTML = `<a href="${viewerUrl}" target="_blank">Open ↗ (${georeferencedMaps.length} maps)</a>`;
    }
  } catch (err) {
    urlSpan.textContent = 'Error';
    console.error('Failed to generate mosaic viewer URL:', err);
  }
}

// Copy map annotation JSON to clipboard
function copyMapAnnotation(mapId) {
  const jsonStr = window._mapAnnotations?.[mapId];
  if (jsonStr) {
    navigator.clipboard.writeText(jsonStr).then(() => {
      alert('Annotation JSON copied! Paste it in Allmaps Viewer using the data input.');
    });
  }
}

// Copy mosaic annotation JSON to clipboard
function copyMosaicAnnotation(layerId) {
  const jsonStr = window._mosaicAnnotations?.[layerId];
  if (jsonStr) {
    navigator.clipboard.writeText(jsonStr).then(() => {
      alert('Annotation JSON copied! Paste it in Allmaps Viewer using the data input.');
    });
  }
}

// Generate Allmaps mosaic viewer URL by fetching annotations from Allmaps
async function generateAllmapsMosaicViewerUrl(layerId, mapIdsStr) {
  const urlSpan = document.getElementById(`allmaps-mosaic-viewer-url-${layerId}`);
  urlSpan.textContent = 'Loading...';
  
  const mapIds = mapIdsStr.split(',').filter(id => id);
  const chunkSize = 20;
  
  try {
    // Helper to fetch annotation for a single map from Allmaps
    const fetchMapAnnotation = async (mapId) => {
      const iiifUrl = getMapIiifUrl(mapId);
      const annotationUrl = `${CONFIG.allmapsAnnotationsUrl}/maps/${encodeURIComponent(iiifUrl)}`;
      
      try {
        const res = await fetch(annotationUrl);
        if (!res.ok) return null;
        const annotation = await res.json();
        // Parse the annotation to get GeoreferencedMap(s)
        const { parseAnnotation } = await import('https://esm.sh/@allmaps/annotation@1.0.0-beta.36');
        const maps = parseAnnotation(annotation);
        return Array.isArray(maps) ? maps : [maps];
      } catch {
        return null;
      }
    };
    
    // Process in chunks of 20
    const allGeoreferencedMaps = [];
    for (let i = 0; i < mapIds.length; i += chunkSize) {
      const chunk = mapIds.slice(i, i + chunkSize);
      urlSpan.textContent = `Loading... (${i}/${mapIds.length})`;
      const chunkResults = await Promise.all(chunk.map(fetchMapAnnotation));
      for (const maps of chunkResults) {
        if (maps) allGeoreferencedMaps.push(...maps);
      }
    }
    
    if (allGeoreferencedMaps.length === 0) {
      urlSpan.textContent = 'No annotations';
      return;
    }
    
    const annotation = generateAnnotation(allGeoreferencedMaps);
    const jsonStr = JSON.stringify(annotation, null, 0);
    const viewerUrl = `https://viewer.allmaps.org/?data=${encodeURIComponent(jsonStr)}`;
    
    // Check if URL is too long
    if (viewerUrl.length > 8000) {
      urlSpan.innerHTML = `<span style="color:#e67e22;">${allGeoreferencedMaps.length} maps - URL too long</span> 
        <button class="btn-link" onclick="copyAllmapsMosaicAnnotation('${layerId}')">Copy JSON</button>`;
      window._allmapsMosaicAnnotations = window._allmapsMosaicAnnotations || {};
      window._allmapsMosaicAnnotations[layerId] = jsonStr;
    } else {
      urlSpan.innerHTML = `<a href="${viewerUrl}" target="_blank">Open ↗ (${allGeoreferencedMaps.length} maps)</a>`;
    }
  } catch (err) {
    urlSpan.textContent = 'Error';
    console.error('Failed to generate Allmaps mosaic viewer URL:', err);
  }
}

// Copy Allmaps mosaic annotation JSON to clipboard
function copyAllmapsMosaicAnnotation(layerId) {
  const jsonStr = window._allmapsMosaicAnnotations?.[layerId];
  if (jsonStr) {
    navigator.clipboard.writeText(jsonStr).then(() => {
      alert('Annotation JSON copied! Paste it in Allmaps Viewer using the data input.');
    });
  }
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

// Expose functions for onclick handlers
window.toggleMetadata = toggleMetadata;
window.toggleMosaicMetadata = toggleMosaicMetadata;
window.generateMwViewerUrl = generateMwViewerUrl;
window.generateMosaicViewerUrl = generateMosaicViewerUrl;
window.generateAllmapsMosaicViewerUrl = generateAllmapsMosaicViewerUrl;
window.copyMapAnnotation = copyMapAnnotation;
window.copyMosaicAnnotation = copyMosaicAnnotation;
window.copyAllmapsMosaicAnnotation = copyAllmapsMosaicAnnotation;
window.copyToClipboard = copyToClipboard;
