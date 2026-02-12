/**
 * Shared utilities for MapWarper ↔ Allmaps Sync
 */

export const CONFIG = {
  mapwarperBaseUrl: 'https://mapwarper.net',
  allmapsAnnotationsUrl: 'https://annotations.allmaps.org',
  perPage: 20,
};

// Generate IIIF URL for a map
export function getMapIiifUrl(mapId) {
  return `${window.location.origin}/mapwarper/maps/${mapId}/iiif`;
}

// Parse GCPs from Allmaps annotation
export function parseAllmapsGcps(annotation) {
  let gcps = [];
  try {
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
    } else if (annotation.body?.features) {
      gcps = annotation.body.features.map(f => ({
        x: f.properties?.resourceCoords?.[0],
        y: f.properties?.resourceCoords?.[1],
        lon: f.geometry?.coordinates?.[0],
        lat: f.geometry?.coordinates?.[1],
      }));
    }
  } catch (e) {
    console.error('Error parsing Allmaps GCPs:', e);
  }
  return gcps.filter(g => g.x != null && g.y != null && g.lon != null && g.lat != null);
}

// Parse mask from Allmaps annotation (SVG polygon format)
export function parseAllmapsMask(annotation) {
  try {
    let svgValue = null;
    if (annotation.type === 'AnnotationPage' && annotation.items?.[0]) {
      svgValue = annotation.items[0].target?.selector?.value;
    } else if (annotation.target?.selector?.value) {
      svgValue = annotation.target.selector.value;
    }
    
    if (svgValue) {
      // Parse SVG polygon points: <svg...><polygon points="x1,y1 x2,y2 ..." /></svg>
      const match = svgValue.match(/points="([^"]+)"/);
      if (match) {
        const points = match[1].split(' ').map(p => {
          const [x, y] = p.split(',').map(Number);
          return [x, y];
        });
        if (points.length >= 3) {
          return points;
        }
      }
    }
  } catch (e) {
    console.error('Error parsing Allmaps mask:', e);
  }
  return null;
}

// Compare GCPs between MapWarper and Allmaps
export function compareGcps(mwGcps, allmapsGcps) {
  if (mwGcps.length !== allmapsGcps.length) return false;
  if (mwGcps.length === 0) return true;
  
  const tolerance = 0.5;
  const sortedMw = [...mwGcps].sort((a, b) => {
    const ax = a.attributes?.x ?? a.x;
    const bx = b.attributes?.x ?? b.x;
    return ax - bx;
  });
  const sortedAm = [...allmapsGcps].sort((a, b) => a.x - b.x);
  
  for (let i = 0; i < sortedMw.length; i++) {
    const mw = sortedMw[i];
    const am = sortedAm[i];
    const mwX = mw.attributes?.x ?? mw.x;
    const mwY = mw.attributes?.y ?? mw.y;
    const mwLon = parseFloat(mw.attributes?.lon ?? mw.lon);
    const mwLat = parseFloat(mw.attributes?.lat ?? mw.lat);
    
    if (Math.abs(mwX - am.x) > tolerance ||
        Math.abs(mwY - am.y) > tolerance ||
        Math.abs(mwLon - am.lon) > 0.00001 ||
        Math.abs(mwLat - am.lat) > 0.00001) {
      return false;
    }
  }
  return true;
}

// Compare masks between MapWarper and Allmaps
export function compareMasks(mwMask, allmapsMask, imageHeight) {
  if (!allmapsMask) return !mwMask || mwMask.length < 3;
  if (!mwMask || mwMask.length < 3) return false;
  if (mwMask.length !== allmapsMask.length) return false;
  
  // Convert MW mask to Allmaps coordinate system (flip Y)
  const mwConverted = mwMask.map(([x, y]) => [x, imageHeight - y]);
  
  const tolerance = 1;
  for (let i = 0; i < mwConverted.length; i++) {
    const mw = mwConverted[i];
    const am = allmapsMask[i];
    if (Math.abs(mw[0] - am[0]) > tolerance || Math.abs(mw[1] - am[1]) > tolerance) {
      return false;
    }
  }
  return true;
}

// Copy text to clipboard with feedback
export function copyToClipboard(text, successMsg = 'Copied to clipboard!') {
  return navigator.clipboard.writeText(text)
    .then(() => alert(successMsg))
    .catch(err => alert('Failed to copy: ' + err));
}

// Escape HTML special characters
export function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
