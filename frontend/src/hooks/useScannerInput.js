import { useEffect, useRef, useState, useCallback } from 'react';

export default function useScannerInput({
  onScan,
  terminator = 'Enter',
  minLength = 4,
  dedupMs = 500,
  inactivityMs = 100,
  enabled = true,
}) {
  const bufferRef = useRef('');
  const lastScanRef = useRef({ code: '', at: 0 });
  const inactivityTimerRef = useRef(null);
  const [focused, setFocused] = useState(false);
  const [lastScan, setLastScan] = useState(null);

  const flush = useCallback(() => {
    const code = bufferRef.current.trim();
    bufferRef.current = '';
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    }
    if (code.length < minLength) return;
    const now = Date.now();
    if (lastScanRef.current.code === code && now - lastScanRef.current.at < dedupMs) return;
    lastScanRef.current = { code, at: now };
    setLastScan({ code, at: now });
    onScan?.(code);
  }, [onScan, minLength, dedupMs]);

  useEffect(() => {
    if (!enabled) return;
    const isTextField = (el) => {
      if (!el) return false;
      const tag = el.tagName;
      if (tag === 'INPUT' && el.type !== 'hidden' && !el.dataset.scanner) return true;
      if (tag === 'TEXTAREA') return true;
      if (el.isContentEditable) return true;
      return false;
    };

    const onKey = (e) => {
      if (isTextField(document.activeElement)) return;
      if (e.key === terminator) {
        e.preventDefault();
        flush();
        return;
      }
      if (e.key.length === 1) {
        bufferRef.current += e.key;
        if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
        inactivityTimerRef.current = setTimeout(flush, inactivityMs);
      }
    };

    document.addEventListener('keydown', onKey);
    setFocused(true);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
      setFocused(false);
    };
  }, [terminator, inactivityMs, enabled, flush]);

  return { focused, lastScan };
}
