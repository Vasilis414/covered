import { presentQuickLook, quickLookAvailable } from '@/../modules/quick-look';

/**
 * Opens an attachment in Apple's previewer, falling back to the in-app viewers.
 *
 * Quick Look is what Files, Mail and Messages use, so a receipt or ticket opens
 * with the gestures and the share, markup and print controls people already
 * know — and it pages between a whole item's attachments rather than treating
 * photos and PDFs as two separate viewers.
 *
 * The fallback is not decoration. Quick Look is iOS-only, it is absent from
 * builds made before the native module existed, and it refuses file types it
 * cannot render. In every one of those cases a tap must still open something.
 */
export async function openAttachment(
  uris: string[],
  index: number,
  fallback: () => void,
): Promise<void> {
  if (!quickLookAvailable || uris.length === 0) {
    fallback();
    return;
  }

  const shown = await presentQuickLook(uris, index);
  if (!shown) fallback();
}
