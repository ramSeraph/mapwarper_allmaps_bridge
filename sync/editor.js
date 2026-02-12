/**
 * Editor page for MapWarper ↔ Allmaps sync
 */

import { CONFIG, getMapIiifUrl, parseAllmapsGcps, parseAllmapsMask, compareGcps, compareMasks, getMwWarpUrl, getAllmapsEditorUrl, copyToClipboard, formatGcpsCsv, getAllmapsAnnotationUrl, fetchAllmapsAnnotation } from './common.js';

const params = new URLSearchParams(window.location.search);
const mapId = params.get('map');
const mode = params.get('mode') || 'allmaps';
const contentEl = document.getElementById('content');
const controlsEl = document.getElementById('copy-controls');
const headerEl = document.getElementById('header');
const titleEl = document.getElementById('title');
const syncStatusEl = document.getElementById('sync-status');
const compareLinkEl = document.getElementById('compare-link');

// Set up header based on mode
headerEl.classList.add(mode);
titleEl.textContent = mode === 'mapwarper' ? '📝 Sync to MapWarper' : '📝 Sync to Allmaps';
document.title = mode === 'mapwarper' ? 'Sync to MapWarper' : 'Sync to Allmaps';

if (!mapId) {
  contentEl.innerHTML = '<div class="error">Missing map ID.<br><br>Usage: ?map={mapId}&mode=allmaps|mapwarper</div>';
  compareLinkEl.style.display = 'none';
} else {
  compareLinkEl.href = `compare.html?map=${mapId}`;
  contentEl.innerHTML = '<div class="loading">Loading map data...</div>';
  loadMapData(mapId, mode);
}

async function refreshStatus() {
  syncStatusEl.textContent = 'Checking...';
  syncStatusEl.className = '';
  
  try {
    const iiifUrl = getMapIiifUrl(mapId);
    const data = await fetchSyncData(mapId, iiifUrl);
    updateStatusAndControls(data, mode, false);
  } catch (error) {
    syncStatusEl.textContent = 'Error checking status';
    syncStatusEl.className = '';
  }
}

async function fetchSyncData(mapId, iiifUrl) {
  const [iiifInfo, gcpsResponse, maskCoords, allmapsAnnotation] = await Promise.all([
    fetch(`${iiifUrl}/info.json`).then(r => r.json()),
    fetch(`${CONFIG.mapwarperBaseUrl}/api/v1/maps/${mapId}/gcps`).then(r => r.json()),
    fetch(`${window.location.origin}/mapwarper/maps/${mapId}/iiif/mask.json`)
      .then(r => r.ok ? r.json() : null)
      .then(d => d?.coords || null)
      .catch(() => null),
    fetchAllmapsAnnotation(mapId),
  ]);
  
  const mwGcps = gcpsResponse.data || [];
  const allmapsGcps = allmapsAnnotation ? parseAllmapsGcps(allmapsAnnotation) : [];
  const allmapsMask = allmapsAnnotation ? parseAllmapsMask(allmapsAnnotation) : null;
  
  const gcpsMatch = compareGcps(mwGcps, allmapsGcps);
  const hasMwMask = maskCoords && maskCoords.length >= 3;
  const effectiveMwMask = maskCoords || [[0, 0], [iiifInfo.width, 0], [iiifInfo.width, iiifInfo.height], [0, iiifInfo.height]];
  const masksMatch = compareMasks(effectiveMwMask, allmapsMask);
  
  return { iiifInfo, mwGcps, allmapsGcps, maskCoords, gcpsMatch, masksMatch, hasMwMask, iiifUrl };
}

function updateStatusAndControls(data, mode, updateContent = true) {
  const { iiifInfo, mwGcps, allmapsGcps, maskCoords, gcpsMatch, masksMatch, hasMwMask, iiifUrl } = data;
  
  if (mode === 'allmaps') {
    updateSyncStatus(mwGcps.length, allmapsGcps.length, gcpsMatch, masksMatch, hasMwMask);
    updateAllmapsControls(mwGcps, maskCoords, gcpsMatch, masksMatch);
    if (updateContent) {
      const editorUrl = getAllmapsEditorUrl(iiifUrl);
      contentEl.innerHTML = `<iframe class="editor-frame" src="${editorUrl}" allow="fullscreen"></iframe>`;
    }
  } else {
    updateMapwarperSyncStatus(allmapsGcps.length, gcpsMatch);
    updateMapwarperControls(allmapsGcps, gcpsMatch);
    if (updateContent) {
      const editorUrl = getMwWarpUrl(mapId);
      contentEl.innerHTML = `
        <div class="center-content">
          <p style="color:#666;margin-bottom:0.5rem;">MapWarper cannot be embedded due to security restrictions.</p>
          <a href="${editorUrl}" target="_blank" class="big-link">Open MapWarper Warp Editor ↗</a>
          ${allmapsGcps.length > 0 && !gcpsMatch ? '<p style="color:#888;font-size:0.85rem;margin-top:1.5rem;">Download the CSV above and import it into MapWarper.</p>' : ''}
        </div>
      `;
    }
  }
}

