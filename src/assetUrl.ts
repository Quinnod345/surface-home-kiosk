export function resolveKioskAssetUrl(url: string) {
  if (/^[a-z][a-z\d+\-.]*:/i.test(url)) return url;

  if (window.location.protocol === "file:" && url.startsWith("/")) {
    return `.${url}`;
  }

  if (window.location.protocol === "kiosk:" && url.startsWith("/")) {
    return `${window.location.origin}${url}`;
  }

  return url;
}
