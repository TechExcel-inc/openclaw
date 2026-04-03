import { getSafeLocalStorage } from "../../local-storage.ts";
import { normalizeGatewayTokenScope } from "../storage.ts";

const PREFIX = "openclaw.ead.hiddenProjectRunNavIds.v1:";

function storageKey(gatewayUrl: string): string {
  return `${PREFIX}${normalizeGatewayTokenScope(gatewayUrl)}`;
}

export function readHiddenProjectRunNavIds(gatewayUrl: string): string[] {
  try {
    const raw = getSafeLocalStorage()?.getItem(storageKey(gatewayUrl));
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
  } catch {
    return [];
  }
}

export function persistHiddenProjectRunNavIds(gatewayUrl: string, ids: string[]): void {
  try {
    const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
    getSafeLocalStorage()?.setItem(storageKey(gatewayUrl), JSON.stringify(unique));
  } catch {
    /* quota / private mode */
  }
}

export function addHiddenProjectRunNavId(gatewayUrl: string, executionId: string): void {
  const id = executionId.trim();
  if (!id) {
    return;
  }
  const cur = readHiddenProjectRunNavIds(gatewayUrl);
  if (cur.includes(id)) {
    return;
  }
  persistHiddenProjectRunNavIds(gatewayUrl, [...cur, id]);
}
