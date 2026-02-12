/**
 * TypeScript interfaces for MapWarper IIIF Shim
 */

/** MapWarper API response for a single map */
export interface MapWarperMap {
  id: string;
  type: "maps";
  attributes: {
    title: string;
    description: string;
    width: number;
    height: number;
    status: "unloaded" | "loading" | "available" | "warping" | "warped" | "published";
    mask_status: "unmasked" | "masking" | "masked";
    created_at: string;
    updated_at: string;
    bbox: string | null;
    map_type: "index" | "is_map" | "not_map";
    source_uri: string;
    unique_id: string;
    date_depicted: string;
  };
  links: {
    self: string;
    gcps_csv: string;
    mask: string;
    geotiff: string;
    png: string;
    aux_xml: string;
    kml: string;
    tiles: string;
    wms: string;
    thumb: string;
  };
}

/** MapWarper API response wrapper */
export interface MapWarperApiResponse {
  data: MapWarperMap;
}

/** MapWarper Layer/Mosaic */
export interface MapWarperLayer {
  id: string;
  type: "layers";
  attributes: {
    name: string;
    description: string | null;
    created_at: string;
    updated_at: string;
    bbox: string | null;
    maps_count: number;
    rectified_maps_count: number;
    is_visible: boolean;
    source_uri: string;
    rectified_percent: number;
  };
  relationships: {
    maps: {
      data: Array<{ id: string; type: "maps" }>;
    };
  };
  links: {
    self: string;
    kml: string;
    tiles: string;
    wms: string;
  };
}

/** MapWarper Layer API response wrapper */
export interface MapWarperLayerApiResponse {
  data: MapWarperLayer;
}

/** Simplified map info for internal use */
export interface MapInfo {
  id: string;
  title: string;
  description: string;
  width: number;
  height: number;
  status: string;
  created_at: string;
  updated_at: string;
  source_uri: string;
  date_depicted: string;
}

/** Simplified layer info for internal use */
export interface LayerInfo {
  id: string;
  name: string;
  description: string | null;
  mapIds: string[];
}

/** Error thrown when map is not found */
export class MapNotFoundError extends Error {
  constructor(id: string) {
    super(`Map not found: ${id}`);
    this.name = "MapNotFoundError";
  }
}

/** Error thrown when layer is not found */
export class LayerNotFoundError extends Error {
  constructor(id: string) {
    super(`Layer not found: ${id}`);
    this.name = "LayerNotFoundError";
  }
}
