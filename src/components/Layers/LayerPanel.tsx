/**
 * LayerPanel — Canva/Figma-style Layer Management Panel
 * 
 * แสดงรายการ groups + layers แบบ tree view
 * พร้อม visibility/lock toggle ตาม reference จาก Canva
 */

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Eye,
  EyeOff,
  Lock,
  Unlock,
  ChevronDown,
  ChevronRight,
  Layers,
  MessageCircle,
  Zap,
  FileText,
  Package,
  RefreshCw,
  Trash2,
  Copy,
  Check,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useLayerStore } from '../../stores/useLayerStore';
import { useOCRTextLayerStore } from '../../stores/useOCRTextLayerStore';
import { useProjectStore } from '../../stores/useProjectStore';
import { buildLayerGroupsFromOCR, mergeLayersAndGroups } from '../../services/layers/LayerGroupingService';
import { resolveTranslationOverlayContext } from '../OCR/translationOverlayUtils';
import { filterGhostTextLayers } from '../../services/layers/layerGhostFilter';
import type { TextLayer, TextLayerGroup, LayerGroupType } from '../../types/layers';
import type { OCREngine } from '../../types';

const GROUP_TYPE_ICONS: Record<LayerGroupType, React.ReactNode> = {
  balloon: <MessageCircle size={11} />,
  sfx: <Zap size={11} />,
  narration: <FileText size={11} />,
  document: <FileText size={11} />,
  ungrouped: <Package size={11} />,
};

const GROUP_TYPE_LABELS: Record<LayerGroupType, string> = {
  balloon: 'Balloon',
  sfx: 'SFX',
  narration: 'Narration',
  document: 'Document',
  ungrouped: 'Ungrouped',
};

const EMPTY_LAYERS: TextLayer[] = [];
const EMPTY_GROUPS: TextLayerGroup[] = [];

const truncateText = (text: string, maxLen: number = 28): string => {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen - 1) + '…';
};

