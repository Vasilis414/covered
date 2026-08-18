import { useEffect, useRef, useState } from 'react';

import { type UpsellReason } from '@/components/upsell-sheet';
import { useAuth } from '@/store/auth';

/**
 * Shared by both tab layouts (`_layout.tsx` and `_layout.ios.tsx`), so the
 * prompt behaves identically no matter which tab bar is mounted.
 */
export function useSignInPrompt() {
  const { ready, signedIn } = useAuth();
  const [prompt, setPrompt] = useState<UpsellReason>(null);
  /**
   * A ref, not state, and deliberately so: this guard is written from inside
   * the effect below. As state it was also a dependency, so setting it
   * re-ran the effect, and the re-run's cleanup cleared the pending timer
   * before it could fire — the prompt never appeared at all.
   */
  const asked = useRef(false);

  /**
   * Ask on launch rather than mid-task.
   *
   * This used to appear right after a photo was attached, which interrupted
   * the scan that was already running. Opening the app is a moment with
   * nothing in flight.
   */
  useEffect(() => {
    if (!ready || signedIn || asked.current) return;
    asked.current = true;
    const timer = setTimeout(() => setPrompt('signin'), 600);
    return () => clearTimeout(timer);
  }, [ready, signedIn]);

  return { prompt, clearPrompt: () => setPrompt(null) };
}
