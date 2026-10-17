export type Release = {
  version: string;
  date: string;
  title: string;
  summary: string;
  groups: { kind: string; items: string[] }[];
};

export function parseChangelog(markdown: string): Release[] {
  const releases: Release[] = [];
  let release: Release | null = null;
  for (const raw of markdown.split("\n")) {
    const line = raw.trim();
    const heading = line.match(/^## (\S+) · (\d{4}-\d{2}-\d{2}) · (.+)$/);
    if (heading) {
      release = { version: heading[1]!, date: heading[2]!, title: heading[3]!, summary: "", groups: [] };
      releases.push(release);
    } else if (!release || !line) {
      continue;
    } else if (line.startsWith("### ")) {
      release.groups.push({ kind: line.slice(4), items: [] });
    } else if (line.startsWith("- ") && release.groups.length) {
      release.groups.at(-1)!.items.push(line.slice(2));
    } else if (!release.groups.length) {
      release.summary = release.summary ? `${release.summary} ${line}` : line;
    }
  }
  return releases;
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function inline(text: string) {
  return escape(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

const anchor = (release: Release) => `v${release.version.replaceAll(".", "-")}`;

function longDate(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function shortDate(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function releasesHtml(releases: Release[]) {
  return releases
    .map((release) => {
      const groups = release.groups
        .map(
          (group) =>
            `<div class="release-group"><h3 class="release-tag release-tag-${escape(group.kind.toLowerCase())}">${escape(group.kind)}</h3><ul>${group.items
              .map((item) => `<li>${inline(item)}</li>`)
              .join("")}</ul></div>`,
        )
        .join("");
      return `<li class="release" id="${anchor(release)}"><div class="release-meta"><time datetime="${release.date}">${longDate(release.date)}</time><span class="version">${escape(release.version)}</span></div><div class="release-body"><h2>${inline(release.title)}</h2>${release.summary ? `<p class="release-summary">${inline(release.summary)}</p>` : ""}${groups}</div></li>`;
    })
    .join("");
}

export function latestHtml(releases: Release[], count = 3) {
  return releases
    .slice(0, count)
    .map(
      (release) =>
        `<li><a href="/changelog#${anchor(release)}" data-nav="changelog"><time datetime="${release.date}">${shortDate(release.date)}</time><strong>${inline(release.title)}</strong><span class="version">${escape(release.version)}</span></a></li>`,
    )
    .join("");
}

export function withChangelog(html: string, releases: Release[]) {
  const latest = releases[0];
  return html
    .replace('<ol id="releases" class="releases"></ol>', `<ol id="releases" class="releases">${releasesHtml(releases)}</ol>`)
    .replace('<ol id="whats-new" class="news"></ol>', `<ol id="whats-new" class="news">${latestHtml(releases)}</ol>`)
    .replace(
      '<a id="release-pill" class="release-pill" href="/changelog" data-nav="changelog" hidden></a>',
      latest
        ? `<a id="release-pill" class="release-pill" href="/changelog#${anchor(latest)}" data-nav="changelog"><span class="pill-tag">New</span><span class="pill-text">${inline(latest.title)}</span><svg viewBox="0 0 18 18" aria-hidden="true"><path d="m7 4.5 4.5 4.5L7 13.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg></a>`
        : "",
    );
}
