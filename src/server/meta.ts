export type Page = {
  title: string;
  description: string;
  image: string;
  imageAlt: string;
  path: string;
  indexable: boolean;
};

const SITE = "type race";
const CODE = /^[A-Z]{4}$/;

export const OG_IMAGES = new Set(["home.jpg", "invite.jpg", "watch.jpg", "live.jpg"]);

export function pageFor(url: URL, hostOf: (code: string) => string | undefined = () => undefined): Page {
  const room = (url.searchParams.get("room") ?? "").toUpperCase();
  const watch = (url.searchParams.get("watch") ?? "").toUpperCase();
  if (CODE.test(room)) {
    const host = hostOf(room);
    return {
      title: host ? `${host} invited you to a race · ${SITE}` : `Join race ${room} · ${SITE}`,
      description: `Join room ${room}, pick a car and race on the same words. 2 to 5 racers, no sign-up.`,
      image: "/og/invite.jpg",
      imageAlt: "A red car on a garage turntable next to the words: You're invited to a race.",
      path: `/?room=${room}`,
      indexable: false,
    };
  }
  if (CODE.test(watch)) {
    return {
      title: `Watch race ${watch} live · ${SITE}`,
      description: "Follow the race as it happens and pick any racer to follow. No sign-up needed.",
      image: "/og/watch.jpg",
      imageAlt: "A car on nitro on a neon highway next to the words: Watch this race live.",
      path: `/?watch=${watch}`,
      indexable: false,
    };
  }
  if (url.searchParams.get("view") === "live") {
    return {
      title: `Live races · ${SITE}`,
      description: "Every typing race in progress, with each racer live on the track. Pick one and watch.",
      image: "/og/live.jpg",
      imageAlt: "A car racing down a neon highway next to the words: Pick a race and watch.",
      path: "/?view=live",
      indexable: true,
    };
  }
  return {
    title: `${SITE} · Type fast. Drive fast.`,
    description: "A multiplayer typing race in your browser. 2 to 5 racers type the same words, and your typing speed drives your car.",
    image: "/og/home.jpg",
    imageAlt: "Two cars racing down a neon city highway next to the words: Type fast. Drive fast.",
    path: "/",
    indexable: true,
  };
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function originOf(req: Request) {
  const url = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || url.protocol.slice(0, -1);
  return `${proto}://${req.headers.get("host") ?? url.host}`;
}

export function headTags(page: Page, origin: string) {
  const url = origin + page.path;
  const image = origin + page.image;
  const tags = [
    `<title>${escape(page.title)}</title>`,
    `<meta name="description" content="${escape(page.description)}" />`,
    page.indexable ? `<link rel="canonical" href="${escape(url)}" />` : `<meta name="robots" content="noindex" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${SITE}" />`,
    `<meta property="og:title" content="${escape(page.title)}" />`,
    `<meta property="og:description" content="${escape(page.description)}" />`,
    `<meta property="og:url" content="${escape(url)}" />`,
    `<meta property="og:image" content="${escape(image)}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${escape(page.imageAlt)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escape(page.title)}" />`,
    `<meta name="twitter:description" content="${escape(page.description)}" />`,
    `<meta name="twitter:image" content="${escape(image)}" />`,
    `<meta name="twitter:image:alt" content="${escape(page.imageAlt)}" />`,
  ];
  if (page.path === "/") {
    const app = {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: SITE,
      url,
      description: page.description,
      applicationCategory: "GameApplication",
      operatingSystem: "Any",
      isAccessibleForFree: true,
    };
    tags.push(`<script type="application/ld+json">${JSON.stringify(app).replace(/</g, "\\u003c")}</script>`);
  }
  return tags.join("\n");
}

export function withHead(html: string, page: Page, origin: string) {
  return html
    .replace(/<title>[\s\S]*?<\/title>/, "")
    .replace(/<meta name="description"[^>]*>/, "")
    .replace("</head>", `${headTags(page, origin)}\n</head>`);
}

export function robots(origin: string) {
  return `User-agent: *\nAllow: /\nDisallow: /_shell\n\nSitemap: ${origin}/sitemap.xml\n`;
}

export function sitemap(origin: string) {
  const urls = ["/", "/?view=live"].map((path) => `  <url><loc>${escape(origin + path)}</loc></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}