function updateAllmapsControls(mwGcps, maskCoords, gcpsMatch, masksMatch) {
  let controls = '';
  
  if (mwGcps.length > 0 && !gcpsMatch) {
    const gcpsText = mwGcps.map(g => `${g.attributes.x} ${g.attributes.y} ${g.attributes.lon} ${g.attributes.lat}`).join('\n');
    controls += `
      <div class="copy-section expandable">
        <label>MW GCPs:</label>
        <span class="count">${mwGcps.length}</span>
        <button class="btn btn-copy" onclick="copyText('gcps-data')">📋 Copy</button>
        <button class="btn btn-show" onclick="toggleExpand(this)">Show</button>
        <div class="expandable-content">
          <textarea id="gcps-data" class="nowrap" readonly>${gcpsText}</textarea>
        </div>
      </div>
    `;
  }
  
  if (maskCoords && maskCoords.length >= 3 && !masksMatch) {
    // Mask coords are already in IIIF format (Y=0 at top)
    const clipText = maskCoords.map(([x, y]) => `${x},${y}`).join('\n');
    controls += `
      <div class="copy-section expandable">
        <label>MW Clip:</label>
        <span class="count">${maskCoords.length} pts</span>
        <button class="btn btn-copy" onclick="copyText('mask-data')">📋 Copy</button>
        <button class="btn btn-show" onclick="toggleExpand(this)">Show</button>
        <div class="expandable-content">
          <textarea id="mask-data" class="nowrap" readonly>${clipText}</textarea>
        </div>
      </div>
    `;
  }
  
  controlsEl.innerHTML = controls;
}

function updateMapwarperSyncStatus(allmapsGcpCount, gcpsMatch) {
  if (allmapsGcpCount === 0) {
    syncStatusEl.textContent = 'No Allmaps GCPs to sync';
    syncStatusEl.className = '';
  } else if (gcpsMatch) {
    syncStatusEl.textContent = '✓ GCPs already synced';
    syncStatusEl.className = 'synced';
  } else {
    syncStatusEl.textContent = 'GCPs need update';
    syncStatusEl.className = 'needs-update';
  }
}

function updateMapwarperControls(allmapsGcps, gcpsMatch) {
  let controls = '';
  
  if (allmapsGcps.length > 0 && !gcpsMatch) {
    window.allmapsGcpsData = allmapsGcps;
    const gcpsText = formatGcpsCsv(allmapsGcps);
    controls += `
      <div class="copy-section expandable">
        <label>Allmaps GCPs:</label>
        <span class="count">${allmapsGcps.length}</span>
        <button class="btn btn-download" onclick="downloadCsv('${mapId}')">⬇️ Download CSV</button>
        <button class="btn btn-copy" onclick="copyText('allmaps-gcps-data')">📋 Copy</button>
        <button class="btn btn-show" onclick="toggleExpand(this)">Show</button>
        <div class="expandable-content">
          <textarea id="allmaps-gcps-data" class="nowrap" readonly>${gcpsText}</textarea>
        </div>
      </div>
    `;
  }
  
  controlsEl.innerHTML = controls;
}

async function loadMapData(mapId, mode) {
  try {
    const iiifUrl = getMapIiifUrl(mapId);
    const data = await fetchSyncData(mapId, iiifUrl);
    updateStatusAndControls(data, mode, true);
  } catch (error) {
    contentEl.innerHTML = `<div class="error">Error loading map data: ${error.message}</div>`;
  }
}

function updateSyncStatus(mwGcpCount, allmapsGcpCount, gcpsMatch, masksMatch, hasMwMask) {
  if (mwGcpCount === 0) {
    syncStatusEl.textContent = 'No MW GCPs to sync';
    syncStatusEl.className = '';
    return;
  }
  
  if (allmapsGcpCount === 0) {
    syncStatusEl.textContent = hasMwMask ? 'GCPs & Clip need to be added' : 'GCPs need to be added';
    syncStatusEl.className = 'needs-update';
    return;
  }
  
  if (gcpsMatch && masksMatch) {
    syncStatusEl.textContent = '✓ All synced';
    syncStatusEl.className = 'synced';
  } else if (!gcpsMatch && !masksMatch && hasMwMask) {
    syncStatusEl.textContent = 'GCPs & Clip need update';
    syncStatusEl.className = 'needs-update';
  } else if (!gcpsMatch) {
    syncStatusEl.textContent = 'GCPs need update';
    syncStatusEl.className = 'needs-update';
  } else if (!masksMatch && hasMwMask) {
    syncStatusEl.textContent = 'Clip needs update';
    syncStatusEl.className = 'needs-update';
  } else {
    syncStatusEl.textContent = '✓ All synced';
    syncStatusEl.className = 'synced';
  }
}

function downloadCsv(mapId) {
  const gcps = window.allmapsGcpsData || [];
  if (gcps.length === 0) {
    alert('No GCPs to download');
    return;
  }
  
  const csv = formatGcpsCsv(gcps);
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `allmaps-gcps-${mapId}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function toggleExpand(btn) {
  const content = btn.parentElement.querySelector('.expandable-content');
  const isShown = content.classList.toggle('show');
  btn.textContent = isShown ? 'Hide' : 'Show';
  
  document.querySelectorAll('.expandable-content.show').forEach(el => {
    if (el !== content) {
      el.classList.remove('show');
      el.parentElement.querySelector('.btn-show').textContent = 'Show';
    }
  });
}

function copyText(id) {
  const textarea = document.getElementById(id);
  const btn = textarea.parentElement.parentElement.querySelector('.btn-copy');
  const orig = btn.textContent;
  
  navigator.clipboard.writeText(textarea.value)
    .then(() => {
      btn.textContent = '✓ Copied!';
      setTimeout(() => btn.textContent = orig, 1500);
    })
    .catch(err => alert('Failed to copy: ' + err));
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.expandable')) {
    document.querySelectorAll('.expandable-content.show').forEach(el => {
      el.classList.remove('show');
      el.parentElement.querySelector('.btn-show').textContent = 'Show';
    });
  }
});

// Expose functions for onclick handlers
window.refreshStatus = refreshStatus;
window.downloadCsv = downloadCsv;
window.toggleExpand = toggleExpand;
window.copyText = copyText;
