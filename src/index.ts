/**
 * MapWarper IIIF Shim
 * IIIF Image API 3.0 compliant server for MapWarper unwarped maps
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { serve } from "@hono/node-server";
import { Processor } from "iiif-processor";
import { streamResolver, dimensionFunction } from "./resolver.js";
import { processImageRequest, MapNotFoundError } from "./iiif.js";

const app = new Hono();

// Middleware
app.use("*", logger());
app.use("*", cors());

// Health check
app.get("/", (c) => {
  return c.json({
    name: "MapWarper IIIF Shim",
    description: "IIIF Image API 3.0 for MapWarper unwarped maps",
    documentation: "https://iiif.io/api/image/3.0/",
  });
});

// IIIF base identifier redirect to info.json
app.get("/:identifier", (c) => {
  const identifier = c.req.param("identifier");
  return c.redirect(`/${identifier}/info.json`, 303);
});

// IIIF info.json endpoint
app.get("/:identifier/info.json", async (c) => {
  const identifier = c.req.param("identifier");
  const baseUrl = new URL(c.req.url).origin;
  // Use internal URL format for iiif-processor
  const url = `${baseUrl}/iiif/3/${identifier}/info.json`;

  try {
    const processor = new Processor(url, streamResolver, {
      dimensionFunction,
      pathPrefix: "/iiif/{{version}}/",
    });

    const result = await processor.execute();

    if (result.type === "content") {
      c.header("Content-Type", result.contentType);
      c.header("Access-Control-Allow-Origin", "*");
      if (result.profileLink) {
        c.header("Link", `<${result.profileLink}>;rel="profile"`);
      }
      // Fix the id in the response to match our actual URL structure
      let body = typeof result.body === "string" 
        ? result.body 
        : result.body.toString("utf-8");
      
      // Replace the internal iiif/3/ path with our actual path
      body = body.replace(`${baseUrl}/iiif/3/${identifier}`, `${baseUrl}/${identifier}`);
      
      return c.body(body);
    } else if (result.type === "error") {
      return c.json({ error: result.message }, result.statusCode as 400 | 404 | 500);
    }

    return c.json({ error: "Unexpected result type" }, 500);
  } catch (error) {
    if (error instanceof MapNotFoundError) {
      return c.json({ error: error.message }, 404);
    }
    console.error("Error processing info.json:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// IIIF image request endpoint - direct WMS proxy
app.get("/:identifier/:region/:size/:rotation/:qualityFormat", async (c) => {
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

    c.header("Content-Type", result.contentType);
    c.header("Access-Control-Allow-Origin", "*");
    return c.body(new Uint8Array(result.buffer));
  } catch (error) {
    if (error instanceof MapNotFoundError) {
      return c.json({ error: error.message }, 404);
    }
    console.error("Error processing image request:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// Start server (Node.js only - not used in Workers)
const port = parseInt(process.env.PORT || "3000", 10);

console.log(`Starting MapWarper IIIF Shim on port ${port}`);
console.log(`MapWarper base URL: https://mapwarper.net`);

serve({
  fetch: app.fetch,
  port,
});

console.log(`Server running at http://localhost:${port}`);
