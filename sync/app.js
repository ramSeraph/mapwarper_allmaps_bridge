/**
 * MapWarper ↔ Allmaps Sync
 * Compare and sync georeferencing data between MapWarper and Allmaps
 */

import { generateAnnotation } from 'https://esm.sh/@allmaps/annotation@1.0.0-beta.36';
import { CONFIG, getMapIiifUrl, copyToClipboard, getMwWarpUrl, getAllmapsEditorUrl, getAllmapsViewerUrl, getAllmapsAnnotationUrl, fetchMwGeoreferencingData, buildGeoreferencedMap, formatDate } from './common.js';

// URL params sync
function getUrlParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    tab: params.get('tab') || 'maps',
    page: parseInt(params.get('page')) || 1,
    q: params.get('q') || '',
    rectified: params.get('rectified') === 'true',
    mosaic: params.get('mosaic') || null,
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

function updateMosaicUrlParams(layerId) {
  const params = new URLSearchParams();
  params.set('mosaic', layerId);
  if (state.mosaicMapsPage > 1) params.set('page', state.mosaicMapsPage);
  if (state.mosaicMapsRectifiedOnly) params.set('rectified', 'true');
  if (state.mosaicMapsSearchQuery) params.set('q', state.mosaicMapsSearchQuery);
  
  const newUrl = `${window.location.pathname}?${params.toString()}`;
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
  mosaicMapsRectifiedOnly: false,
  mosaicMapsSearchQuery: '',
  mosaicMapsTotalCount: 0,
  mapsSearchQuery: '',
  mosaicsSearchQuery: '',
  mapsData: null,
  mosaicsData: null,
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
  loadingBar: document.getElementById('loading-bar'),
  rectifiedOnly: document.getElementById('rectified-only'),
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
    state.mosaicMapsPage = params.page;
    state.mosaicMapsRectifiedOnly = params.rectified;
    state.mosaicMapsSearchQuery = params.q;
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
  
  elements.clearSearchBtn.classList.toggle('hidden', !query);
  updateUrlParams();
  await loadCurrentTab();
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
  loadCurrentTab();
}