/** Single layer row */
const LayerRow: React.FC<{
  layer: TextLayer;
  index: number;
  pageNum: number;
  isSelected: boolean;
  isHovered: boolean;
  groupColor: string;
  onActivateLayerPanel?: () => void;
}> = React.memo(({ layer, index, pageNum, isSelected, isHovered, groupColor, onActivateLayerPanel }) => {
  const toggleLayerVisibility = useLayerStore((s) => s.toggleLayerVisibility);
  const selectLayer = useLayerStore((s) => s.selectLayer);
  const setHoveredLayer = useLayerStore((s) => s.setHoveredLayer);
  const deleteLayer = useLayerStore((s) => s.deleteLayer);
  const activeDragItem = useLayerStore((s) => s.activeDragItem);
  const setActiveDragItem = useLayerStore((s) => s.setActiveDragItem);
  const moveLayerToGroup = useLayerStore((s) => s.moveLayerToGroup);

  const translationPreviewMode = useOCRTextLayerStore((state) => state.translationPreviewMode);
  const [isDragOver, setIsDragOver] = React.useState(false);
  const [isCopied, setIsCopied] = React.useState(false);

  const textToCopy = translationPreviewMode === 'original'
    ? layer.sourceText || layer.text
    : layer.text;

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!textToCopy) return;
    void navigator.clipboard.writeText(textToCopy);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 1500);
  };

  // Instant snap scroll into view when selected (Zero animation delay)
  useEffect(() => {
    if (isSelected) {
      const el = document.getElementById(`layer-row-${layer.id}`);
      if (el) {
        el.scrollIntoView({
          behavior: 'auto',
          block: 'nearest',
        });
      }
    }
  }, [isSelected, layer.id]);

  const isBeingDragged = activeDragItem?.type === 'layer' && activeDragItem.id === layer.id;

  const handleDragStart = (e: React.DragEvent) => {
    if (layer.locked) {
      e.preventDefault();
      return;
    }
    setActiveDragItem({ type: 'layer', id: layer.id, index });
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', layer.id);
  };

  const handleDragEnd = () => {
    setActiveDragItem(null);
    setIsDragOver(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (activeDragItem && activeDragItem.type === 'layer' && activeDragItem.id !== layer.id) {
      e.preventDefault();
      setIsDragOver(true);
      e.dataTransfer.dropEffect = 'move';
    }
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (activeDragItem && activeDragItem.type === 'layer') {
      moveLayerToGroup(pageNum, activeDragItem.id, layer.groupId, index);
    }
  };

  return (
    <div
      id={`layer-row-${layer.id}`}
      draggable={!layer.locked}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`group/row flex items-center gap-1.5 pl-6 pr-2 py-1 text-[11px] cursor-pointer transition-all duration-75 relative border-t-2 ${
        isBeingDragged ? 'opacity-30 pointer-events-none' : ''
      } ${
        isDragOver ? 'border-t-[#2B9BFF]' : 'border-t-transparent'
      } ${
        isSelected
          ? 'bg-[#2B9BFF]/18 text-white'
          : isHovered
            ? 'bg-white/6 text-slate-200'
            : 'text-slate-400 hover:bg-white/4 hover:text-slate-200'
      }`}
      onClick={() => {
        onActivateLayerPanel?.();
        selectLayer(layer.id);
      }}
      onMouseEnter={() => setHoveredLayer(layer.id)}
      onMouseLeave={() => setHoveredLayer(null)}
    >
      {/* Color dot */}
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ backgroundColor: groupColor, opacity: layer.visible ? 1 : 0.3 }}
      />

      {/* Text preview */}
      <span className={`flex-1 truncate select-none ${!layer.visible ? 'opacity-40 line-through' : ''}`}>
        {truncateText(textToCopy)}
      </span>

      {/* BBox info (subtle) */}
      <span className="hidden group-hover/row:inline text-[9px] text-slate-600 font-mono shrink-0">
        {Math.round(layer.bbox.x0)},{Math.round(layer.bbox.y0)}
      </span>

      {/* Delete button (Trash2) */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (confirm('คุณต้องการลบข้อความนี้ใช่หรือไม่? การลบนี้จะเป็นการลบอย่างถาวร')) {
            deleteLayer(pageNum, layer.id);
          }
        }}
        className="p-0.5 rounded transition-colors shrink-0 text-slate-500 hover:text-red-400 opacity-0 group-hover/row:opacity-100"
        title="Delete layer"
      >
        <Trash2 size={10} />
      </button>

      {/* Visibility toggle */}
      <button
        onClick={(e) => { e.stopPropagation(); toggleLayerVisibility(pageNum, layer.id); }}
        className={`p-0.5 rounded transition-colors shrink-0 ${
          layer.visible
            ? 'text-slate-500 hover:text-white opacity-0 group-hover/row:opacity-100'
            : 'text-rose-400/70 hover:text-rose-300'
        }`}
        title={layer.visible ? 'Hide layer' : 'Show layer'}
      >
        {layer.visible ? <Eye size={10} /> : <EyeOff size={10} />}
      </button>

      {/* Copy button */}
      <button
        onClick={handleCopy}
        className={`p-0.5 rounded transition-colors shrink-0 ${
          isCopied
            ? 'text-emerald-400 opacity-100'
            : 'text-slate-500 hover:text-sky-400 opacity-0 group-hover/row:opacity-100'
        }`}
        title={isCopied ? "คัดลอกข้อความแล้ว" : "คัดลอกข้อความ"}
        aria-label={isCopied ? "คัดลอกข้อความแล้ว" : "คัดลอกข้อความ"}
      >
        {isCopied ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />}
      </button>
    </div>
  );
});

LayerRow.displayName = 'LayerRow';

