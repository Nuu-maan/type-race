import { expect, test } from "bun:test";
import { clientAddress, headTags, originOf, pageFor, sitemap, withHead } from "./meta";

const at = (query: string) => new URL(`http://localhost:3000/${query}`);

test("each kind of link gets its own page", () => {
  expect(pageFor(at("")).image).toBe("/og/home.jpg");
  expect(pageFor(at("?view=live")).image).toBe("/og/live.jpg");
  expect(pageFor(at("?mode=daily"))).toMatchObject({ image: "/og/daily.jpg", title: "Today's challenge · type race", indexable: true });
  expect(pageFor(at("?watch=abcd"))).toMatchObject({ image: "/og/watch.jpg", path: "/?watch=ABCD", indexable: false });
  expect(pageFor(at("?room=ABCD"))).toMatchObject({ image: "/og/invite.jpg", title: "Join race ABCD · type race", indexable: false });
  expect(pageFor(at("?room=ABCD"), () => "Numan").title).toBe("Numan invited you to a race · type race");
  expect(pageFor(at("?room=../x")).image).toBe("/og/home.jpg");
});

test("racer names can't break out of the tags", () => {
  const tags = headTags(pageFor(at("?room=ABCD"), () => `"><script>x</script>`), "https://example.com");
  expect(tags).not.toContain("<script>x");
  expect(tags).toContain("&#34;&#62;&#60;script&#62;");
});

test("room and watch links are not indexed, home is canonical", () => {
  expect(headTags(pageFor(at("?watch=ABCD")), "https://e.com")).toContain(`<meta name="robots" content="noindex" />`);
  const home = headTags(pageFor(at("")), "https://e.com");
  expect(home).toContain(`<link rel="canonical" href="https://e.com/" />`);
  expect(home).toContain(`<meta property="og:image" content="https://e.com/og/home.jpg" />`);
  expect(home).toContain("application/ld+json");
});

test("tags replace the page's own title and description", () => {
  const html = `<html><head><title>old</title><meta name="description" content="old" /></head><body></body></html>`;
  const out = withHead(html, pageFor(at("")), "https://e.com");
  expect(out).not.toContain("old");
  expect(out.match(/<title>/g)).toHaveLength(1);
});

test("origin follows the proxy's protocol and host", () => {
  const req = new Request("http://internal:10000/", { headers: { host: "type-race.onrender.com", "x-forwarded-proto": "https" } });
  expect(originOf(req)).toBe("https://type-race.onrender.com");
  expect(sitemap("https://e.com")).toContain("<loc>https://e.com/?view=live</loc>");
});

test("the visitor address comes from the proxy, not from headers the visitor can fake", () => {
  const spoofed = new Headers({ "x-forwarded-for": "1.2.3.4, 9.9.9.9", "cf-connecting-ip": "9.9.9.9" });
  expect(clientAddress(spoofed)).toBe("9.9.9.9");
  expect(clientAddress(new Headers({ "x-forwarded-for": "1.2.3.4, 9.9.9.9" }))).toBe("9.9.9.9");
  expect(clientAddress(new Headers())).toBeNull();
});
