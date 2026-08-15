import Constants from 'expo-constants';
import { getLocales } from 'expo-localization';
import { NativeModules } from 'react-native';

import { reconstructRows } from '@/lib/ocr-layout';
import { parseReceipt, type ReceiptScan } from '@/lib/receipt-parse';

/** Regions that write dates month-first, used to break ties like 03/04. */
const MONTH_FIRST = new Set(['US', 'PH', 'FM', 'MH', 'PW']);

type Frame = { top: number; left: number; height: number };
type MlKitLine = { text?: string; frame?: Frame };
type MlKitBlock = { lines?: MlKitLine[] };
type Recognizer = {
  recognize: (uri: string) => Promise<{ text?: string; blocks?: MlKitBlock[] }>;
};

/**
 * ML Kit is a native module, so it exists in a dev build and never in Expo Go.
 * Resolved lazily and defensively: without it the app still runs, photos still
 * attach, and only the auto-fill goes quiet.
 *
 * The check has to be on NativeModules rather than on the JS wrapper — the
 * package always exports a `recognize` function and only throws when it's
 * called, so probing the export would report OCR as available everywhere.
 */
function getRecognizer(): Recognizer | null {
  // Same hazard as Google Sign-In: requiring a custom native module inside
  // Expo Go throws from module init, past any try/catch around the require.
  if (Constants.executionEnvironment === 'storeClient') return null;
  if (!NativeModules.TextRecognition) return null;

  try {
    const module = require('@react-native-ml-kit/text-recognition');
    const recognizer = module?.default ?? module;
    return typeof recognizer?.recognize === 'function' ? (recognizer as Recognizer) : null;
  } catch {
    return null;
  }
}

export function isOcrAvailable(): boolean {
  return getRecognizer() !== null;
}

/** Reads a receipt photo. Returns null when OCR is unavailable or finds nothing. */
export async function scanReceipt(uri: string): Promise<ReceiptScan | null> {
  const recognizer = getRecognizer();
  if (!recognizer) return null;

  try {
    const result = await recognizer.recognize(uri);

    // Prefer geometry-rebuilt rows; fall back to the flat text if this build of
    // ML Kit gave us no bounding boxes.
    const positioned = (result?.blocks ?? [])
      .flatMap((block) => block.lines ?? [])
      .flatMap((line) =>
        line.frame && line.text
          ? [{ text: line.text, top: line.frame.top, height: line.frame.height, left: line.frame.left }]
          : [],
      );

    const text = positioned.length > 0
      ? reconstructRows(positioned).join('\n')
      : (result?.text?.trim() ?? '');

    if (!text) return null;

    const region = getLocales()[0]?.regionCode ?? '';
    return parseReceipt(text, { prefersMonthFirst: MONTH_FIRST.has(region) });
  } catch {
    // A failed scan is never worth interrupting the user over.
    return null;
  }
}
