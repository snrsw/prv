import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_SEND_MODE, type SendMode } from "./sendMode";

/**
 * Per-composer Send-mode state shared by the diff chat and inline threads:
 * the chosen mode (Read only by default), the one-time confirmation before
 * the first Write send of a conversation, and the diff refresh once a Write
 * turn has finished.
 *
 * `submit(doSend)` runs the send now, or parks it behind the confirmation the
 * first time the mode is Write; `confirm` releases the parked send and
 * remembers the answer for this conversation, `cancel` drops it without
 * changing the mode. The parked closure holds the input as it was, which is
 * what the user saw when they pressed Send — the composer is hidden behind
 * the dialog meanwhile, so it cannot drift.
 */
export function useSendMode(streaming: boolean, onApplied: () => void) {
  const [mode, setMode] = useState<SendMode>(DEFAULT_SEND_MODE);
  const [confirming, setConfirming] = useState(false);
  const confirmedRef = useRef(false);
  const parkedRef = useRef<(() => void) | null>(null);
  const applyPendingRef = useRef(false);

  // When a Write turn finishes, refresh the diff so the edits show.
  const wasStreaming = useRef(false);
  useEffect(() => {
    if (wasStreaming.current && !streaming && applyPendingRef.current) {
      applyPendingRef.current = false;
      onApplied();
    }
    wasStreaming.current = streaming;
  }, [streaming, onApplied]);

  const submit = useCallback(
    (doSend: () => void) => {
      if (mode !== "apply") {
        doSend();
        return;
      }
      if (!confirmedRef.current) {
        parkedRef.current = doSend;
        setConfirming(true);
        return;
      }
      applyPendingRef.current = true;
      doSend();
    },
    [mode],
  );

  const confirm = useCallback(() => {
    confirmedRef.current = true;
    setConfirming(false);
    const doSend = parkedRef.current;
    parkedRef.current = null;
    if (!doSend) return;
    applyPendingRef.current = true;
    doSend();
  }, []);

  const cancel = useCallback(() => {
    parkedRef.current = null;
    setConfirming(false);
  }, []);

  return { mode, setMode, confirming, submit, confirm, cancel };
}
