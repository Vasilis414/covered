import { DestinationChooser } from '@/components/destination-chooser';

/**
 * The share-intent hook, loaded defensively.
 *
 * It reaches for a native module, and requiring it throws during module init
 * when that module isn't in the binary — a throw that escapes any try/catch
 * around the call site, exactly like Google Sign-In and ML Kit. So the require
 * is guarded here and the sheet becomes a no-op when the extension isn't built,
 * which is the case until the iOS share extension can be signed (App Groups
 * need a paid Apple Developer account).
 */
type ShareIntentHook = () => {
  hasShareIntent: boolean;
  shareIntent: { files: { path: string; fileName: string }[] | null } | null;
  resetShareIntent: () => void;
};

let useShareIntent: ShareIntentHook | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  useShareIntent = require('expo-share-intent/build/useShareIntent').default as ShareIntentHook;
} catch {
  useShareIntent = null;
}

/**
 * Bridges the OS share sheet to the in-app destination chooser.
 *
 * When another app shares a photo or PDF into Covered, this catches it and
 * hands the path to the same chooser the in-app "Add from a file" button uses.
 * With no native module present it renders nothing, so the app runs unchanged
 * until the share extension can be built.
 */
export function ShareIntentSheet() {
  // Constant for the life of the process, so this early return never changes
  // the hook order below it.
  if (!useShareIntent) return null;
  return <ShareIntentBridge />;
}

function ShareIntentBridge() {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent!();
  const path = hasShareIntent ? (shareIntent?.files?.[0]?.path ?? null) : null;

  return <DestinationChooser filePath={path} onClose={() => resetShareIntent()} />;
}
