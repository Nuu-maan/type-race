import type { RaceMode } from "../shared/challenge";
import { DIFFICULTY, type Car, type Difficulty } from "../shared/progress";
import { el } from "./ui";

export type HistoryEntry = {
  id: number;
  mode: RaceMode;
  difficulty: Difficulty;
  wpm: number;
  accuracy: number;
  durationMs: number;
  finished: boolean;
  won: boolean;
  xp: number;
  challengeKey: string | null;
  at: number;
};

export type Goal = { id: string; label: string; current: number; target: number; unit: string };

export type RecordEntry = {
  mode: RaceMode;
  difficulty: Difficulty;
  wpm: number;
  accuracy: number;
  durationMs: number;
  at: number;
};

export type Profile = {
  id: string;
  name: string;
  xp: number;
  level: number;
  car: Car;
  races: number;
  wins: number;
  bestWpm: number;
  averageAccuracy: number;
  practiceRaces: number;
  dailyRaces: number;
  dailyStreak: number;
  readyInMs: number | null;
  ghostReady: boolean;
  records: RecordEntry[];
  history: HistoryEntry[];
  goals: Goal[];
};

export type CompetitionEntry = {
  rank: number;
  name: string;
  level: number;
  paint: string;
  score: number;
  wpm: number;
  accuracy: number;
  days: number;
  isYou: boolean;
};

export type Competition = {
  key: string;
  entries: CompetitionEntry[];
  you: CompetitionEntry | null;
};

export type Competitions = {
  daily: Competition & { participants: number };
  weekly: Competition;
};

export type DashboardCallbacks = {
  onPractice: () => void;
  onDaily: () => void;
  onGhost?: () => void;
  onShare?: (record: RecordEntry) => void;
};

const MODE_LABELS: Record<RaceMode, string> = {
  multiplayer: "Friend race",
  practice: "Practice",
  ghost: "Personal best race",
  daily: "Daily challenge",
};

const dateFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

function formatDate(value: number | string) {
  const date = typeof value === "number" ? new Date(value) : new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? "" : dateFormat.format(date);
}

