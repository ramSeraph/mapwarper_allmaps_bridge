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

    const height = mapInfo.height;
    
    // Build GeoreferencedMap for @allmaps/annotation
    const georeferencedMap = {
      type: "GeoreferencedMap" as const,
      "@context": "https://schemas.allmaps.org/map/2/context.json" as const,
      resource: {
        id: iiifBase,
        type: "ImageService3" as const,
        width: mapInfo.width,
        height: height,
      },
      gcps: gcps.map(gcp => ({
        resource: [gcp.x, gcp.y] as [number, number],
        geo: [gcp.lon, gcp.lat] as [number, number],
      })),
      resourceMask: maskCoords && maskCoords.length >= 3
        ? maskCoords.map(([x, y]) => [x, height - y] as [number, number])
        : [[0, 0], [mapInfo.width, 0], [mapInfo.width, height], [0, height]] as [number, number][],
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

export default {
  fetch: app.fetch,
};
