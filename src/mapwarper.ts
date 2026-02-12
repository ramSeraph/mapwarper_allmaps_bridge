/**
 * MapWarper API Client
 * Fetches map metadata from the MapWarper API
 */

import { MapWarperApiResponse, MapWarperLayerApiResponse, MapInfo, LayerInfo, MapNotFoundError, LayerNotFoundError } from "./types.js";

const DEFAULT_BASE_URL = "https://mapwarper.net";

export class MapWarperClient {
  private baseUrl: string;

  constructor(baseUrl: string = DEFAULT_BASE_URL) {
    this.baseUrl = baseUrl.replace(/\/$/, ""); // Remove trailing slash
  }

  /**
   * Fetch map metadata by ID
   */
  async getMap(id: string): Promise<MapInfo> {
    const url = `${this.baseUrl}/api/v1/maps/${id}.json`;
    
    const response = await fetch(url, {
      headers: {
        "Accept": "application/json",
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new MapNotFoundError(id);
      }
      throw new Error(`MapWarper API error: ${response.status} ${response.statusText}`);
    }

    const data: MapWarperApiResponse = await response.json();
    
    return {
      id: data.data.id,
      title: data.data.attributes.title,
      description: data.data.attributes.description,
      width: data.data.attributes.width,
      height: data.data.attributes.height,
      status: data.data.attributes.status,
      created_at: data.data.attributes.created_at,
      updated_at: data.data.attributes.updated_at,
      source_uri: data.data.attributes.source_uri,
      date_depicted: data.data.attributes.date_depicted,
    };
  }

  /**
   * Fetch layer/mosaic metadata by ID
   */
  async getLayer(id: string): Promise<LayerInfo> {
    const url = `${this.baseUrl}/api/v1/layers/${id}.json`;
    
    const response = await fetch(url, {
      headers: {
        "Accept": "application/json",
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new LayerNotFoundError(id);
      }
      throw new Error(`MapWarper API error: ${response.status} ${response.statusText}`);
    }

    const data: MapWarperLayerApiResponse = await response.json();
    
    return {
      id: data.data.id,
      name: data.data.attributes.name,
      description: data.data.attributes.description,
      mapIds: data.data.relationships.maps.data.map(m => m.id),
    };
  }

  /**
   * Fetch mask coordinates for a map (GML format)
   */
  async getMask(id: string): Promise<number[][] | null> {
    const url = `${this.baseUrl}/mapimages/${id}.gml.ol`;
    
    const response = await fetch(url);

    if (!response.ok) {
      return null;
    }

    const gmlText = await response.text();
    return this.parseGmlMask(gmlText);
  }

  private parseGmlMask(gmlText: string): number[][] | null {
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

  /**
   * Build WMS URL for unwarped image
   * Note: WMS uses bottom-up Y-axis, IIIF uses top-down Y-axis
   * We need to flip the Y coordinates
   */
  buildWmsUrl(
    id: string,
    bbox: { x: number; y: number; width: number; height: number },
    outputWidth: number,
    outputHeight: number,
    format: string = "image/png",
    imageHeight: number = 0
  ): string {
    // Flip Y coordinates: IIIF y=0 is at top, WMS y=0 is at bottom
    // WMS BBOX is (minX, minY, maxX, maxY) where minY is at bottom
    let minY: number, maxY: number;
    
    if (imageHeight > 0) {
      // Convert from IIIF (top-down) to WMS (bottom-up)
      minY = imageHeight - bbox.y - bbox.height;
      maxY = imageHeight - bbox.y;
    } else {
      // Fallback: use as-is (for full image requests)
      minY = bbox.y;
      maxY = bbox.y + bbox.height;
    }
    
    const params = new URLSearchParams({
      SERVICE: "WMS",
      VERSION: "1.1.1",
      REQUEST: "GetMap",
      STYLES: "",
      SRS: "EPSG:4326",
      STATUS: "unwarped",
      BBOX: `${bbox.x},${minY},${bbox.x + bbox.width},${maxY}`,
      WIDTH: outputWidth.toString(),
      HEIGHT: outputHeight.toString(),
      FORMAT: format,
    });

    return `${this.baseUrl}/maps/wms/${id}?${params.toString()}`;
  }
}
