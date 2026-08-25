import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

/**
 * Apple's Quick Look, for photos and PDFs.
 *
 * QLPreviewController is what Files, Mail and Messages use, so an attachment
 * opens the way people already expect — pinch to zoom, page between files,
 * share, mark up and print from the bar. There is no Expo module for it, hence
 * the local one in `modules/quick-look`.
 *
 * Optional on purpose: `requireOptionalNativeModule` returns null rather than
 * throwing on Android, on web, and in any build made before this module
 * existed, so callers fall back to the in-app viewer instead of crashing.
 */
type QuickLookNativeModule = {
  canPreview: (uri: string) => boolean;
  presentAsync: (uris: string[], startIndex: number, title: string | null) => Promise<void>;
};

const native = requireOptionalNativeModule<QuickLookNativeModule>('QuickLook');

/** Whether Quick Look can be used at all on this build and platform. */
export const quickLookAvailable = Platform.OS === 'ios' && native != null;

/** Whether Quick Look can render this particular file. */
export function canQuickLook(uri: string): boolean {
  if (!native) return false;
  try {
    return native.canPreview(uri);
  } catch {
    return false;
  }
}

/**
 * Opens the native previewer.
 *
 * Returns false when it could not be shown, so the caller can fall back rather
 * than leaving the user looking at nothing after a tap.
 */
export async function presentQuickLook(
  uris: string[],
  startIndex = 0,
  title?: string,
): Promise<boolean> {
  if (!native || uris.length === 0) return false;
  try {
    await native.presentAsync(uris, startIndex, title ?? null);
    return true;
  } catch (error) {
    console.warn('[QuickLook] present failed:', error);
    return false;
  }
}
