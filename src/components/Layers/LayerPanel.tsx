/**
 * LayerPanel — Canva/Figma-style Layer Management Panel
 * 
 * แสดงรายการ groups + layers แบบ tree view
 * พร้อม visibility/lock toggle ตาม reference จาก Canva
 */

import React, { useCallback, useEffect, useMemo } from 'react';
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
} from 'lucide-react';
import { useLayerStore } from '../../stores/useLayerStore';
import { useOCRTextLayerStore } from '../../stores/useOCRTextLayerStore';
import { useProjectStore } from '../../stores/useProjectStore';
import { buildLayerGroupsFromOCR } from '../../services/layers/LayerGroupingService';
import type { TextLayer, TextLayerGroup, LayerGroupType } from '../../types/layers';

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

const truncateText = (text: string, maxLen: number = 28): string => {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen - 1) + '…';
};

/** Single layer row */
const LayerRow: React.FC<{
  layer: TextLayer;
  pageNum: number;
  isSelected: boolean;
  isHovered: boolean;
  groupColor: string;
}> = ({ layer, pageNum, isSelected, isHovered, groupColor }) => {
  const { toggleLayerVisibility, selectLayer, setHoveredLayer, deleteLayer } = useLayerStore();
  const translationPreviewMode = useOCRTextLayerStore((state) => state.translationPreviewMode);

  return (
    <div
      className={`group/row flex items-center gap-1.5 pl-6 pr-2 py-1 text-[11px] cursor-pointer transition-all duration-100 ${
        isSelected
          ? 'bg-[#2B9BFF]/18 text-white'
          : isHovered
            ? 'bg-white/6 text-slate-200'
            : 'text-slate-400 hover:bg-white/4 hover:text-slate-200'
      }`}
      onClick={() => selectLayer(layer.id)}
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
        {truncateText(
          translationPreviewMode === 'original'
            ? layer.sourceText || layer.text
            : layer.text
        )}
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
    </div>
  );
};

/** Group header with collapse/expand */
const GroupHeader: React.FC<{
  group: TextLayerGroup;
  pageNum: number;
  layerCount: number;
  isHovered: boolean;
}> = ({ group, pageNum, layerCount, isHovered }) => {
  const { toggleGroupVisibility, toggleGroupCollapsed, toggleGroupLock, setHoveredGroup, deleteGroup } = useLayerStore();

  return (
    <div
      className={`flex items-center gap-1.5 px-2 py-1.5 cursor-pointer transition-all duration-100 ${
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
      <span className={`shrink-0 ${group.visible ? 'text-slate-400' : 'text-slate-600'}`}>
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
        className="p-0.5 rounded transition-colors shrink-0 text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100"
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
            : 'text-slate-600 hover:text-slate-300 opacity-0 group-hover:opacity-100'
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
    </div>
  );
};

/** Main Layer Panel */
export const LayerPanel: React.FC = () => {
  const { currentPage } = useProjectStore();
  const { allPagesOCR } = useOCRTextLayerStore();
  const currentPageOCR = allPagesOCR.get(currentPage);
  const {
    getPageLayers,
    getPageGroups,
    setPageLayers,
    selectedLayerIds,
    hoveredLayerId,
    hoveredGroupId,
  } = useLayerStore();

  const pageNum = currentPage;
  const layers = getPageLayers(pageNum);
  const groups = getPageGroups(pageNum);

  // Build layers when OCR data changes
  const handleBuildLayers = useCallback(() => {
    if (!currentPageOCR || !currentPageOCR.lines || currentPageOCR.lines.length === 0) return;
    const result = buildLayerGroupsFromOCR(currentPageOCR);
    setPageLayers(pageNum, result);
  }, [currentPageOCR, pageNum, setPageLayers]);

  // Auto-build on first load or OCR change
  useEffect(() => {
    if (currentPageOCR && layers.length === 0) {
      handleBuildLayers();
    }
  }, [currentPageOCR, layers.length, handleBuildLayers]);

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
          onClick={handleBuildLayers}
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
        <button
          onClick={handleBuildLayers}
          className="p-1 rounded text-slate-600 hover:text-white transition-colors"
          title="Rebuild layers from OCR"
        >
          <RefreshCw size={10} />
        </button>
      </div>

      {/* Tree view */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {groups.map((group) => {
          const groupLayers = group.layerIds
            .map(id => layerMap.get(id))
            .filter((l): l is TextLayer => Boolean(l));

          return (
            <div key={group.id} className="border-b border-white/5">
              <GroupHeader
                group={group}
                pageNum={pageNum}
                layerCount={groupLayers.length}
                isHovered={hoveredGroupId === group.id}
              />

              {/* Layers (when expanded) */}
              {!group.collapsed && (
                <div className="pb-0.5">
                  {groupLayers.map((layer) => (
                    <LayerRow
                      key={layer.id}
                      layer={layer}
                      pageNum={pageNum}
                      isSelected={selectedLayerIds.has(layer.id)}
                      isHovered={hoveredLayerId === layer.id}
                      groupColor={group.color}
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
