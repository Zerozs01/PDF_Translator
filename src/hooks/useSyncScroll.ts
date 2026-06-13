import { useEffect, useRef } from 'react';

export const useSyncScroll = () => {
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const left = leftRef.current;
    const right = rightRef.current;
    if (!left || !right) return;

    let isSyncingLeft = false;
    let isSyncingRight = false;

    const handleLeftScroll = () => {
      if (!isSyncingLeft) {
        isSyncingRight = true;
        right.scrollTop = left.scrollTop;
      }
      isSyncingLeft = false;
    };

    const handleRightScroll = () => {
      if (!isSyncingRight) {
        isSyncingLeft = true;
        left.scrollTop = right.scrollTop;
      }
      isSyncingRight = false;
    };

    left.addEventListener('scroll', handleLeftScroll);
    right.addEventListener('scroll', handleRightScroll);

    return () => {
      left.removeEventListener('scroll', handleLeftScroll);
      right.removeEventListener('scroll', handleRightScroll);
    };
  }, []);

  return { leftRef, rightRef };
};
