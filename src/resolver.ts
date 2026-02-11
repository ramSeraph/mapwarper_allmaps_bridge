/**
 * Stream resolver for iiif-processor
 * Fetches source images from MapWarper WMS endpoint
 * 
 * Note: This resolver requests the full image scaled down to a reasonable size.
 * For very large maps, this may still be slow. The iiif-processor then
 * extracts regions and applies transformations.
 */

import { Readable } from "stream";
import { MapWarperClient } from "./mapwarper.js";

// Hardcoded MapWarper base URL
const client = new MapWarperClient("https://mapwarper.net");

// Maximum dimension to request from WMS to avoid server errors
const MAX_WMS_DIMENSION = 4096;

interface ResolverParams {
  id: string;
  baseUrl: string;
}

/**
 * Stream resolver that fetches unwarped image from MapWarper WMS
 * Scales down if the image is too large for the WMS server
 */
export async function streamResolver({ id }: ResolverParams): Promise<Readable> {
  const mapInfo = await client.getMap(id);
  
  // Calculate output size - scale down if too large
  let outputWidth = mapInfo.width;
  let outputHeight = mapInfo.height;
  
  const maxDim = Math.max(outputWidth, outputHeight);
  if (maxDim > MAX_WMS_DIMENSION) {
    const scale = MAX_WMS_DIMENSION / maxDim;
    outputWidth = Math.round(outputWidth * scale);
    outputHeight = Math.round(outputHeight * scale);
  }
  
  // Request full image from WMS (no Y-flip needed for full image)
  const wmsUrl = client.buildWmsUrl(
    id,
    { x: 0, y: 0, width: mapInfo.width, height: mapInfo.height },
    outputWidth,
    outputHeight,
    "image/png",
    0  // Pass 0 for full image (no Y-axis flip needed)
  );

  const response = await fetch(wmsUrl);
  
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`WMS request failed: ${response.status} ${response.statusText} - ${text.slice(0, 200)}`);
  }

  if (!response.body) {
    throw new Error("WMS response has no body");
  }

  // Convert web ReadableStream to Node.js Readable
  return Readable.fromWeb(response.body as import("stream/web").ReadableStream);
}

/**
 * Dimension function that returns image dimensions from MapWarper API
 */
export async function dimensionFunction({ id }: ResolverParams): Promise<{ width: number; height: number }> {
  const mapInfo = await client.getMap(id);
  return {
    width: mapInfo.width,
    height: mapInfo.height,
  };
}