function formatDuration(ms: number) {
  if (ms <= 0) return "No time recorded";
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function formatReadyTime(ms: number | null) {
  if (ms === null) return "—";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)}s`;
}

function action(label: string, primary: boolean, run: () => void) {
  const button = el("button", `btn dashboard-action${primary ? " primary" : ""}`, label);
  button.type = "button";
  button.addEventListener("click", run);
  return button;
}

function summary(profile: Profile) {
  const list = el("dl", "dashboard-stats");
  const stats = [
    ["Personal best", profile.bestWpm ? `${profile.bestWpm} WPM` : "—"],
    ["Average accuracy", profile.races ? `${profile.averageAccuracy}%` : "—"],
    ["Races", String(profile.races)],
    ["Daily streak", `${profile.dailyStreak} day${profile.dailyStreak === 1 ? "" : "s"}`],
    ["First key", formatReadyTime(profile.readyInMs)],
    ["Wins", String(profile.wins)],
  ];
  for (const [label, value] of stats) {
    const item = el("div", "dashboard-stat");
    item.append(el("dt", "dashboard-stat-label", label), el("dd", "dashboard-stat-value", value));
    list.append(item);
  }
  return list;
}

function goals(profile: Profile) {
  const section = el("section", "dashboard-panel dashboard-goals");
  section.setAttribute("aria-labelledby", "dashboard-goals-title");
  const heading = el("div", "dashboard-panel-head");
  heading.append(el("h2", "", "Today’s goals"));
  heading.querySelector("h2")!.id = "dashboard-goals-title";
  const list = el("ul", "dashboard-goal-list");
  if (!profile.goals.length) {
    list.append(el("li", "dashboard-empty", "Your next goals will appear after your first race."));
  } else {
    for (const goal of profile.goals) {
      const item = el("li", "dashboard-goal");
      const row = el("div", "dashboard-goal-copy");
      row.append(el("span", "", goal.label), el("span", "dashboard-goal-value", `${Math.min(goal.current, goal.target)}/${goal.target} ${goal.unit}`));
      const progress = el("progress");
      progress.max = Math.max(1, goal.target);
      progress.value = Math.min(Math.max(0, goal.current), progress.max);
      progress.setAttribute("aria-label", goal.label);
      item.append(row, progress);
      list.append(item);
    }
  }
  section.append(heading, list);
  return section;
}

function records(profile: Profile) {
  const section = el("section", "dashboard-panel dashboard-records");
  section.setAttribute("aria-labelledby", "dashboard-records-title");
  const title = el("h2", "", "Personal records");
  title.id = "dashboard-records-title";
  const list = el("ul", "dashboard-record-list");
  if (!profile.records.length) {
    list.append(el("li", "dashboard-empty", "Finish a race to set your first personal record."));
  } else {
    for (const record of profile.records) {
      const item = el("li", "dashboard-record");
      const copy = el("div");
      copy.append(
        el("strong", "", `${DIFFICULTY[record.difficulty].label} · ${record.wpm} WPM`),
        el("span", "dashboard-meta", `${record.accuracy}% accuracy · ${MODE_LABELS[record.mode]} · ${formatDate(record.at)}`),
      );
      item.append(copy);
      list.append(item);
    }
  }
  section.append(title, list);
  return section;
}

function history(profile: Profile) {
  const section = el("section", "dashboard-panel dashboard-history");
  section.setAttribute("aria-labelledby", "dashboard-history-title");
  const title = el("h2", "", "Recent races");
  title.id = "dashboard-history-title";
  const list = el("ol", "dashboard-history-list");
  if (!profile.history.length) {
    list.append(el("li", "dashboard-empty", "Your finished races will appear here."));
  } else {
    for (const race of profile.history) {
      const item = el("li", "dashboard-history-row");
      const copy = el("div");
      const titleText = race.finished ? `${MODE_LABELS[race.mode]} · ${race.wpm} WPM` : `${MODE_LABELS[race.mode]} · Incomplete`;
      const details = [`${race.accuracy}% accuracy`, formatDuration(race.durationMs), formatDate(race.at)];
      if (race.mode === "multiplayer" && race.won) details.unshift("Won");
      copy.append(el("strong", "", titleText), el("span", "dashboard-meta", details.filter(Boolean).join(" · ")));
      item.append(copy, el("span", "dashboard-xp", `+${race.xp} XP`));
      list.append(item);
    }
  }
  section.append(title, list);
  return section;
}

function standing(entry: CompetitionEntry, weekly: boolean) {
  const item = el("li", `dashboard-standing${entry.isYou ? " is-you" : ""}`);
  const rank = el("span", "dashboard-rank", String(entry.rank));
  const racer = el("span", "dashboard-racer");
  racer.append(el("strong", "", entry.name), el("span", "level", String(entry.level)));
  if (entry.isYou) racer.append(el("span", "dashboard-you", "You"));
  const score = el("span", "dashboard-score");
  score.append(el("strong", "", String(entry.score)), el("span", "dashboard-meta", weekly ? `${entry.days} day${entry.days === 1 ? "" : "s"}` : `${entry.wpm} WPM · ${entry.accuracy}%`));
  item.append(rank, racer, score);
  return item;
}

function competition(titleText: string, competition: Competition, weekly: boolean, participants?: number) {
  const section = el("section", `dashboard-panel dashboard-competition${weekly ? " weekly" : " daily"}`);
  section.setAttribute("aria-label", titleText);
  const head = el("div", "dashboard-panel-head");
  const title = el("div");
  title.append(el("h2", "", titleText));
  const detail = weekly
    ? `Casual · best daily scores since ${formatDate(competition.key)}`
    : `${formatDate(competition.key)} · ${participants ?? competition.entries.length} racer${(participants ?? competition.entries.length) === 1 ? "" : "s"}`;
  title.append(el("p", "dashboard-meta", detail));
  if (weekly) head.append(title, el("span", "dashboard-status", "Builds from daily"));
  else head.append(title);
  const list = el("ol", "dashboard-standings");
  if (!competition.entries.length) {
    list.append(el("li", "dashboard-empty", weekly ? "Complete daily challenges to start the weekly table." : "No daily scores yet. Set the first one."));
  } else {
    for (const entry of competition.entries) list.append(standing(entry, weekly));
  }
  section.append(head, list);
  return section;
}

export function renderDashboard(root: HTMLElement, profile: Profile, competitions: Competitions, callbacks: DashboardCallbacks) {
  const header = el("header", "dashboard-header");
  const intro = el("div");
  intro.append(
    el("p", "eyebrow", `Level ${profile.level} · ${profile.xp} XP`),
    el("h2", "dashboard-name", profile.name),
    el("p", "hint", `${profile.practiceRaces} practice race${profile.practiceRaces === 1 ? "" : "s"} · ${profile.dailyRaces} daily challenge${profile.dailyRaces === 1 ? "" : "s"}`),
  );
  const actions = el("div", "dashboard-actions");
  actions.append(action("Play today’s challenge", true, callbacks.onDaily), action("Practice", false, callbacks.onPractice));
  if (callbacks.onGhost && profile.ghostReady) actions.append(action("Race your best", false, callbacks.onGhost));
  const best = profile.records.reduce<RecordEntry | null>((current, record) => (!current || record.wpm > current.wpm ? record : current), null);
  if (callbacks.onShare && best) actions.append(action("Share personal best", false, () => callbacks.onShare!(best)));
  header.append(intro, actions);

  const main = el("div", "dashboard-grid");
  main.append(goals(profile), records(profile), history(profile));
  const boards = el("div", "dashboard-competition-grid");
  boards.append(
    competition("Today’s challenge", competitions.daily, false, competitions.daily.participants),
    competition("This week", competitions.weekly, true),
  );
  root.replaceChildren(header, summary(profile), main, boards);
}
