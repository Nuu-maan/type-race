# RazorCap design concepts

Two independent, responsive landing pages: Linear-inspired precision and Raycast-inspired warmth and motion. Start with `dist/index.html` served over HTTP.

Run from this directory:

```sh
python3 -m http.server 4317 --directory dist
node pricing.test.mjs
```

Open http://localhost:4317. No installation or build is required. Google Fonts is optional; local system fonts are the fallback.

Custom components include a request-flow diagram, action panel, language-switching terminal with clipboard support, simulated request feedback, pricing calculator, animated feature illustrations, and pause-motion control. Reduced-motion preferences are respected.

The API demo runs locally and sends no requests. Outbound calls to action lead to the official RazorCap website. Prices reflect its published rates checked October 17, 2026; estimates are not invoices. No uptime or success-rate claims are included because the source homepage contains inconsistent figures. The page is a design concept, not an official site or backend integration.
