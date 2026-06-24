export function resolveKioskAssetUrl(url: string) {
  if (/^(https?:|data:|blob:|file:|ws:|wss:)/i.test(url)) return url;

  if (window.location.protocol === "file:" && url.startsWith("/")) {
    return `.${url}`;
  }

  return url;
}
