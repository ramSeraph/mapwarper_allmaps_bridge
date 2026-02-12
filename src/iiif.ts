/**
 * IIIF Image Request Handler
 * Translates IIIF Image API 3.0 parameters to MapWarper WMS requests
 */

import { MapWarperClient } from "./mapwarper.js";
import { MapInfo, LayerInfo, MapNotFoundError, LayerNotFoundError, GCP } from "./types.js";

// Hardcoded MapWarper base URL
const client = new MapWarperClient("https://mapwarper.net");

// Map cache to avoid repeated API calls
const mapCache = new Map<string, MapInfo>();
const layerCache = new Map<string, LayerInfo>();

export interface IIIFImageParams {
  identifier: string;
  region: string;
  size: string;
  rotation: string;
  quality: string;
  format: string;
}

export interface ParsedRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ParsedSize {
  width: number | null;
  height: number | null;
  upscale: boolean;
}

/**
 * Get map info with caching
 */
async function getMapInfo(id: string): Promise<MapInfo> {
  const cached = mapCache.get(id);
  if (cached) return cached;
  
  const info = await client.getMap(id);
  mapCache.set(id, info);
  return info;
}

/**
 * Parse IIIF region parameter
 */
function parseRegion(region: string, imageWidth: number, imageHeight: number): ParsedRegion {
  if (region === "full") {
    return { x: 0, y: 0, width: imageWidth, height: imageHeight };
  }
  
  if (region === "square") {
    const size = Math.min(imageWidth, imageHeight);
    const x = Math.floor((imageWidth - size) / 2);
    const y = Math.floor((imageHeight - size) / 2);
    return { x, y, width: size, height: size };
  }
  
  if (region.startsWith("pct:")) {
    const [pctX, pctY, pctW, pctH] = region.slice(4).split(",").map(Number);
    return {
      x: Math.round(imageWidth * pctX / 100),
      y: Math.round(imageHeight * pctY / 100),
      width: Math.round(imageWidth * pctW / 100),
      height: Math.round(imageHeight * pctH / 100),
    };
  }
  
  // Absolute pixel values: x,y,w,h
  const [x, y, width, height] = region.split(",").map(Number);
  return { x, y, width, height };
}

/**
 * Parse IIIF size parameter
 */
function parseSize(size: string, regionWidth: number, regionHeight: number): { width: number; height: number } {
  if (size === "max" || size === "full") {
    return { width: regionWidth, height: regionHeight };
  }
  
  // ^w,h or w,h - explicit dimensions
  const upscale = size.startsWith("^");
  const sizeStr = upscale ? size.slice(1) : size;
  
  if (sizeStr.startsWith("pct:")) {
    const pct = parseFloat(sizeStr.slice(4));
    return {
      width: Math.round(regionWidth * pct / 100),
      height: Math.round(regionHeight * pct / 100),
    };
  }
  
  if (sizeStr.startsWith("!")) {
    // !w,h - best fit within dimensions
    const [maxW, maxH] = sizeStr.slice(1).split(",").map(Number);
    const aspectRatio = regionWidth / regionHeight;
    const targetRatio = maxW / maxH;
    
    if (aspectRatio > targetRatio) {
      return { width: maxW, height: Math.round(maxW / aspectRatio) };
    } else {
      return { width: Math.round(maxH * aspectRatio), height: maxH };
    }
  }
  
  const parts = sizeStr.split(",");
  const w = parts[0] ? parseInt(parts[0], 10) : null;
  const h = parts[1] ? parseInt(parts[1], 10) : null;
  
  if (w && h) {
    return { width: w, height: h };
  } else if (w) {
    // w, - width only, maintain aspect ratio
    return { width: w, height: Math.round(w * regionHeight / regionWidth) };
  } else if (h) {
    // ,h - height only, maintain aspect ratio
    return { width: Math.round(h * regionWidth / regionHeight), height: h };
  }
  
  return { width: regionWidth, height: regionHeight };
}

/**
 * Get MIME type for format
 */
function getMimeType(format: string): string {
  const mimeTypes: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    tif: "image/tiff",
    tiff: "image/tiff",
  };
  return mimeTypes[format.toLowerCase()] || "image/png";
}

/**
 * Process IIIF image request and return image buffer
 */
export async function processImageRequest(params: IIIFImageParams): Promise<{
  buffer: ArrayBuffer;
  contentType: string;
  cacheControl?: string;
}> {
  const mapInfo = await getMapInfo(params.identifier);
  
  // Parse region
  const region = parseRegion(params.region, mapInfo.width, mapInfo.height);
  
  // Parse size
  const size = parseSize(params.size, region.width, region.height);
  
  // Build WMS URL with Y-axis flip
  const wmsUrl = client.buildWmsUrl(
    params.identifier,
    region,
    size.width,
    size.height,
    getMimeType(params.format),
    mapInfo.height  // Pass image height for Y-axis conversion
  );
  
  // Fetch from WMS
  const response = await fetch(wmsUrl);
  
  if (!response.ok) {
    throw new Error(`WMS request failed: ${response.status} ${response.statusText}`);
  }
  
  const buffer = await response.arrayBuffer();
  
  // Pass through cache headers from MapWarper
  const cacheControl = response.headers.get("Cache-Control");
  
  return {
    buffer,
    contentType: getMimeType(params.format),
    cacheControl: cacheControl || undefined,
  };
}

/**
 * Get map info for info.json generation
 */
export async function getMapInfoForIIIF(identifier: string): Promise<MapInfo> {
  return getMapInfo(identifier);
}

/**
 * Get layer info for mosaic manifest generation
 */
export async function getLayerInfo(identifier: string, skipCache = false): Promise<LayerInfo> {
  if (!skipCache && layerCache.has(identifier)) {
    return layerCache.get(identifier)!;
  }
  const layerInfo = await client.getLayer(identifier);
  layerCache.set(identifier, layerInfo);
  return layerInfo;
}

/**
 * Get GCPs for a map
 */
export async function getMapGCPs(identifier: string): Promise<GCP[]> {
  return client.getGCPs(identifier);
}

/**
 * Get mask coordinates for a map
 */
export async function getMapMask(identifier: string): Promise<number[][] | null> {
  return client.getMask(identifier);
}

export { MapNotFoundError, LayerNotFoundError };
