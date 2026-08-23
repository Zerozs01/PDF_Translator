import { useEffect, useRef } from 'react';

export const useSyncScroll = () => {
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const isSyncing = useRef(false);

  useEffect(() => {
    const left = leftRef.current;
    const right = rightRef.current;
    if (!left || !right) return;

    const sync = (source: HTMLDivElement, target: HTMLDivElement) => {
      if (isSyncing.current) return;
      isSyncing.current = true;

      window.requestAnimationFrame(() => {
        const sourceScrollableArea = source.scrollHeight - source.clientHeight;
        const targetScrollableArea = target.scrollHeight - target.clientHeight;

        if (sourceScrollableArea <= 0) {
          isSyncing.current = false;
          return;
        }

        // 1. Calculate the biological scroll ratio (0.0 to 1.0)
        const scrollRatio = source.scrollTop / sourceScrollableArea;

        // 2. Apply the exact ratio to the target's anatomy
        target.scrollTop = scrollRatio * targetScrollableArea;

        // 3. Release the synaptic lock after a brief refractory period
        setTimeout(() => {
          isSyncing.current = false;
        }, 50);
      });
    };

    const handleLeftScroll = () => sync(left, right);
    const handleRightScroll = () => sync(right, left);

    left.addEventListener('scroll', handleLeftScroll, { passive: true });
    right.addEventListener('scroll', handleRightScroll, { passive: true });

    return () => {
      left.removeEventListener('scroll', handleLeftScroll);
      right.removeEventListener('scroll', handleRightScroll);
    };
  }, []);

  return { leftRef, rightRef };
};
