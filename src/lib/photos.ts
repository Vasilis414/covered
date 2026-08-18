import { Directory, File, Paths } from 'expo-file-system';

/**
 * Image picker hands back a URI in the cache directory, which the OS is free to
 * evict. Receipts are the whole point of this app, so copy them somewhere
 * durable. Falls back to the original URI if the copy fails — a photo that
 * might vanish beats no photo at all.
 */
export function persistPhoto(uri: string): string {
  try {
    const dir = new Directory(Paths.document, 'photos');
    if (!dir.exists) dir.create({ intermediates: true });

    const extension = uri.split('.').pop()?.split('?')[0] ?? 'jpg';
    const destination = new File(dir, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`);
    new File(uri).copy(destination);
    return destination.uri;
  } catch {
    return uri;
  }
}

export function deletePhoto(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Orphaned files are harmless; never block a delete on cleanup.
  }
}

/**
 * Rewrites a stored attachment path onto the current app container.
 *
 * iOS hands the app a NEW container id on every reinstall, so the absolute
 * path written by a previous install — .../Application/<old-uuid>/Documents/
 * photos/x.jpg — can never resolve again. The file itself survives an upgrade
 * install; only the prefix moves. Keeping the tail after /Documents/ and
 * rejoining it to today's directory makes an old reference valid again.
 *
 * Anything that is not a local Documents path (remote URLs, ph:// assets) is
 * returned untouched.
 */
export function resolvePhotoUri(uri: string): string {
  if (!uri || !uri.startsWith('file://')) return uri;

  const marker = '/Documents/';
  const index = uri.indexOf(marker);
  if (index === -1) return uri;

  const relative = uri.slice(index + marker.length);
  const base = Paths.document.uri.endsWith('/') ? Paths.document.uri : `${Paths.document.uri}/`;
  const rebuilt = `${base}${relative}`;
  return rebuilt === uri ? uri : rebuilt;
}

/** Convenience for the arrays every item carries. */
export function resolvePhotoUris(uris: string[] | undefined): string[] {
  return (uris ?? []).map(resolvePhotoUri);
}
