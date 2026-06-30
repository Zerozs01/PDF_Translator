import { useEffect, useState } from 'react';
import type { GlobalLoadingState } from '../stores/useUIStore';

type UseTranslationLoadingStateOptions = {
  isAiProcessing: boolean;
  isOfflineProcessing: boolean;
  isDownloadingResult: boolean;
  setLoadingState: (state: GlobalLoadingState | null) => void;
};

export function useTranslationLoadingState({
  isAiProcessing,
  isOfflineProcessing,
  isDownloadingResult,
  setLoadingState,
}: UseTranslationLoadingStateOptions): number | null {
  const [translationStartTime, setTranslationStartTime] = useState<number | null>(null);

  useEffect(() => {
    if (isAiProcessing || isOfflineProcessing) {
      if (translationStartTime === null) {
        setTranslationStartTime(Date.now());
      }
    } else {
      setTranslationStartTime(null);
    }
  }, [isAiProcessing, isOfflineProcessing, translationStartTime]);

  useEffect(() => {
    if (isAiProcessing) {
      setLoadingState({
        active: true,
        message: 'กำลังแปลภาษาด้วย AI (Gemini)...',
      });
    } else if (isDownloadingResult) {
      setLoadingState({
        active: true,
        message: 'กำลังรวบรวมไฟล์และส่งออก (Export)...',
      });
    } else {
      setLoadingState(null);
    }
  }, [isAiProcessing, isOfflineProcessing, isDownloadingResult, setLoadingState]);

  return translationStartTime;
}
