import React from 'react';

export interface PDFCanvasNavigationState {
  isUserInteracting: boolean;
  userInteractionTimer: ReturnType<typeof setTimeout> | null;
  activePageChangeTimeout: ReturnType<typeof setTimeout> | null;
  lastPageUpdateTime: number;
  pendingPage: number;
  isObserverTriggeredPageChange: boolean;
}

export const PDFCanvasNavigationContext = React.createContext<{
  navigationStateRef: React.MutableRefObject<PDFCanvasNavigationState>;
  isProgrammaticScrollRef: React.MutableRefObject<boolean>;
} | null>(null);
