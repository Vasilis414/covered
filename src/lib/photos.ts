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
