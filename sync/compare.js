/**
 * Compare page - side by side comparison of MapWarper and Allmaps georeferencing
 */

import { CONFIG, getMapIiifUrl, fetchMwGeoreferencingData, buildGeoreferencedMap, fetchAllmapsAnnotation } from './common.js';
import { generateAnnotation } from 'https://esm.sh/@allmaps/annotation@1.0.0-beta.36';
import { WarpedMapLayer } from 'https://esm.sh/@allmaps/maplibre@1.0.0-beta.36';

const statusEl = document.getElementById('status');
const compareWrapper = document.getElementById('compare-wrapper');
const pageTitleEl = document.getElementById('page-title');
const pageMetaEl = document.getElementById('page-meta');

// Get map ID from URL
const params = new URLSearchParams(window.location.search);
const mapId = params.get('map');

if (!mapId) {
  showError('No map ID provided. Add ?map=12345 to the URL.');
} else {
  initComparison(mapId);
}

function showError(message) {
  statusEl.textContent = message;
  statusEl.classList.add('error');
}

function showStatus(message) {
  statusEl.textContent = message;
  statusEl.classList.remove('error');
}

async function initComparison(mapId) {
  showStatus('Loading map data...');
  
  try {
    // Fetch map info for title
    const mapInfoRes = await fetch(`${CONFIG.mapwarperBaseUrl}/api/v1/maps/${mapId}`);
    if (!mapInfoRes.ok) {
      showError(`Map ${mapId} not found on MapWarper.`);
      return;
    }
    const mapInfo = await mapInfoRes.json();
    const mapTitle = mapInfo.data?.attributes?.title || `Map ${mapId}`;
    pageTitleEl.textContent = `Compare: ${mapTitle}`;
    pageMetaEl.textContent = `Map ID: ${mapId}`;
    
    // Fetch both georeferencing sources
    const [mwData, allmapsAnnotation] = await Promise.all([
      fetchMwGeoreferencingData(mapId).catch(() => null),
      fetchAllmapsAnnotation(mapId)
    ]);
    
    const hasMwGeoreferencing = mwData && mwData.gcps.length > 0;
    const hasAllmapsGeoreferencing = allmapsAnnotation && 
      ((allmapsAnnotation.items && allmapsAnnotation.items.length > 0) || 
       allmapsAnnotation.body?.features?.length > 0);
    
    if (!hasMwGeoreferencing && !hasAllmapsGeoreferencing) {
      showError('Neither MapWarper nor Allmaps has georeferencing for this map.');
      return;
    }
    
    if (!hasMwGeoreferencing) {
      showError('MapWarper has no georeferencing (no GCPs). Cannot compare.');
      return;
    }
    
    if (!hasAllmapsGeoreferencing) {
      showError('Allmaps has no georeferencing for this map. Cannot compare.');
      return;
    }
    
    showStatus('Generating annotations...');
    
    // Generate MapWarper annotation
    const { iiifUrl, iiifInfo, gcps, maskCoords } = mwData;
    const mwGeoreferencedMap = buildGeoreferencedMap(iiifUrl, iiifInfo, gcps, maskCoords);
    const mwAnnotation = generateAnnotation(mwGeoreferencedMap);
    
    showStatus('Initializing maps...');
    
    // Calculate center from GCPs
    const allLons = gcps.map(g => parseFloat(g.attributes.lon));
    const allLats = gcps.map(g => parseFloat(g.attributes.lat));
    const centerLon = allLons.reduce((a, b) => a + b, 0) / allLons.length;
    const centerLat = allLats.reduce((a, b) => a + b, 0) / allLats.length;
    
    // Show the compare container
    statusEl.style.display = 'none';
    compareWrapper.style.display = 'block';
    
    // Create the two maps
    const baseStyle = {
      version: 8,
      sources: {
        osm: {
          type: 'raster',
          tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
          attribution: '© OpenStreetMap contributors'
        }
      },
      layers: [{
        id: 'osm',
        type: 'raster',
        source: 'osm'
      }]
    };
    
    const beforeMap = new maplibregl.Map({
      container: 'before',
      style: baseStyle,
      center: [centerLon, centerLat],
      zoom: 12,
      maxPitch: 0
    });
    
    const afterMap = new maplibregl.Map({
      container: 'after',
      style: baseStyle,
      center: [centerLon, centerLat],
      zoom: 12,
      maxPitch: 0
    });
    
    // Wait for both maps to load
    await Promise.all([
      new Promise(resolve => beforeMap.on('load', resolve)),
      new Promise(resolve => afterMap.on('load', resolve))
    ]);
    
    // Add WarpedMapLayer for MapWarper annotation
    const mwWarpedLayer = new WarpedMapLayer();
    beforeMap.addLayer(mwWarpedLayer);
    await mwWarpedLayer.addGeoreferenceAnnotation(mwAnnotation);
    
    // Add WarpedMapLayer for Allmaps annotation
    const allmapsWarpedLayer = new WarpedMapLayer();
    afterMap.addLayer(allmapsWarpedLayer);
    await allmapsWarpedLayer.addGeoreferenceAnnotation(allmapsAnnotation);
    
    // Initialize the compare control
    new maplibregl.Compare(beforeMap, afterMap, '#comparison-container', {
      mousemove: false
    });
    
  } catch (err) {
    console.error('Comparison error:', err);
    showError(`Error: ${err.message}`);
  }
}
