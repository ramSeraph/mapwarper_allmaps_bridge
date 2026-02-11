/**
 * MapWarper-Allmaps Bridge - Cloudflare Workers Entry Point
 * IIIF Image API 3.0 compliant server for MapWarper maps with Allmaps sync tools
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { generateAnnotation } from "@allmaps/annotation";
import { processImageRequest, getMapInfoForIIIF, getLayerInfo, getMapGCPs, getMapMask, MapNotFoundError, LayerNotFoundError } from "./iiif.js";

type Bindings = {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
};

const app = new Hono<{ Bindings: Bindings }>();

// Middleware
app.use("*", cors());

// Serve static sync site under /sync
app.get("/sync", (c) => {
  return c.env.ASSETS.fetch(new Request(new URL("/index.html", c.req.url)));
});

app.get("/sync/*", (c) => {
  const url = new URL(c.req.url);
  const assetPath = url.pathname.replace("/sync", "") || "/index.html";
  return c.env.ASSETS.fetch(new Request(new URL(assetPath, url.origin)));
});

// Health check
app.get("/", (c) => {
  return c.json({
    name: "MapWarper-Allmaps Bridge",
    description: "IIIF Image API 3.0 for MapWarper maps with Allmaps sync tools",
    documentation: "https://iiif.io/api/image/3.0/",
    syncTool: "/sync",
    endpoints: {
      maps: "/mapwarper/maps/{mapId}/iiif/info.json",
      manifest: "/mapwarper/maps/{mapId}/iiif/manifest.json",
      mosaic: "/mapwarper/mosaic/{layerId}/manifest.json",
      image: "/mapwarper/maps/{mapId}/iiif/{region}/{size}/{rotation}/{quality}.{format}",
    },
    deployment: "Cloudflare Workers",
  });
});

// IIIF base identifier redirect to info.json
app.get("/mapwarper/maps/:identifier/iiif", (c) => {
  const identifier = c.req.param("identifier");
  return c.redirect(`/mapwarper/maps/${identifier}/iiif/info.json`, 303);
});

// IIIF info.json endpoint
app.get("/mapwarper/maps/:identifier/iiif/info.json", async (c) => {
  const identifier = c.req.param("identifier");
  const baseUrl = new URL(c.req.url).origin;
  const iiifId = `${baseUrl}/mapwarper/maps/${identifier}/iiif`;

  try {
    const mapInfo = await getMapInfoForIIIF(identifier);
    
    // Build IIIF 3.0 Image Information response
    const info = {
      "@context": "http://iiif.io/api/image/3/context.json",
      id: iiifId,
      type: "ImageService3",
      protocol: "http://iiif.io/api/image",
      profile: "level1",
      width: mapInfo.width,
      height: mapInfo.height,
      tiles: [
        {
          width: 512,
          height: 512,
          scaleFactors: [1, 2, 4, 8, 16, 32],
        },
      ],
      sizes: generateSizes(mapInfo.width, mapInfo.height),
    };

    c.header("Content-Type", "application/ld+json");
    c.header("Access-Control-Allow-Origin", "*");
    c.header("Cache-Control", "no-cache");
    return c.json(info);
  } catch (error) {
    if (error instanceof MapNotFoundError) {
      return c.json({ error: error.message }, 404);
    }
    console.error("Error processing info.json:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// IIIF Presentation API 3.0 manifest endpoint
app.get("/mapwarper/maps/:identifier/iiif/manifest.json", async (c) => {
  const identifier = c.req.param("identifier");
  const baseUrl = new URL(c.req.url).origin;
  const iiifBase = `${baseUrl}/mapwarper/maps/${identifier}/iiif`;

  try {
    const mapInfo = await getMapInfoForIIIF(identifier);

    // Build metadata array from available fields
    const metadata: Array<{ label: { en: string[] }; value: { en: string[] } }> = [];
    
    if (mapInfo.description) {
      metadata.push({
        label: { en: ["Description"] },
        value: { en: [mapInfo.description] },
      });
    }
    if (mapInfo.date_depicted) {
      metadata.push({
        label: { en: ["Date Depicted"] },
        value: { en: [mapInfo.date_depicted] },
      });
    }
    if (mapInfo.source_uri) {
      metadata.push({
        label: { en: ["Source"] },
        value: { en: [mapInfo.source_uri] },
      });
    }
    if (mapInfo.created_at) {
      metadata.push({
        label: { en: ["Created"] },
        value: { en: [new Date(mapInfo.created_at).toISOString().split("T")[0]] },
      });
    }
    if (mapInfo.updated_at) {
      metadata.push({
        label: { en: ["Last Updated"] },
        value: { en: [new Date(mapInfo.updated_at).toISOString().split("T")[0]] },
      });
    }

    const manifest = {
      "@context": "http://iiif.io/api/presentation/3/context.json",
      id: `${iiifBase}/manifest.json`,
      type: "Manifest",
      label: {
        en: [mapInfo.title || `Map ${identifier}`],
      },
      ...(metadata.length > 0 && { metadata }),
      items: [
        {
          id: `${iiifBase}/canvas/1`,
          type: "Canvas",
          width: mapInfo.width,
          height: mapInfo.height,
          items: [
            {
              id: `${iiifBase}/canvas/1/page`,
              type: "AnnotationPage",
              items: [
                {
                  id: `${iiifBase}/canvas/1/page/annotation`,
                  type: "Annotation",
                  motivation: "painting",
                  target: `${iiifBase}/canvas/1`,
                  body: {
                    id: `${iiifBase}/full/max/0/default.png`,
                    type: "Image",
                    format: "image/png",
                    width: mapInfo.width,
                    height: mapInfo.height,
                    service: [
                      {
                        id: iiifBase,
                        type: "ImageService3",
                        profile: "level1",
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    };

    c.header("Content-Type", "application/ld+json");
    c.header("Access-Control-Allow-Origin", "*");
    c.header("Cache-Control", "no-cache");
    return c.json(manifest);
  } catch (error) {
    if (error instanceof MapNotFoundError) {
      return c.json({ error: error.message }, 404);
    }
    console.error("Error generating manifest:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// Allmaps georeferencing annotation endpoint
app.get("/mapwarper/maps/:identifier/annotation.json", async (c) => {
  const identifier = c.req.param("identifier");
  const baseUrl = new URL(c.req.url).origin;
  const iiifBase = `${baseUrl}/mapwarper/maps/${identifier}/iiif`;

  try {
    // Fetch map info, GCPs, and mask in parallel
    const [mapInfo, gcps, maskCoords] = await Promise.all([
      getMapInfoForIIIF(identifier),
      getMapGCPs(identifier),
      getMapMask(identifier),
    ]);

    if (gcps.length === 0) {
      return c.json({ error: "No GCPs found for this map" }, 404);
    }

    // Build GeoreferencedMap for @allmaps/annotation
    const georeferencedMap = {
      type: "GeoreferencedMap" as const,
      "@context": "https://schemas.allmaps.org/map/2/context.json" as const,
      resource: {
        id: iiifBase,
        type: "ImageService3" as const,
        width: mapInfo.width,
        height: mapInfo.height,
      },
      gcps: gcps.map(gcp => ({
        resource: [gcp.x, gcp.y] as [number, number],
        geo: [gcp.lon, gcp.lat] as [number, number],
      })),
      resourceMask: maskCoords && maskCoords.length > 0
        ? maskCoords.map(([x, y]) => [x, y] as [number, number])
        : [[0, 0], [mapInfo.width, 0], [mapInfo.width, mapInfo.height], [0, mapInfo.height]] as [number, number][],
    };

    const annotation = generateAnnotation(georeferencedMap);

    c.header("Content-Type", "application/ld+json");
    c.header("Access-Control-Allow-Origin", "*");
    c.header("Cache-Control", "no-cache");
    return c.json(annotation);
  } catch (error) {
    if (error instanceof MapNotFoundError) {
      return c.json({ error: error.message }, 404);
    }
    console.error("Error generating annotation:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// Proxy endpoint for MapWarper mask (CORS workaround)
app.get("/mapwarper/maps/:identifier/mask.json", async (c) => {
  const identifier = c.req.param("identifier");

  try {
    const maskCoords = await getMapMask(identifier);
    
    if (!maskCoords || maskCoords.length === 0) {
      return c.json({ error: "No mask found for this map" }, 404);
    }
    
    return c.json({ coords: maskCoords });
  } catch (error) {
    if (error instanceof MapNotFoundError) {
      return c.json({ error: "Map not found" }, 404);
    }
    console.error("Mask error:", error);
    return c.json({ error: "Failed to fetch mask" }, 500);
  }
});

// Allmaps georeferencing annotation endpoint for mosaics (combines all rectified maps)
// Uses in-memory cache; add ?refresh to bypass
const mosaicAnnotationCache = new Map<string, { data: unknown; timestamp: number }>();
const MOSAIC_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const MOSAIC_CONCURRENCY_LIMIT = 5; // Max concurrent map fetches

// Process items with concurrency limit
async function processWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  const executing: Promise<void>[] = [];
  
  for (const item of items) {
    const p = fn(item).then((result) => {
      results.push(result);
    });
    executing.push(p);
    
    if (executing.length >= limit) {
      await Promise.race(executing);
      // Remove completed promises
      for (let i = executing.length - 1; i >= 0; i--) {
        const status = await Promise.race([executing[i], Promise.resolve("pending")]);
        if (status !== "pending") executing.splice(i, 1);
      }
    }
  }
  
  await Promise.all(executing);
  return results;
}

app.get("/mapwarper/mosaic/:identifier/annotation.json", async (c) => {
  const identifier = c.req.param("identifier");
  const baseUrl = new URL(c.req.url).origin;
  const refresh = c.req.query("refresh") !== undefined;

  // Check cache unless refresh requested
  const cacheKey = `${identifier}:${baseUrl}`;
  if (!refresh) {
    const cached = mosaicAnnotationCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < MOSAIC_CACHE_TTL) {
      c.header("Content-Type", "application/ld+json");
      c.header("Access-Control-Allow-Origin", "*");
      c.header("X-Cache", "HIT");
      return c.json(cached.data);
    }
  }

  try {
    const layerInfo = await getLayerInfo(identifier);
    
    // Fetch map data with concurrency limit to avoid overwhelming server
    const mapDataResults = await processWithConcurrency(
      layerInfo.mapIds,
      MOSAIC_CONCURRENCY_LIMIT,
      async (mapId) => {
        try {
          const [mapInfo, gcps, maskCoords] = await Promise.all([
            getMapInfoForIIIF(mapId),
            getMapGCPs(mapId),
            getMapMask(mapId),
          ]);
          return { mapId, mapInfo, gcps, maskCoords };
        } catch {
          return null;
        }
      }
    );
    
    // Filter to only maps with GCPs (georeferenced in MapWarper)
    const georeferencedMaps = mapDataResults
      .filter((data): data is NonNullable<typeof data> => data !== null && data.gcps.length > 0)
      .map((data) => {
        const iiifBase = `${baseUrl}/mapwarper/maps/${data.mapId}/iiif`;
        return {
          type: "GeoreferencedMap" as const,
          "@context": "https://schemas.allmaps.org/map/2/context.json" as const,
          resource: {
            id: iiifBase,
            type: "ImageService3" as const,
            width: data.mapInfo.width,
            height: data.mapInfo.height,
          },
          gcps: data.gcps.map(gcp => ({
            resource: [gcp.x, gcp.y] as [number, number],
            geo: [gcp.lon, gcp.lat] as [number, number],
          })),
          resourceMask: data.maskCoords && data.maskCoords.length > 0
            ? data.maskCoords.map(([x, y]) => [x, y] as [number, number])
            : [[0, 0], [data.mapInfo.width, 0], [data.mapInfo.width, data.mapInfo.height], [0, data.mapInfo.height]] as [number, number][],
        };
      });

    if (georeferencedMaps.length === 0) {
      return c.json({ error: "No georeferenced maps found in this mosaic" }, 404);
    }

    // Generate AnnotationPage with all georeferenced maps
    const annotation = generateAnnotation(georeferencedMaps);

    // Cache the result
    mosaicAnnotationCache.set(cacheKey, { data: annotation, timestamp: Date.now() });

    c.header("Content-Type", "application/ld+json");
    c.header("Access-Control-Allow-Origin", "*");
    c.header("X-Cache", "MISS");
    return c.json(annotation);
  } catch (error) {
    if (error instanceof LayerNotFoundError) {
      return c.json({ error: error.message }, 404);
    }
    console.error("Error generating mosaic annotation:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// Allmaps mosaic annotation endpoint (combines annotations FROM Allmaps for each map)
const allmapsMosaicCache = new Map<string, { data: unknown; timestamp: number }>();

app.get("/allmaps/mosaic/:identifier/annotation.json", async (c) => {
  const identifier = c.req.param("identifier");
  const baseUrl = new URL(c.req.url).origin;
  const refresh = c.req.query("refresh") !== undefined;

  const cacheKey = `allmaps:${identifier}`;
  if (!refresh) {
    const cached = allmapsMosaicCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < MOSAIC_CACHE_TTL) {
      c.header("Content-Type", "application/ld+json");
      c.header("Access-Control-Allow-Origin", "*");
      c.header("X-Cache", "HIT");
      return c.json(cached.data);
    }
  }

  try {
    const layerInfo = await getLayerInfo(identifier);
    
    // Fetch Allmaps annotations for each map with concurrency limit
    const annotationResults = await processWithConcurrency(
      layerInfo.mapIds,
      MOSAIC_CONCURRENCY_LIMIT,
      async (mapId) => {
        try {
          const iiifUrl = `${baseUrl}/mapwarper/maps/${mapId}/iiif/info.json`;
          const allmapsUrl = `https://annotations.allmaps.org/?url=${encodeURIComponent(iiifUrl)}`;
          const response = await fetch(allmapsUrl);
          if (!response.ok) return null;
          const data = await response.json();
          // Allmaps returns AnnotationPage with items array
          return data?.items || [];
        } catch {
          return null;
        }
      }
    );

    // Flatten all annotation items
    const allItems = annotationResults
      .filter((items): items is unknown[] => items !== null && Array.isArray(items))
      .flat();

    if (allItems.length === 0) {
      return c.json({ error: "No Allmaps annotations found for maps in this mosaic" }, 404);
    }

    // Build combined AnnotationPage
    const annotationPage = {
      type: "AnnotationPage",
      "@context": "http://www.w3.org/ns/anno.jsonld",
      items: allItems,
    };

    allmapsMosaicCache.set(cacheKey, { data: annotationPage, timestamp: Date.now() });

    c.header("Content-Type", "application/ld+json");
    c.header("Access-Control-Allow-Origin", "*");
    c.header("X-Cache", "MISS");
    return c.json(annotationPage);
  } catch (error) {
    if (error instanceof LayerNotFoundError) {
      return c.json({ error: error.message }, 404);
    }
    console.error("Error fetching Allmaps mosaic annotations:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// IIIF Presentation API 3.0 manifest for mosaics/layers
app.get("/mapwarper/mosaic/:identifier/manifest.json", async (c) => {
  const identifier = c.req.param("identifier");
  const baseUrl = new URL(c.req.url).origin;

  try {
    const layerInfo = await getLayerInfo(identifier);
    
    // Fetch info for all maps in the mosaic
    const mapInfoPromises = layerInfo.mapIds.map(mapId => getMapInfoForIIIF(mapId));
    const mapInfos = await Promise.all(mapInfoPromises);

    // Create a canvas for each map
    const items = mapInfos.map((mapInfo, index) => {
      const mapIiifBase = `${baseUrl}/mapwarper/maps/${mapInfo.id}/iiif`;
      return {
        id: `${baseUrl}/mapwarper/mosaic/${identifier}/canvas/${index + 1}`,
        type: "Canvas",
        label: {
          en: [mapInfo.title || `Map ${mapInfo.id}`],
        },
        width: mapInfo.width,
        height: mapInfo.height,
        items: [
          {
            id: `${baseUrl}/mapwarper/mosaic/${identifier}/canvas/${index + 1}/page`,
            type: "AnnotationPage",
            items: [
              {
                id: `${baseUrl}/mapwarper/mosaic/${identifier}/canvas/${index + 1}/page/annotation`,
                type: "Annotation",
                motivation: "painting",
                target: `${baseUrl}/mapwarper/mosaic/${identifier}/canvas/${index + 1}`,
                body: {
                  id: `${mapIiifBase}/full/max/0/default.png`,
                  type: "Image",
                  format: "image/png",
                  width: mapInfo.width,
                  height: mapInfo.height,
                  service: [
                    {
                      id: mapIiifBase,
                      type: "ImageService3",
                      profile: "level1",
                    },
                  ],
                },
              },
            ],
          },
        ],
      };
    });

    const manifest = {
      "@context": "http://iiif.io/api/presentation/3/context.json",
      id: `${baseUrl}/mapwarper/mosaic/${identifier}/manifest.json`,
      type: "Manifest",
      label: {
        en: [layerInfo.name],
      },
      ...(layerInfo.description && {
        summary: {
          en: [layerInfo.description],
        },
      }),
      items,
    };

    c.header("Content-Type", "application/ld+json");
    c.header("Access-Control-Allow-Origin", "*");
    c.header("Cache-Control", "no-cache");
    return c.json(manifest);
  } catch (error) {
    if (error instanceof LayerNotFoundError) {
      return c.json({ error: error.message }, 404);
    }
    if (error instanceof MapNotFoundError) {
      return c.json({ error: error.message }, 404);
    }
    console.error("Error generating mosaic manifest:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// IIIF image request endpoint
app.get("/mapwarper/maps/:identifier/iiif/:region/:size/:rotation/:qualityFormat", async (c) => {
  const { identifier, region, size, rotation, qualityFormat } = c.req.param();
  const [quality, format] = qualityFormat.split(".");

  if (!format) {
    return c.json({ error: "Invalid format" }, 400);
  }

  try {
    const result = await processImageRequest({
      identifier,
      region,
      size,
      rotation,
      quality,
      format,
    });

    // Return response with no caching for now (enable when stable)
    return new Response(result.buffer, {
      headers: {
        "Content-Type": result.contentType,
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {
    if (error instanceof MapNotFoundError) {
      return c.json({ error: error.message }, 404);
    }
    console.error("Error processing image request:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

/**
 * Generate size variants for info.json
 */
function generateSizes(width: number, height: number): Array<{ width: number; height: number }> {
  const sizes: Array<{ width: number; height: number }> = [];
  let w = width;
  let h = height;
  
  while (w > 100 && h > 100) {
    sizes.push({ width: Math.round(w), height: Math.round(h) });
    w = w / 2;
    h = h / 2;
  }
  
  return sizes;
}

export default app;