function loadCurrentTab() {
  return state.currentTab === 'maps' ? loadMaps() : loadMosaics();
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
  elements.clearSearchBtn.classList.toggle('hidden', !currentQuery);
  
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
  showLoadingBar();
  
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
    const layerResponse = await fetch(`${CONFIG.mapwarperBaseUrl}/api/v1/layers/${layerId}`);
    if (!layerResponse.ok) throw new Error('Failed to fetch mosaic');
    
    const layerData = await layerResponse.json();
    const layer = layerData.data;
    const attrs = layer.attributes;
    
    // Store total count for pagination
    state.mosaicMapsTotalCount = attrs.maps_count;
    
    // Get all map IDs for viewer links (from relationships)
    const allMapIds = layer.relationships?.maps?.data?.map(m => m.id) || [];
    
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
                  <button class="btn-link" onclick="generateMosaicViewerUrl('${layer.id}', '${allMapIds.join(',')}')">View MW in Allmaps</button>
                  <span id="mosaic-viewer-url-${layer.id}" class="generated-url"></span>
                  <button class="btn-link" onclick="generateMosaicViewerUrl('${layer.id}', '${allMapIds.join(',')}', 'allmaps')">View Allmaps in Allmaps</button>
                  <span id="allmaps-mosaic-viewer-url-${layer.id}" class="generated-url"></span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <hr style="margin:1.5rem 0;border:none;border-top:1px solid #ddd;">
      <h3 style="margin-bottom:1rem;">Maps in this Mosaic</h3>
      <div class="filters" style="margin-bottom:1rem;">
        <div class="search-box">
          <input type="text" id="mosaic-search-input" placeholder="Search maps..." value="${state.mosaicMapsSearchQuery}" autocomplete="off">
          <button id="mosaic-search-btn" class="btn btn-primary">🔍 Search</button>
          <button id="mosaic-clear-search-btn" class="btn btn-secondary ${state.mosaicMapsSearchQuery ? '' : 'hidden'}">✕ Clear</button>
        </div>
        <label>
          <input type="checkbox" id="mosaic-rectified-only" ${state.mosaicMapsRectifiedOnly ? 'checked' : ''}>
          Show only rectified maps
        </label>
      </div>
      <div id="mosaic-loading-bar" class="loading-bar hidden"></div>
      <div id="mosaic-maps-grid" class="cards-grid"></div>
      <div id="mosaic-maps-pagination" class="pagination"></div>
    `;
    
    // Add event listener for filter toggle
    document.getElementById('mosaic-rectified-only').addEventListener('change', (e) => {
      state.mosaicMapsRectifiedOnly = e.target.checked;
      state.mosaicMapsPage = 1;
      updateMosaicUrlParams(layerId);
      loadMosaicMaps(layerId, attrs.maps_count);
    });
    
    // Add event listeners for search
    const searchInput = document.getElementById('mosaic-search-input');
    const searchBtn = document.getElementById('mosaic-search-btn');
    const clearBtn = document.getElementById('mosaic-clear-search-btn');
    
    const performMosaicSearch = () => {
      state.mosaicMapsSearchQuery = searchInput.value.trim();
      state.mosaicMapsPage = 1;
      updateMosaicUrlParams(layerId);
      loadMosaicMaps(layerId, attrs.maps_count);
    };
    
    searchBtn.addEventListener('click', performMosaicSearch);
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') performMosaicSearch();
    });
    
    clearBtn.addEventListener('click', () => {
      state.mosaicMapsSearchQuery = '';
      state.mosaicMapsPage = 1;
      searchInput.value = '';
      clearBtn.classList.add('hidden');
      updateMosaicUrlParams(layerId);
      loadMosaicMaps(layerId, attrs.maps_count);
    });
    
    hideLoadingBar();
    
    // Load mosaic maps
    await loadMosaicMaps(layerId, attrs.maps_count);
    
  } catch (error) {
    console.error('Error loading mosaic detail:', error);
    detailContainer.innerHTML = `<p class="error">Error loading mosaic: ${error.message}</p>`;
    hideLoadingBar();
  }
}

async function loadMosaicMaps(layerId, totalMapsCount) {
  const loadingBar = document.getElementById('mosaic-loading-bar');
  const mapsGrid = document.getElementById('mosaic-maps-grid');
  const paginationContainer = document.getElementById('mosaic-maps-pagination');
  const clearBtn = document.getElementById('mosaic-clear-search-btn');
  
  loadingBar.classList.remove('hidden');
  
  try {
    let mapsUrl = `${CONFIG.mapwarperBaseUrl}/api/v1/layers/${layerId}/maps?per_page=${CONFIG.perPage}&page=${state.mosaicMapsPage}`;
    if (state.mosaicMapsRectifiedOnly) mapsUrl += '&show_warped=1';
    if (state.mosaicMapsSearchQuery) mapsUrl += `&query=${encodeURIComponent(state.mosaicMapsSearchQuery)}`;
    
    const mapsResponse = await fetch(mapsUrl);
    if (!mapsResponse.ok) throw new Error('Failed to fetch mosaic maps');
    
    const mapsData = await mapsResponse.json();
    const maps = mapsData.data || [];
    const meta = mapsData.meta || {};
    
    // Update heading
    const heading = document.querySelector('#mosaic-detail h3');
    if (heading) {
      heading.textContent = `Maps in this Mosaic (${meta.total_entries || 0}${state.mosaicMapsRectifiedOnly || state.mosaicMapsSearchQuery ? ' matching' : ''} of ${totalMapsCount} total)`;
    }
    
    // Show/hide clear button
    if (state.mosaicMapsSearchQuery) {
      clearBtn.classList.remove('hidden');
    } else {
      clearBtn.classList.add('hidden');
    }
    
    // Render map cards
    mapsGrid.innerHTML = maps.map(map => renderMapCard(map)).join('');
    
    // Render pagination
    renderMosaicMapsPagination(paginationContainer, meta, layerId);
    
  } catch (error) {
    console.error('Error loading mosaic maps:', error);
    mapsGrid.innerHTML = `<p class="error">Error loading maps: ${error.message}</p>`;
  }
  
  loadingBar.classList.add('hidden');
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
  updateMosaicUrlParams(layerId);
  loadMosaicMaps(layerId, state.mosaicMapsTotalCount);
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
  const iiifUrl = getMapIiifUrl(map.id);
  const editorAllmapsUrl = `editor.html?map=${map.id}&mode=allmaps`;
  const editorMapwarperUrl = `editor.html?map=${map.id}&mode=mapwarper`;
  const shareUrl = `${window.location.origin}${window.location.pathname}?q=${map.id}`;
  
  // Links
  const mwWarpUrl = getMwWarpUrl(map.id);
  const allmapsEditorUrl = getAllmapsEditorUrl(iiifUrl);
  const allmapsViewerUrl = getAllmapsViewerUrl(iiifUrl);
  
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
              <a href="compare.html?map=${map.id}" target="_blank">Compare</a>
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
  const meta = data.meta || {};
  const total = meta.total_entries || 0;
  
  // Update title
  const titleEl = document.getElementById('maps-title');
  if (state.mapsSearchQuery || state.mapsRectifiedOnly) {
    titleEl.textContent = `${total} map${total !== 1 ? 's' : ''} found`;
  } else {
    titleEl.textContent = `${total} map${total !== 1 ? 's' : ''}`;
  }
  
  elements.mapsGrid.innerHTML = maps.map(map => renderMapCard(map)).join('');
  renderPagination(elements.mapsPagination, data.meta, 'maps');
}

function renderMosaics(data) {
  const layers = data.data || [];
  const meta = data.meta || {};
  const total = meta.total_entries || 0;
  
  // Update title
  const titleEl = document.getElementById('mosaics-title');
  if (state.mosaicsSearchQuery) {
    titleEl.textContent = `${total} mosaic${total !== 1 ? 's' : ''} found`;
  } else {
    titleEl.textContent = `${total} mosaic${total !== 1 ? 's' : ''}`;
  }
  
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
          <button class="card-metadata-toggle" onclick="toggleMetadata('${layer.id}', 'mosaic')">
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

// Navigation
function goToPage(page, type) {
  if (type === 'maps') {
    state.mapsPage = page;
  } else {
    state.mosaicsPage = page;
  }
  updateUrlParams();
  loadCurrentTab();
}

// Helpers
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
    const data = await fetchMwGeoreferencingData(mapId);
    
    if (data.gcps.length === 0) {
      urlSpan.textContent = 'No GCPs';
      return;
    }
    
    const georeferencedMap = buildGeoreferencedMap(data.iiifUrl, data.iiifInfo, data.gcps, data.maskCoords);
    const annotation = generateAnnotation(georeferencedMap);
    const jsonStr = JSON.stringify(annotation, null, 0);
    const { html } = generateViewerLinkHtml(jsonStr);
    urlSpan.innerHTML = html;
  } catch (err) {
    urlSpan.textContent = 'Error';
    console.error('Failed to generate MW viewer URL:', err);
  }
}

// Generate viewer link HTML from annotation JSON
function generateViewerLinkHtml(jsonStr, label = 'Open ↗') {
  const viewerUrl = `https://viewer.allmaps.org/#data=${encodeURIComponent(jsonStr)}`;
  return { html: `<a href="${viewerUrl}" target="_blank">${label}</a>`, viewerUrl, jsonStr };
}

