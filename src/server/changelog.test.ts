import { expect, test } from "bun:test";
import { latestHtml, parseChangelog, releasesHtml, withChangelog } from "./changelog";

const sample = `# Changelog

Intro line that is not a release.

## 0.2.0 · 2026-10-17 · Second <release>

A short summary
over two lines.

### New
- Added \`code\` and **bold** text.
- Another item.

### Fixed
- A bug.

## 0.1.0 · 2026-10-13 · First release

### New
- The first race.
`;

test("releases parse with their summary and groups", () => {
  const releases = parseChangelog(sample);
  expect(releases.map((r) => r.version)).toEqual(["0.2.0", "0.1.0"]);
  expect(releases[0]).toMatchObject({ date: "2026-10-17", title: "Second <release>", summary: "A short summary over two lines." });
  expect(releases[0]!.groups.map((g) => [g.kind, g.items.length])).toEqual([["New", 2], ["Fixed", 1]]);
});

test("the rendered page escapes text and only allows code and bold", () => {
  const html = releasesHtml(parseChangelog(sample));
  expect(html).toContain("Second &#60;release&#62;");
  expect(html).toContain("<code>code</code>");
  expect(html).toContain("<strong>bold</strong>");
  expect(html).toContain('id="v0-2-0"');
  expect(html).toContain('<time datetime="2026-10-17">Oct 17, 2026</time>');
});

test("the home page gets the latest releases and a pill for the newest", () => {
  const releases = parseChangelog(sample);
  expect(latestHtml(releases, 1)).not.toContain("First release");
  const page = withChangelog(
    '<a id="release-pill" class="release-pill" href="/changelog" data-nav="changelog" hidden></a><ol id="whats-new" class="news"></ol><ol id="releases" class="releases"></ol>',
    releases,
  );
  expect(page).toContain('href="/changelog#v0-2-0" data-nav="changelog"><span class="pill-tag">New</span>');
  expect(page).not.toContain(" hidden>");
  expect(page.match(/class="release"/g)).toHaveLength(2);
});

test("the repo changelog parses into dated releases, newest first", async () => {
  const releases = parseChangelog(await Bun.file(`${import.meta.dir}/../../CHANGELOG.md`).text());
  expect(releases.length).toBeGreaterThan(5);
  for (const release of releases) expect(release.groups.length).toBeGreaterThan(0);
  const dates = releases.map((r) => r.date);
  expect([...dates].sort().reverse()).toEqual(dates);
});
