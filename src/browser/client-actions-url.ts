export function buildProfileQuery(profile?: string, headless?: boolean): string {
  const q = new URLSearchParams();
  if (profile) {
    q.set("profile", profile);
  }
  if (typeof headless === "boolean") {
    q.set("headless", String(headless));
  }
  const built = q.toString();
  return built ? `?${built}` : "";
}

export function withBaseUrl(baseUrl: string | undefined, path: string): string {
  const trimmed = baseUrl?.trim();
  if (!trimmed) {
    return path;
  }
  return `${trimmed.replace(/\/$/, "")}${path}`;
}