// Generate mosaic viewer URL by fetching data for all maps
// source: 'mw' for MapWarper GCPs, 'allmaps' for Allmaps annotations
async function generateMosaicViewerUrl(layerId, mapIdsStr, source = 'mw') {
  const spanId = source === 'allmaps' ? `allmaps-mosaic-viewer-url-${layerId}` : `mosaic-viewer-url-${layerId}`;
  const urlSpan = document.getElementById(spanId);
  urlSpan.textContent = 'Loading...';
  
  const mapIds = mapIdsStr.split(',').filter(id => id);
  const chunkSize = 20;
  
  try {
    // Helper to fetch data for a single map
    const fetchMapData = source === 'allmaps' 
      ? async (mapId) => {
          const iiifUrl = getMapIiifUrl(mapId);
          const annotationUrl = getAllmapsAnnotationUrl(iiifUrl);
          try {
            const res = await fetch(annotationUrl);
            if (!res.ok) return null;
            const annotation = await res.json();
            const { parseAnnotation } = await import('https://esm.sh/@allmaps/annotation@1.0.0-beta.36');
            const maps = parseAnnotation(annotation);
            return Array.isArray(maps) ? maps : [maps];
          } catch { return null; }
        }
      : async (mapId) => {
          try {
            const data = await fetchMwGeoreferencingData(mapId);
            if (data.gcps.length === 0) return null;
            return [buildGeoreferencedMap(data.iiifUrl, data.iiifInfo, data.gcps, data.maskCoords)];
          } catch { return null; }
        };
    
    // Process in chunks
    const georeferencedMaps = [];
    for (let i = 0; i < mapIds.length; i += chunkSize) {
      const chunk = mapIds.slice(i, i + chunkSize);
      urlSpan.textContent = `Loading... (${i}/${mapIds.length})`;
      const chunkResults = await Promise.all(chunk.map(fetchMapData));
      for (const maps of chunkResults) {
        if (maps) georeferencedMaps.push(...maps);
      }
    }
    
    if (georeferencedMaps.length === 0) {
      urlSpan.textContent = source === 'allmaps' ? 'No annotations' : 'No GCPs';
      return;
    }
    
    const annotation = generateAnnotation(georeferencedMaps);
    const jsonStr = JSON.stringify(annotation, null, 0);
    const { html } = generateViewerLinkHtml(jsonStr, `Open ↗ (${georeferencedMaps.length} maps)`);
    urlSpan.innerHTML = html;
  } catch (err) {
    urlSpan.textContent = 'Error';
    console.error(`Failed to generate ${source} mosaic viewer URL:`, err);
  }
}