/** Group header with collapse/expand */
const GroupHeader: React.FC<{
  group: TextLayerGroup;
  index: number;
  pageNum: number;
  layerCount: number;
  isHovered: boolean;
}> = React.memo(({ group, index, pageNum, layerCount, isHovered }) => {
  const toggleGroupVisibility = useLayerStore((s) => s.toggleGroupVisibility);
  const toggleGroupCollapsed = useLayerStore((s) => s.toggleGroupCollapsed);
  const toggleGroupLock = useLayerStore((s) => s.toggleGroupLock);
  const setHoveredGroup = useLayerStore((s) => s.setHoveredGroup);
  const deleteGroup = useLayerStore((s) => s.deleteGroup);
  const activeDragItem = useLayerStore((s) => s.activeDragItem);
  const setActiveDragItem = useLayerStore((s) => s.setActiveDragItem);
  const moveLayerToGroup = useLayerStore((s) => s.moveLayerToGroup);
  const reorderGroups = useLayerStore((s) => s.reorderGroups);

  const [isDragOver, setIsDragOver] = React.useState<'group' | 'layer' | null>(null);
  const [isGroupCopied, setIsGroupCopied] = React.useState(false);
  const translationPreviewMode = useOCRTextLayerStore((state) => state.translationPreviewMode);
  const pageLayers = useLayerStore((s) => s.layersByPage.get(pageNum) || []);

  const groupLayers = React.useMemo(() => {
    return pageLayers.filter((l) => l.groupId === group.id);
  }, [pageLayers, group.id]);

  const groupFormattedText = React.useMemo(() => {
    const targetLayers = groupLayers && groupLayers.length > 0
      ? groupLayers
      : (pageLayers || []).filter((l) => l.groupId === group.id || (group.layerIds && group.layerIds.includes(l.id)));

    const words = targetLayers
      .map((l) => {
        const textVal = translationPreviewMode === 'original'
          ? (l.sourceText || l.text || '')
          : (l.text || l.sourceText || '');
        return String(textVal || '').trim();
      })
      .filter(Boolean);

    // If words is empty, fallback to non-empty text string or empty array
    return JSON.stringify(words);
  }, [groupLayers, pageLayers, group.id, group.layerIds, translationPreviewMode]);

  const handleCopyGroup = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!groupFormattedText) return;
    void navigator.clipboard.writeText(groupFormattedText);
    setIsGroupCopied(true);
    setTimeout(() => setIsGroupCopied(false), 1500);
  };

  const isBeingDragged = activeDragItem?.type === 'group' && activeDragItem.id === group.id;

  const handleDragStart = (e: React.DragEvent) => {
    if (group.locked) {
      e.preventDefault();
      return;
    }
    setActiveDragItem({ type: 'group', id: group.id, index });
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', group.id);
  };

  const handleDragEnd = () => {
    setActiveDragItem(null);
    setIsDragOver(null);
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (!activeDragItem) return;
    if (activeDragItem.type === 'group' && activeDragItem.id !== group.id) {
      e.preventDefault();
      setIsDragOver('group');
      e.dataTransfer.dropEffect = 'move';
    } else if (activeDragItem.type === 'layer') {
      e.preventDefault();
      setIsDragOver('layer');
      e.dataTransfer.dropEffect = 'move';
    }
  };

  const handleDragLeave = () => {
    setIsDragOver(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const dragType = isDragOver;
    setIsDragOver(null);
    if (!activeDragItem) return;

    if (activeDragItem.type === 'group' && dragType === 'group') {
      reorderGroups(pageNum, activeDragItem.index, index);
    } else if (activeDragItem.type === 'layer' && dragType === 'layer') {
      moveLayerToGroup(pageNum, activeDragItem.id, group.id);
    }
  };

  return (
    <div
      draggable={!group.locked}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`group/header flex items-center gap-1.5 px-2 py-1.5 cursor-pointer transition-all duration-75 border-t-2 relative ${
        isBeingDragged ? 'opacity-30 pointer-events-none' : ''
      } ${
        isDragOver === 'group' ? 'border-t-[#2B9BFF]' : 'border-t-transparent'
      } ${
        isDragOver === 'layer' ? 'bg-[#2B9BFF]/12' : ''
      } ${
        isHovered
          ? 'bg-white/8'
          : 'hover:bg-white/4'
      }`}
      onMouseEnter={() => setHoveredGroup(group.id)}
      onMouseLeave={() => setHoveredGroup(null)}
    >
      {/* Collapse toggle */}
      <button
        onClick={(e) => { e.stopPropagation(); toggleGroupCollapsed(pageNum, group.id); }}
        className="p-0.5 text-slate-500 hover:text-white transition-colors shrink-0"
      >
        {group.collapsed
          ? <ChevronRight size={11} />
          : <ChevronDown size={11} />
        }
      </button>

      {/* Color indicator */}
      <span
        className="w-2 h-2 rounded-sm shrink-0 shadow-sm"
        style={{ backgroundColor: group.color, opacity: group.visible ? 1 : 0.3 }}
      />

      {/* Type icon */}
      <span className={`shrink-0 transition-colors duration-75 ${isDragOver === 'layer' ? 'text-[#2B9BFF]' : group.visible ? 'text-slate-400' : 'text-slate-600'}`}>
        {GROUP_TYPE_ICONS[group.groupType]}
      </span>

      {/* Label */}
      <span
        className={`flex-1 text-[11px] font-medium truncate select-none ${
          group.visible ? 'text-slate-200' : 'text-slate-500 line-through'
        }`}
        onClick={() => toggleGroupCollapsed(pageNum, group.id)}
      >
        {GROUP_TYPE_LABELS[group.groupType]}
        <span className="text-slate-600 font-normal ml-1">({layerCount})</span>
      </span>

      {/* Confidence badge */}
      {group.confidence >= 80 && (
        <span className="text-[8px] font-mono text-emerald-500/70 shrink-0">
          {group.confidence}%
        </span>
      )}

      {/* Delete button (Trash2) */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (confirm('คุณต้องการลบกลุ่มข้อความนี้พร้อมข้อความทั้งหมดในกลุ่มใช่หรือไม่? การลบนี้จะเป็นการลบอย่างถาวร')) {
            deleteGroup(pageNum, group.id);
          }
        }}
        className="p-0.5 rounded transition-colors shrink-0 text-slate-500 hover:text-red-400 opacity-0 group-hover/header:opacity-100"
        title="Delete group"
      >
        <Trash2 size={10} />
      </button>

      {/* Lock toggle */}
      <button
        onClick={(e) => { e.stopPropagation(); toggleGroupLock(pageNum, group.id); }}
        className={`p-0.5 rounded transition-colors shrink-0 ${
          group.locked
            ? 'text-amber-400/80 hover:text-amber-300'
            : 'text-slate-600 hover:text-slate-300 opacity-0 group-hover/header:opacity-100'
        }`}
        title={group.locked ? 'Unlock group' : 'Lock group'}
      >
        {group.locked ? <Lock size={10} /> : <Unlock size={10} />}
      </button>

      {/* Visibility toggle */}
      <button
        onClick={(e) => { e.stopPropagation(); toggleGroupVisibility(pageNum, group.id); }}
        className={`p-0.5 rounded transition-colors shrink-0 ${
          group.visible
            ? 'text-slate-500 hover:text-white'
            : 'text-rose-400/70 hover:text-rose-300'
        }`}
        title={group.visible ? 'Hide group' : 'Show group'}
      >
        {group.visible ? <Eye size={10} /> : <EyeOff size={10} />}
      </button>

      {/* Copy group button */}
      <button
        onClick={handleCopyGroup}
        className={`p-0.5 rounded transition-colors shrink-0 ${
          isGroupCopied
            ? 'text-emerald-400 opacity-100'
            : 'text-slate-400 hover:text-sky-400 opacity-0 group-hover/header:opacity-100'
        }`}
        title={isGroupCopied ? "คัดลอกข้อความทั้งกลุ่มแล้ว" : "คัดลอกข้อความทั้งหมดในกลุ่มนี้"}
        aria-label={isGroupCopied ? "คัดลอกข้อความทั้งกลุ่มแล้ว" : "คัดลอกข้อความทั้งหมดในกลุ่มนี้"}
      >
        {isGroupCopied ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />}
      </button>
    </div>
  );
});

