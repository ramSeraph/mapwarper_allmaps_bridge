# MapWarper-Allmaps Bridge

A [Cloudflare Worker](https://developers.cloudflare.com/workers/) that bridges [MapWarper](https://mapwarper.net) maps to [Allmaps](https://allmaps.org/) via IIIF endpoints.

Deployed at: https://mapwarper-allmaps-bridge.ramseraph.workers.dev/

## What it does

This project provides a **IIIF shim** over MapWarper, making the **unwarped** (original) versions of maps accessible to Allmaps and other IIIF-compatible viewers.

It also **converts MapWarper's GCP (ground control points) and crop/mask data into Allmaps georeference annotations**, allowing you to view MapWarper's warped maps directly in Allmaps without re-georeferencing.

### Sync UI (`/sync`)

The included sync tool helps with bidirectional workflow between MapWarper and Allmaps:

- **MapWarper → Allmaps**: Copy GCPs and crop masks from MapWarper to Allmaps, enabling you to edit the georeferencing using Allmaps' UI
- **Allmaps → MapWarper**: Transfer GCP edits made in Allmaps back to MapWarper

> ⚠️ **Note on masks/crops**: MapWarper does not support uploading masks via API, so crops created in Allmaps **cannot** be transferred back to MapWarper. It's recommended to do all cropping on the MapWarper side.

## Endpoints

### Maps (IIIF Image API 3.0)

| Endpoint | Description |
|----------|-------------|
| `GET /mapwarper/maps/{mapId}/iiif/info.json` | IIIF Image Information |
| `GET /mapwarper/maps/{mapId}/iiif/manifest.json` | IIIF Presentation Manifest |
| `GET /mapwarper/maps/{mapId}/iiif/{region}/{size}/{rotation}/{quality}.{format}` | Image tile/region |
| `GET /mapwarper/maps/{mapId}/annotation.json` | Allmaps georeference annotation (from MapWarper GCPs) |
| `GET /mapwarper/maps/{mapId}/mask.json` | Map mask coordinates |

### Mosaics/Layers

| Endpoint | Description |
|----------|-------------|
| `GET /mapwarper/mosaic/{layerId}/manifest.json` | IIIF manifest for all maps in layer |
| `GET /mapwarper/mosaic/{layerId}/annotation.json` | Combined Allmaps annotation from MapWarper GCPs |
| `GET /allmaps/mosaic/{layerId}/annotation.json` | Combined annotations from Allmaps API |

## Development

```bash
npm install
npm run dev      # Local dev server
npm run deploy   # Deploy to Cloudflare
```

## License

[Unlicense](./UNLICENSE)
