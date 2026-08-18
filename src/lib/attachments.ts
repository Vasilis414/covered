/**
 * Attachments are stored as plain file uris, with the kind inferred from the
 * extension rather than a parallel metadata field. Keeping one `photoUris`
 * array means backup, restore and the existing UI all keep working, and there
 * is no second source of truth to drift.
 */

export function isPdf(uri: string): boolean {
  return /\.pdf($|\?)/i.test(uri);
}

export function mimeTypeFor(uri: string): string {
  const extension = uri.split('.').pop()?.split('?')[0]?.toLowerCase();
  if (extension === 'pdf') return 'application/pdf';
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'heic' || extension === 'heif') return 'image/heic';
  return 'image/jpeg';
}

/** Filename without the storage prefix, for showing on a document tile. */
export function displayName(uri: string): string {
  const raw = decodeURIComponent(uri.split('/').pop() ?? 'Document');
  // Stored files are prefixed with a timestamp to keep them unique.
  return raw.replace(/^\d+-[a-z0-9]{6}\./i, 'Document.');
}

/**
 * The reverse of mimeTypeFor, for files that arrive over the network.
 *
 * A synced attachment is fetched from /storage/file/<uuid>, a URL that carries
 * no extension at all. iOS decides what a file *is* from its extension, so a
 * cached copy has to be given one before it can be shared or opened.
 */
export function extensionForMime(mimeType: string): string {
  const type = mimeType.split(';')[0].trim().toLowerCase();
  switch (type) {
    case 'application/pdf':
      return 'pdf';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/heic':
    case 'image/heif':
      return 'heic';
    default:
      return 'jpg';
  }
}