// Toggle metadata and load if first time
async function toggleMetadata(id, type = 'map') {
  const prefix = type === 'mosaic' ? 'mosaic-metadata' : 'metadata';
  const content = document.getElementById(`${prefix}-${id}`);
  const arrow = document.getElementById(`${prefix}-arrow-${id}`);
  
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
      const endpoint = type === 'mosaic' ? 'layers' : 'maps';
      const response = await fetch(`${CONFIG.mapwarperBaseUrl}/api/v1/${endpoint}/${id}`);
      if (!response.ok) throw new Error('Failed to fetch');
      const data = await response.json();
      const attrs = data.data.attributes;
      
      content.innerHTML = `
        <div style="display:grid;grid-template-columns:auto 1fr;gap:0.25rem 0.5rem;">
          <strong>Created:</strong><span>${formatDate(attrs.created_at)}</span>
          <strong>Updated:</strong><span>${formatDate(attrs.updated_at)}</span>
          ${attrs.description ? `<strong>Description:</strong><span>${attrs.description}</span>` : ''}
          ${type === 'map' && attrs.source_uri ? `<strong>Source:</strong><span><a href="${attrs.source_uri}" target="_blank">${attrs.source_uri}</a></span>` : ''}
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
window.generateMwViewerUrl = generateMwViewerUrl;
window.generateMosaicViewerUrl = generateMosaicViewerUrl;
window.copyToClipboard = copyToClipboard;
window.goToPage = goToPage;
window.goToMosaicMapsPage = goToMosaicMapsPage;
