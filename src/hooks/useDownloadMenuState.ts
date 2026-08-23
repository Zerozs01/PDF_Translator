import { useEffect, useRef, useState } from 'react';
import type { OCREngine } from '../types';

export type DownloadScope = 'current' | 'all';
export type DownloadContentMode = 'original' | 'translated';

export function useDownloadMenuState() {
  const [isDownloadMenuOpen, setIsDownloadMenuOpen] = useState(false);
  const [downloadScopeSelection, setDownloadScopeSelection] = useState<DownloadScope>('current');
  const [downloadModeSelection, setDownloadModeSelection] = useState<DownloadContentMode>('original');
  const [selectedExportEngine, setSelectedExportEngine] = useState<OCREngine | null>(null);
  const [isDownloadingResult, setIsDownloadingResult] = useState(false);
  const [exportCacheHydrationTick, setExportCacheHydrationTick] = useState(0);
  const downloadMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isDownloadMenuOpen) return undefined;

    const handlePointerDown = (event: MouseEvent) => {
      const targetNode = event.target as Node | null;
      if (downloadMenuRef.current && targetNode && !downloadMenuRef.current.contains(targetNode)) {
        setIsDownloadMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsDownloadMenuOpen(false);
      }
    };

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [isDownloadMenuOpen]);

  return {
    isDownloadMenuOpen,
    setIsDownloadMenuOpen,
    downloadScopeSelection,
    setDownloadScopeSelection,
    downloadModeSelection,
    setDownloadModeSelection,
    selectedExportEngine,
    setSelectedExportEngine,
    isDownloadingResult,
    setIsDownloadingResult,
    exportCacheHydrationTick,
    setExportCacheHydrationTick,
    downloadMenuRef,
  };
}
