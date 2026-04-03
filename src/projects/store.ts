import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "../utils.js";
import { parseJsonWithJson5Fallback } from "../utils/parse-json-compat.js";
import type { ProjectsStoreFile } from "./types.js";

export const DEFAULT_PROJECTS_DIR = path.join(CONFIG_DIR, "projects");
export const DEFAULT_PROJECTS_STORE_PATH = path.join(DEFAULT_PROJECTS_DIR, "projects.json");

const serializedStoreCache = new Map<string, string>();

export function resolveProjectsStorePath(storePath?: string) {
  if (storePath?.trim()) {
    const raw = storePath.trim();
    if (raw.startsWith("~")) {
      return path.resolve(raw.replace("~", process.env.HOME ?? "/tmp"));
    }
    return path.resolve(raw);
  }
  return DEFAULT_PROJECTS_STORE_PATH;
}

export async function loadProjectsStore(storePath: string): Promise<ProjectsStoreFile> {
  try {
    const raw = await fs.promises.readFile(storePath, "utf-8");
    let parsed: unknown;
    try {
      parsed = parseJsonWithJson5Fallback(raw);
    } catch (err) {
      throw new Error(`Failed to parse projects store at ${storePath}: ${String(err)}`, {
        cause: err,
      });
    }
    const parsedRecord =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    const templates = Array.isArray(parsedRecord.templates)
      ? (parsedRecord.templates as never[])
      : [];
    const executions = Array.isArray(parsedRecord.executions)
      ? (parsedRecord.executions as never[])
      : [];
    const activeTemplateId =
      typeof parsedRecord.activeTemplateId === "string" ? parsedRecord.activeTemplateId : null;

    let store: ProjectsStoreFile;
    if (parsedRecord.version === 3) {
      store = {
        version: 3,
        templates: templates.filter(Boolean) as unknown as ProjectsStoreFile["templates"],
        executions: executions.filter(Boolean) as unknown as ProjectsStoreFile["executions"],
        activeTemplateId,
      };
    } else {
      // Migrate v1/v2 to v3
      const oldProjects = Array.isArray(parsedRecord.projects) ? parsedRecord.projects : templates;
      let migratedTemplates = oldProjects.map((item: unknown) => {
        const p = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
        return {
          ...p,
          id: typeof p.id === "string" ? p.id : randomBytes(8).toString("hex"),
          name: typeof p.name === "string" ? p.name : "Migrated Project",
          createdAt: typeof p.createdAt === "number" ? p.createdAt : Date.now(),
          updatedAt: typeof p.updatedAt === "number" ? p.updatedAt : Date.now(),
        };
      });

      const migratedExecutions = executions.filter(Boolean).map((exec: unknown) => {
        const e = (exec && typeof exec === "object" ? exec : {}) as Record<string, unknown>;
        return {
          ...e,
          steps: Array.isArray(e.steps) ? e.steps : [],
        };
      });

      store = {
        version: 3,
        templates: migratedTemplates as unknown as ProjectsStoreFile["templates"],
        executions: migratedExecutions as unknown as ProjectsStoreFile["executions"],
        activeTemplateId:
          typeof parsedRecord.activeProjectId === "string"
            ? parsedRecord.activeProjectId
            : activeTemplateId,
      };
    }
    serializedStoreCache.set(storePath, JSON.stringify(store, null, 2));
    return store;
  } catch (err) {
    if ((err as { code?: unknown })?.code === "ENOENT") {
      serializedStoreCache.delete(storePath);
      return { version: 3, templates: [], executions: [], activeTemplateId: null };
    }
    throw err;
  }
}

async function setSecureFileMode(filePath: string): Promise<void> {
  await fs.promises.chmod(filePath, 0o600).catch(() => undefined);
}

export async function saveProjectsStore(storePath: string, store: ProjectsStoreFile) {
  const storeDir = path.dirname(storePath);
  await fs.promises.mkdir(storeDir, { recursive: true, mode: 0o700 });
  await fs.promises.chmod(storeDir, 0o700).catch(() => undefined);
  const json = JSON.stringify(store, null, 2);
  const cached = serializedStoreCache.get(storePath);
  if (cached === json) {
    return;
  }

  let previous: string | null = cached ?? null;
  if (previous === null) {
    try {
      previous = await fs.promises.readFile(storePath, "utf-8");
    } catch (err) {
      if ((err as { code?: unknown })?.code !== "ENOENT") {
        throw err;
      }
    }
  }
  if (previous === json) {
    serializedStoreCache.set(storePath, json);
    return;
  }
  const tmp = `${storePath}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  await fs.promises.writeFile(tmp, json, { encoding: "utf-8", mode: 0o600 });
  await setSecureFileMode(tmp);
  if (previous !== null) {
    try {
      const backupPath = `${storePath}.bak`;
      await fs.promises.copyFile(storePath, backupPath);
      await setSecureFileMode(backupPath);
    } catch {
      // best-effort
    }
  }
  await renameWithRetry(tmp, storePath);
  await setSecureFileMode(storePath);
  serializedStoreCache.set(storePath, json);
}

const RENAME_MAX_RETRIES = 3;
const RENAME_BASE_DELAY_MS = 50;

async function renameWithRetry(src: string, dest: string): Promise<void> {
  for (let attempt = 0; attempt <= RENAME_MAX_RETRIES; attempt++) {
    try {
      await fs.promises.rename(src, dest);
      return;
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "EBUSY" && attempt < RENAME_MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, RENAME_BASE_DELAY_MS * 2 ** attempt));
        continue;
      }
      if (code === "EPERM" || code === "EEXIST") {
        await fs.promises.copyFile(src, dest);
        await fs.promises.unlink(src).catch(() => {});
        return;
      }
      throw err;
    }
  }
}
