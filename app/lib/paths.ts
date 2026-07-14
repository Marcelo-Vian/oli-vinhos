const viteEnv = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env;

const baseUrl = viteEnv?.BASE_URL ?? "/";

export function sitePath(path: string) {
  const clean = path.replace(/^\/+/, "");
  return `${baseUrl.replace(/\/?$/, "/")}${clean}`;
}

export function assetUrl(url: string | null | undefined) {
  if (!url || /^(?:https?:|data:|blob:)/i.test(url)) return url ?? "";
  return sitePath(url);
}