GroupHeader.displayName = 'GroupHeader';

interface LayerPanelProps {
  onActivateLayerPanel?: () => void;
}

/** Main Layer Panel */
export const LayerPanel: React.FC<LayerPanelProps> = ({ onActivateLayerPanel }) => {
  const { currentPage, sourceLanguage, targetLanguage, translationMode } = useProjectStore(
    useShallow((s) => ({
      currentPage: s.currentPage,
      sourceLanguage: s.sourceLanguage,
      targetLanguage: s.targetLanguage,
      translationMode: s.translationMode,
    }))
  );
  const {
    allPagesOCR,
    ocrByPageEngine,
    selectedEngine,
    optionsLanguage,
    translationPreviewMode,
    setTranslationPreviewMode,
    translationCacheByPage,
    activeTranslationKeyByPage,
  } = useOCRTextLayerStore(
    useShallow((s) => ({
      allPagesOCR: s.allPagesOCR,
      ocrByPageEngine: s.ocrByPageEngine,
      selectedEngine: (s.options.engine || 'paddleocr'),
      optionsLanguage: (s.options.language || 'eng'),
      translationPreviewMode: s.translationPreviewMode,
      setTranslationPreviewMode: s.setTranslationPreviewMode,
      translationCacheByPage: s.translationCacheByPage,
      activeTranslationKeyByPage: s.activeTranslationKeyByPage,
    }))
  );

  const resolveEngineScopedPageOCR = (pageNum: number) => {
    const byEngine = ocrByPageEngine.get(pageNum)?.get(selectedEngine);
    if (byEngine) return { ocr: byEngine, effectiveEngine: selectedEngine };

    const fallback = allPagesOCR.get(pageNum);
    if (!fallback) return undefined;
    const fallbackEngine = (fallback.ocrEngine || selectedEngine);
    return { ocr: fallback, effectiveEngine: fallbackEngine };
  };

  const resolvedPageOCR = resolveEngineScopedPageOCR(currentPage);
  const currentPageOCR = resolvedPageOCR?.ocr;
  const effectiveOCREngine = resolvedPageOCR?.effectiveEngine || selectedEngine;
  const pageOCRsByEngine = ocrByPageEngine.get(currentPage);
  const currentPageTranslationMap = translationCacheByPage.get(currentPage);
  const activeTranslationKey = activeTranslationKeyByPage.get(currentPage);

  const {
    getPageLayers,
    getPageGroups,
    setPageLayers,
    selectedLayerIds,
    hoveredLayerId,
    hoveredGroupId,
    expandGroup,
  } = useLayerStore(
    useShallow((s) => ({
      getPageLayers: s.getPageLayers,
      getPageGroups: s.getPageGroups,
      setPageLayers: s.setPageLayers,
      selectedLayerIds: s.selectedLayerIds,
      hoveredLayerId: s.hoveredLayerId,
      hoveredGroupId: s.hoveredGroupId,
      expandGroup: s.expandGroup,
    }))
  );

  const pageNum = currentPage;
  const rawLayers = useLayerStore((s) => s.layersByPage.get(pageNum) || EMPTY_LAYERS);
  const rawGroups = useLayerStore((s) => s.groupsByPage.get(pageNum) || EMPTY_GROUPS);

  // Real-Time Layer Ghost Noise Filter: surgical cleanup of spiky balloon border layers in Left Panel
  const layers = useMemo(() => {
    return filterGhostTextLayers(rawLayers);
  }, [rawLayers]);

  // Synchronized groups filter to strip ghost layers and drop empty groups
  const groups = useMemo(() => {
    const activeLayerIds = new Set(layers.map(l => l.id));
    return rawGroups.map(group => {
      const filteredLayerIds = group.layerIds.filter(id => activeLayerIds.has(id));
      return { ...group, layerIds: filteredLayerIds };
    }).filter(group => group.layerIds.length > 0);
  }, [rawGroups, layers]);

  // Track engine ล่าสุดที่ใช้ build layers ต่อแต่ละ page
  const lastBuiltEngineRef = useRef<Map<number, string>>(new Map());

  const translationOverlayContext = useMemo(() => resolveTranslationOverlayContext({
    currentPageOCR,
    optionsEngine: effectiveOCREngine as OCREngine,
    optionsLanguage: optionsLanguage,
    translationMode,
    sourceLanguage,
    targetLanguage,
    translationPreviewMode,
    currentPageTranslationMap,
    activeTranslationKey,
    pageOCRsByEngine,
  }), [
    activeTranslationKey,
    currentPageOCR,
    currentPageTranslationMap,
    effectiveOCREngine,
    optionsLanguage,
    sourceLanguage,
    targetLanguage,
    translationMode,
    translationPreviewMode,
    pageOCRsByEngine,
  ]);

  // Auto-expand groups when layers inside them are selected (Figma-style)
  useEffect(() => {
    if (selectedLayerIds.size === 0) return;
    groups.forEach((group) => {
      const hasSelected = group.layerIds.some((id) => selectedLayerIds.has(id));
      if (hasSelected && group.collapsed) {
        expandGroup(pageNum, group.id);
      }
    });
  }, [selectedLayerIds, groups, pageNum, expandGroup]);

  // Handle Delete/Backspace keyboard shortcut to remove selected layers
  const deleteSelectedLayers = useLayerStore((state) => state.deleteSelectedLayers);
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedLayerIds.size > 0) {
        const activeEl = document.activeElement;
        const isTyping = activeEl && (
          activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          (activeEl as HTMLElement).isContentEditable
        );
        if (isTyping) return;

        e.preventDefault();
        deleteSelectedLayers();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedLayerIds, deleteSelectedLayers]);

  // Build layers when OCR data changes
  const handleBuildLayers = useCallback((forceRebuild = false) => {
    if (!currentPageOCR || !currentPageOCR.lines || currentPageOCR.lines.length === 0) return;

    const newEngine = String(currentPageOCR.ocrEngine || 'paddleocr').toLowerCase();
    const lastEngine = lastBuiltEngineRef.current.get(pageNum);

    // ถ้า engine เปลี่ยน → rebuild layers ใหม่ โดยรักษา manual layers ไว้
    if (forceRebuild || !lastEngine || lastEngine !== newEngine) {
      const result = buildLayerGroupsFromOCR(
        currentPageOCR,
        translationPreviewMode === 'translated' ? translationOverlayContext.translatedByIndex : undefined
      );

      if (forceRebuild || !lastEngine) {
        // First build หรือ manual rebuild: set ทันที
        setPageLayers(pageNum, result);
      } else {
        // Engine changed หรือ previewModeChanged: รักษา manual layers + user-edited layers จาก engine เก่า
        const existingLayers = getPageLayers(pageNum);
        const existingGroups = getPageGroups(pageNum);
        const mergedResult = mergeLayersAndGroups(result, existingLayers, existingGroups);
        setPageLayers(pageNum, mergedResult);
      }

      lastBuiltEngineRef.current.set(pageNum, newEngine);
    }
  }, [currentPageOCR, pageNum, setPageLayers, getPageLayers, translationOverlayContext.translatedByIndex, translationPreviewMode]);

  // Auto-sync: When active page changes or OCR data becomes available,
  // immediately build layers if the current page has OCR lines but no layers in store yet.
  useEffect(() => {
    if (currentPageOCR && currentPageOCR.lines && currentPageOCR.lines.length > 0) {
      const existing = getPageLayers(pageNum);
      if (!existing || existing.length === 0) {
        handleBuildLayers(false);
      }
    }
  }, [pageNum, currentPageOCR, getPageLayers, handleBuildLayers]);

  const layerMap = useMemo(() => {
    const map = new Map<string, TextLayer>();
    layers.forEach(l => map.set(l.id, l));
    return map;
  }, [layers]);

  if (!currentPageOCR) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-slate-500 px-4 py-8">
        <Layers size={28} className="mb-2 opacity-40" />
        <p className="text-[11px] text-center leading-relaxed">
          Run OCR first to generate layers
        </p>
      </div>
    );
  }

  if (groups.length === 0 && layers.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-slate-500 px-4 py-6 gap-2">
        <Layers size={24} className="opacity-40" />
        <p className="text-[11px] text-center">No layers detected</p>
        <button
          onClick={() => handleBuildLayers()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/15 bg-slate-900/80 text-[10px] text-slate-300 hover:text-white hover:border-white/25 transition-colors"
        >
          <RefreshCw size={10} />
          Build Layers
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-white/8">
        <div className="flex items-center gap-1.5">
          <Layers size={12} className="text-[#2B9BFF]" />
          <span className="text-[10px] font-semibold text-slate-300 uppercase tracking-wider">
            Layers
          </span>
          <span className="text-[9px] text-slate-600">
            {groups.length}g · {layers.length}l
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setTranslationPreviewMode(translationPreviewMode === 'translated' ? 'original' : 'translated')}
            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all border flex items-center gap-1 ${
              translationPreviewMode === 'original'
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30 shadow-[0_0_8px_rgba(245,158,11,0.2)]'
                : 'bg-sky-500/20 text-sky-300 border-sky-500/40 hover:bg-sky-500/30'
            }`}
            title={translationPreviewMode === 'original'
              ? 'กำลังแสดงผลข้อความต้นฉบับ (Original OCR) - คลิกเพื่อสลับเป็นข้อความแปล'
              : 'กำลังแสดงผลข้อความแปล (Translated) - คลิกเพื่อสลับเป็นข้อความต้นฉบับ'
            }
          >
            <span className={`w-1.5 h-1.5 rounded-full ${translationPreviewMode === 'original' ? 'bg-amber-400' : 'bg-sky-400'}`} />
            <span>{translationPreviewMode === 'original' ? 'Original' : 'Translated'}</span>
          </button>
          <button
            onClick={() => handleBuildLayers(true)}
            className="p-1 rounded text-slate-600 hover:text-white transition-colors"
            title="Rebuild layers from OCR"
          >
            <RefreshCw size={10} />
          </button>
        </div>
      </div>

      {/* Tree view */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {groups.map((group, index) => {
          const groupLayers = group.layerIds
            .map(id => layerMap.get(id))
            .filter((l): l is TextLayer => Boolean(l));

          return (
            <div key={group.id} className="border-b border-white/5">
              <GroupHeader
                group={group}
                index={index}
                pageNum={pageNum}
                layerCount={groupLayers.length}
                isHovered={hoveredGroupId === group.id}
              />

              {/* Layers (when expanded) */}
              {!group.collapsed && (
                <div className="pb-0.5">
                  {groupLayers.map((layer, lIndex) => (
                    <LayerRow
                      key={layer.id}
                      layer={layer}
                      index={lIndex}
                      pageNum={pageNum}
                      isSelected={selectedLayerIds.has(layer.id)}
                      isHovered={hoveredLayerId === layer.id}
                      groupColor={group.color}
                      onActivateLayerPanel={onActivateLayerPanel}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer stats */}
      <div className="px-2 py-1 border-t border-white/8 flex items-center gap-2 text-[9px] text-slate-600">
        <span>Page {pageNum}</span>
        <span>·</span>
        <span>{groups.filter(g => g.groupType === 'balloon').length} balloons</span>
        <span>·</span>
        <span>{groups.filter(g => g.groupType === 'sfx').length} sfx</span>
      </div>
    </div>
  );
};

