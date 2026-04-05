import { t } from "../i18n/index.ts";
import type { IconName } from "./icons.js";

export const TAB_GROUPS = [
  { label: "projectTemplates", tabs: ["projects"] },
  { label: "projectExecute", tabs: ["autoTestRun"] },
  { label: "chat", tabs: ["chatGeneral", "chatProject"] },
  /** Dynamic execution links (recent runs); no static tabs — see `renderProjectRunNavItems`. */
  { label: "projectRun", tabs: [] },
  { label: "agent", tabs: ["agents", "skills", "nodes"] },
  {
    label: "control",
    tabs: ["channels"],
  },
  {
    label: "settings",
    tabs: [
      "config",
      "communications",
      "appearance",
      "automation",
      "infrastructure",
      "aiAgents",
      "debug",
      "logs",
    ],
  },
] as const;

export type Tab =
  | "projects"
  | "autoTestRun"
  | "agents"
  | "overview"
  | "channels"
  | "instances"
  | "sessions"
  | "usage"
  | "cron"
  | "skills"
  | "nodes"
  | "chatGeneral"
  | "chatProject"
  | "chatProjectRun"
  | "config"
  | "communications"
  | "appearance"
  | "automation"
  | "infrastructure"
  | "aiAgents"
  | "debug"
  | "logs";

const TAB_PATHS: Record<Tab, string> = {
  projects: "/projects",
  autoTestRun: "/runs",
  agents: "/agents",
  overview: "/overview",
  channels: "/channels",
  instances: "/instances",
  sessions: "/sessions",
  usage: "/usage",
  cron: "/cron",
  skills: "/skills",
  nodes: "/nodes",
  chatGeneral: "/chat/general",
  chatProject: "/chat/project",
  chatProjectRun: "/chat/project/run",
  config: "/config",
  communications: "/communications",
  appearance: "/appearance",
  automation: "/automation",
  infrastructure: "/infrastructure",
  aiAgents: "/ai-agents",
  debug: "/debug",
  logs: "/logs",
};

const PATH_TO_TAB = new Map(
  (Object.entries(TAB_PATHS) as [Tab, string][])
    .filter(([tab]) => tab !== "chatProjectRun")
    .map(([tab, path]) => [path, tab]),
);

const PROJECT_RUN_MARKER = "/chat/project/run/";
const UUID_TAIL_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Returns execution id when pathname is `/chat/project/run/<uuid>` (optional base path prefix). */
export function projectRunExecutionIdFromPath(pathname: string, basePath = ""): string | null {
  const base = normalizeBasePath(basePath);
  let path = pathname || "/";
  if (base) {
    if (path === base) {
      path = "/";
    } else if (path.startsWith(`${base}/`)) {
      path = path.slice(base.length);
    }
  }
  const normalized = normalizePath(path).toLowerCase();
  const idx = normalized.indexOf(PROJECT_RUN_MARKER);
  if (idx === -1) {
    return null;
  }
  const tail = normalized.slice(idx + PROJECT_RUN_MARKER.length);
  if (!UUID_TAIL_RE.test(tail)) {
    return null;
  }
  return tail;
}

/** Full URL path for a Project Run tab (one execution). */
export function pathForProjectRunTab(executionId: string, basePath = ""): string {
  const id = executionId.trim();
  const base = normalizeBasePath(basePath);
  const suffix = `${PROJECT_RUN_MARKER}${id}`;
  return base ? `${base}${suffix}` : suffix;
}

export function normalizeBasePath(basePath: string): string {
  if (!basePath) {
    return "";
  }
  let base = basePath.trim();
  if (!base.startsWith("/")) {
    base = `/${base}`;
  }
  if (base === "/") {
    return "";
  }
  if (base.endsWith("/")) {
    base = base.slice(0, -1);
  }
  return base;
}

export function normalizePath(path: string): string {
  if (!path) {
    return "/";
  }
  let normalized = path.trim();
  if (!normalized.startsWith("/")) {
    normalized = `/${normalized}`;
  }
  if (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

export function pathForTab(tab: Tab, basePath = ""): string {
  if (tab === "chatProjectRun") {
    throw new Error(
      "pathForTab: use pathForProjectRunTab(executionId, basePath) for chatProjectRun",
    );
  }
  const base = normalizeBasePath(basePath);
  const path = TAB_PATHS[tab];
  return base ? `${base}${path}` : path;
}

export function tabFromPath(pathname: string, basePath = ""): Tab | null {
  const base = normalizeBasePath(basePath);
  let path = pathname || "/";
  if (base) {
    if (path === base) {
      path = "/";
    } else if (path.startsWith(`${base}/`)) {
      path = path.slice(base.length);
    }
  }
  let normalized = normalizePath(path).toLowerCase();
  if (normalized.endsWith("/index.html")) {
    normalized = "/";
  }
  if (normalized === "/") {
    return "chatGeneral";
  }
  // Legacy /chat URLs → General Chat
  if (normalized === "/chat") {
    return "chatGeneral";
  }
  if (projectRunExecutionIdFromPath(pathname, basePath)) {
    return "chatProjectRun";
  }
  return PATH_TO_TAB.get(normalized) ?? null;
}

/** True for both Chat sidebar entries (full chat shell + session UX). */
export function isChatTab(tab: Tab): boolean {
  return tab === "chatGeneral" || tab === "chatProject" || tab === "chatProjectRun";
}

export function inferBasePathFromPathname(pathname: string): string {
  let normalized = normalizePath(pathname);
  if (normalized.endsWith("/index.html")) {
    normalized = normalizePath(normalized.slice(0, -"/index.html".length));
  }
  if (normalized === "/") {
    return "";
  }
  // Legacy `/chat` (no subpath) resolves like root for base-path inference.
  if (normalized === "/chat") {
    return "";
  }
  const prIdx = normalized.toLowerCase().indexOf(PROJECT_RUN_MARKER);
  if (prIdx !== -1) {
    const tail = normalized.slice(prIdx + PROJECT_RUN_MARKER.length);
    if (UUID_TAIL_RE.test(tail)) {
      return prIdx === 0 ? "" : normalizePath(normalized.slice(0, prIdx));
    }
  }
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0) {
    return "";
  }
  for (let i = 0; i < segments.length; i++) {
    const candidate = `/${segments.slice(i).join("/")}`.toLowerCase();
    if (PATH_TO_TAB.has(candidate)) {
      const prefix = segments.slice(0, i);
      return prefix.length ? `/${prefix.join("/")}` : "";
    }
  }
  return `/${segments.join("/")}`;
}

export function iconForTab(tab: Tab): IconName {
  switch (tab) {
    case "projects":
      return "folder";
    case "autoTestRun":
      return "folder";
    case "agents":
      return "folder";
    case "chatGeneral":
    case "chatProject":
    case "chatProjectRun":
      return "messageSquare";
    case "overview":
      return "barChart";
    case "channels":
      return "link";
    case "instances":
      return "radio";
    case "sessions":
      return "fileText";
    case "usage":
      return "barChart";
    case "cron":
      return "loader";
    case "skills":
      return "zap";
    case "nodes":
      return "monitor";
    case "config":
      return "settings";
    case "communications":
      return "send";
    case "appearance":
      return "spark";
    case "automation":
      return "terminal";
    case "infrastructure":
      return "globe";
    case "aiAgents":
      return "brain";
    case "debug":
      return "bug";
    case "logs":
      return "scrollText";
    default:
      return "folder";
  }
}

export function titleForTab(tab: Tab) {
  return t(`tabs.${tab}`);
}

export function subtitleForTab(tab: Tab) {
  return t(`subtitles.${tab}`);
}
