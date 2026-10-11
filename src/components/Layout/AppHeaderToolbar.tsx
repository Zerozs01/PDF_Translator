import React, { useState } from 'react';
import {
  Home,
  RotateCcw,
  Undo2,
  Redo2,
  MousePointer2,
  Hand,
  Square,
  Type,
  Bold,
  Italic,
  Underline,
  Minus,
  Plus,
  ChevronDown,
  Download,
  Compass,
  Sparkles,
  Flame,
  FileText,
} from 'lucide-react';
import type { TranslationMode } from '../../stores/useProjectStore';
import { useProjectStore } from '../../stores/useProjectStore';
import { useOCRTextLayerStore } from '../../stores/useOCRTextLayerStore';
import type { OCRPageResult } from '../../types';
import { useLayerStore } from '../../stores/useLayerStore';
import { SplitViewToggle } from '../Viewer/Toolbar';

export interface AppHeaderToolbarProps {
  file: File | null;
  editedName: string;
  isEditingName: boolean;
  setEditedName: (name: string) => void;
  setIsEditingName: (editing: boolean) => void;
  onBackToHome: () => void;
  onClearDocumentCache: () => void;
  activeTool: 'select' | 'hand' | 'region' | 'text';
  setActiveTool: (tool: 'select' | 'hand' | 'region' | 'text') => void;
  currentPage: number;
  hasSelection?: boolean;
  currentFontSize?: number;
  showFontDropdown?: boolean;
  setShowFontDropdown?: (show: boolean) => void;
  updateLayerFontSize?: (pageNum: number, layerId: string, size: number) => void;
  overlayFontSizeScale?: number;
  adjustOverlayFontScale?: (delta: number) => void;
  activePageOCR?: OCRPageResult | null;
  translationMode: TranslationMode;
  setTranslationMode: (mode: TranslationMode) => void;
  splitViewMode: 'split' | 'overlay';
  setSplitViewMode: (mode: 'split' | 'overlay') => void;
  isDownloadMenuOpen: boolean;
  setIsDownloadMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isDownloadingResult: boolean;
}

export const AppHeaderToolbar = React.memo<AppHeaderToolbarProps>(({
  file,
  editedName,
  isEditingName,
  setEditedName,
  setIsEditingName,
  onBackToHome,
  onClearDocumentCache,
  activeTool,
  setActiveTool,
  currentPage,
  translationMode,
  setTranslationMode,
  splitViewMode,
  setSplitViewMode,
  isDownloadMenuOpen,
  setIsDownloadMenuOpen,
  isDownloadingResult,
}) => {
  const [isModeDropdownOpen, setIsModeDropdownOpen] = useState(false);
  const [showFontDropdown, setShowFontDropdown] = useState(false);

  const updateLayerFontSize = useLayerStore((s) => s.updateLayerFontSize);
  const overlayFontSizeScale = useProjectStore((s) => s.overlayFontSizeScale);
  const setOverlayFontSizeScale = useProjectStore((s) => s.setOverlayFontSizeScale);

  const adjustOverlayFontScale = (delta: number) => {
    const next = Math.max(0.1, Math.min(4.0, overlayFontSizeScale + delta));
    setOverlayFontSizeScale(Number(next.toFixed(2)));
  };

  const hasSelection = useLayerStore((state) => {
    const pageLayers = state.layersByPage.get(currentPage) || [];
    return pageLayers.some((l) => state.selectedLayerIds.has(l.id));
  });

  const currentFontSize = useLayerStore((state) => {
    const pageLayers = state.layersByPage.get(currentPage) || [];
    const firstSelected = pageLayers.find((l) => state.selectedLayerIds.has(l.id));
    return firstSelected ? firstSelected.fontSize : 14;
  });

  const activePageOCR = useOCRTextLayerStore((s) => s.allPagesOCR.get(currentPage));
  const overlayFontScalePercent = Math.round(overlayFontSizeScale * 100);

  const profileOptions: Array<{
    mode: TranslationMode;
    label: string;
    icon: React.ReactNode;
    activeClass: string;
  }> = [
    {
      mode: 'adaptive',
      label: 'Orbit',
      icon: <Compass size={12} />,
      activeClass: 'border-emerald-300/50 bg-emerald-500/18 text-emerald-100',
    },
    {
      mode: 'manga',
      label: 'Manga',
      icon: <Sparkles size={12} />,
      activeClass: 'border-[#8B5CF6]/55 bg-[#8B5CF6]/22 text-[#E9D5FF]',
    },
    {
      mode: 'manhwa',
      label: 'Manhwa',
      icon: <Flame size={12} />,
      activeClass: 'border-pink-300/50 bg-pink-500/18 text-pink-100',
    },
    {
      mode: 'official',
      label: 'Official',
      icon: <FileText size={12} />,
      activeClass: 'border-cyan-300/50 bg-cyan-500/18 text-cyan-100',
    },
  ];

  const activeOption = profileOptions.find((opt) => opt.mode === translationMode) || profileOptions[0];
  const modeLabelColorClass = translationMode === 'adaptive'
    ? 'text-emerald-300'
    : translationMode === 'manga'
      ? 'text-[#C084FC]'
      : translationMode === 'manhwa'
        ? 'text-[#F472B6]'
        : 'text-[#60A5FA]';

  return (
    <header className="relative z-50 h-12 bg-[#171b23]/78 border-b border-white/10 backdrop-blur-xl flex items-center px-2 pr-36 gap-1 shrink-0 titlebar-drag">
      {/* Home Button */}
      <button 
        type="button"
        onClick={onBackToHome}
        className="p-2 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors cursor-pointer"
        title="Back to Home"
      >
        <Home size={18} />
      </button>

      <div className="w-px h-6 bg-white/10 mx-1" />

      {/* Editable Filename */}
      <div className="flex items-center min-w-0 max-w-xs">
        {isEditingName ? (
          <input 
            type="text"
            value={editedName}
            onChange={(e) => setEditedName(e.target.value)}
            onBlur={() => setIsEditingName(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setIsEditingName(false);
              if (e.key === 'Escape') { setEditedName(file?.name || ''); setIsEditingName(false); }
            }}
            aria-label="Document name"
            title="Document name"
            placeholder="Document name"
            className="bg-slate-900/70 border border-[#2B9BFF]/60 rounded px-2 py-1 text-sm text-white focus:outline-none min-w-[120px]"
            autoFocus
          />
        ) : (
          <button 
            type="button"
            onClick={() => { setEditedName(file?.name || ''); setIsEditingName(true); }}
            className="text-sm text-slate-200 hover:text-white truncate px-2 py-1 rounded hover:bg-white/10 transition-colors cursor-pointer"
            title="Click to rename"
          >
            {editedName || file?.name || 'Untitled'}
          </button>
        )}
      </div>

      {file && (
        <button
          type="button"
          onClick={onClearDocumentCache}
          className="p-1.5 rounded-lg hover:bg-red-500/10 text-slate-400 hover:text-red-400 transition-colors ml-1 cursor-pointer"
          title="Reset Document Cache (Clear OCR & Translation for all pages)"
        >
          <RotateCcw size={16} />
        </button>
      )}

      {/* Spacer - push tools to center */}
      <div className="flex-1" />

      {/* Undo/Redo */}
      <button type="button" className="p-2 rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors cursor-pointer" title="Undo">
        <Undo2 size={16} />
      </button>
      <button type="button" className="p-2 rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors cursor-pointer" title="Redo">
        <Redo2 size={16} />
      </button>

      <div className="w-px h-6 bg-white/10 mx-1" />

      {/* Drawing Tools */}
      <button 
        type="button"
        onClick={() => setActiveTool('select')}
        className={`p-2 rounded transition-colors cursor-pointer ${activeTool === 'select' ? 'bg-gradient-to-r from-[#2B9BFF] to-[#2776FF] text-white' : 'hover:bg-white/10 text-slate-400 hover:text-white'}`}
        title="Select Tool (V)"
      >
        <MousePointer2 size={16} />
      </button>
      <button 
        type="button"
        onClick={() => setActiveTool('hand')}
        className={`p-2 rounded transition-colors cursor-pointer ${activeTool === 'hand' ? 'bg-gradient-to-r from-[#2B9BFF] to-[#2776FF] text-white' : 'hover:bg-white/10 text-slate-400 hover:text-white'}`}
        title="Pan Tool (H)"
      >
        <Hand size={16} />
      </button>
      <button 
        type="button"
        onClick={() => setActiveTool('region')}
        className={`p-2 rounded transition-colors cursor-pointer ${activeTool === 'region' ? 'bg-gradient-to-r from-[#2B9BFF] to-[#2776FF] text-white' : 'hover:bg-white/10 text-slate-400 hover:text-white'}`}
        title="Draw Region (R)"
      >
        <Square size={16} />
      </button>
      <button 
        type="button"
        onClick={() => setActiveTool('text')}
        className={`p-2 rounded transition-colors cursor-pointer ${activeTool === 'text' ? 'bg-gradient-to-r from-[#2B9BFF] to-[#2776FF] text-white' : 'hover:bg-white/10 text-slate-400 hover:text-white'}`}
        title="Text Tool (T)"
      >
        <Type size={16} />
      </button>

      <div className="w-px h-6 bg-white/10 mx-1" />

      {/* Text Formatting */}
      <button type="button" className="p-2 rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors cursor-pointer" title="Bold">
        <Bold size={16} />
      </button>
      <button type="button" className="p-2 rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors cursor-pointer" title="Italic">
        <Italic size={16} />
      </button>
      <button type="button" className="p-2 rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors cursor-pointer" title="Underline">
        <Underline size={16} />
      </button>

      <div className="w-px h-6 bg-white/10 mx-1" />

      {/* Google Docs Font Size Controls */}
      <div className="relative flex items-center gap-1 bg-slate-950/40 rounded px-1.5 py-0.5 border border-white/5">
        <button
          type="button"
          disabled={!hasSelection}
          onClick={() => {
            const pageLayers = useLayerStore.getState().layersByPage.get(currentPage) || [];
            const selected = pageLayers.filter(l => useLayerStore.getState().selectedLayerIds.has(l.id));
            selected.forEach(l => {
              const nextSize = Math.max(4, l.fontSize - 1);
              updateLayerFontSize(currentPage, l.id, nextSize);
            });
          }}
          className="flex h-7 w-7 items-center justify-center rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer"
          title="ลดขนาดตัวอักษร"
          aria-label="Decrease Font Size"
        >
          <Minus size={13} />
        </button>
        
        <div className="relative flex items-center gap-0.5">
          <input
            type="number"
            disabled={!hasSelection}
            value={hasSelection ? currentFontSize : ''}
            placeholder={hasSelection ? '' : '--'}
            onClick={() => {
              if (hasSelection) {
                setShowFontDropdown(!showFontDropdown);
              }
            }}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10);
              if (!isNaN(val)) {
                const clamped = Math.max(1, Math.min(200, val));
                const pageLayers = useLayerStore.getState().layersByPage.get(currentPage) || [];
                const selected = pageLayers.filter(l => useLayerStore.getState().selectedLayerIds.has(l.id));
                selected.forEach(l => {
                  updateLayerFontSize(currentPage, l.id, clamped);
                });
              }
            }}
            className="w-10 h-7 text-center text-xs font-semibold text-white bg-slate-900 border border-white/10 rounded focus:border-[#2B9BFF] focus:outline-none disabled:opacity-30 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none cursor-pointer"
            title="ขนาดตัวอักษร"
          />
          
          <button
            type="button"
            disabled={!hasSelection}
            onClick={() => setShowFontDropdown(!showFontDropdown)}
            className="flex h-7 w-4 items-center justify-center rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer"
            title="เลือกขนาดตัวอักษร"
          >
            <ChevronDown size={10} />
          </button>

          {showFontDropdown && hasSelection && (
            <>
              <div 
                className="fixed inset-0 z-40" 
                onClick={() => setShowFontDropdown(false)} 
              />
              
              <div className="absolute top-8 left-0 z-50 min-w-[72px] max-h-60 overflow-y-auto bg-slate-900 border border-white/10 rounded shadow-xl py-1 scrollbar-thin scrollbar-thumb-white/10">
                {[8, 9, 10, 11, 12, 14, 18, 24, 30, 36, 48, 60, 72, 96].map((size) => (
                  <button
                    key={size}
                    type="button"
                    onClick={() => {
                      const pageLayers = useLayerStore.getState().layersByPage.get(currentPage) || [];
                      const selected = pageLayers.filter(l => useLayerStore.getState().selectedLayerIds.has(l.id));
                      selected.forEach(l => {
                        updateLayerFontSize(currentPage, l.id, size);
                      });
                      setShowFontDropdown(false);
                    }}
                    className={`w-full px-3 py-1.5 text-left text-xs hover:bg-white/10 transition-colors cursor-pointer ${
                      currentFontSize === size ? 'text-[#2B9BFF] font-bold bg-[#2B9BFF]/5' : 'text-slate-200'
                    }`}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <button
          type="button"
          disabled={!hasSelection}
          onClick={() => {
            const pageLayers = useLayerStore.getState().layersByPage.get(currentPage) || [];
            const selected = pageLayers.filter(l => useLayerStore.getState().selectedLayerIds.has(l.id));
            selected.forEach(l => {
              const nextSize = Math.min(200, l.fontSize + 1);
              updateLayerFontSize(currentPage, l.id, nextSize);
            });
          }}
          className="flex h-7 w-7 items-center justify-center rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer"
          title="เพิ่มขนาดตัวอักษร"
          aria-label="Increase Font Size"
        >
          <Plus size={13} />
        </button>
      </div>

      {/* Font Size Scaling */}
      <div className="w-px h-6 bg-white/10 mx-1" />
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => adjustOverlayFontScale(-0.05)}
          className="flex h-7 w-7 items-center justify-center rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors cursor-pointer"
          title="Decrease overlay text size"
          aria-label="Decrease overlay text size"
        >
          <Minus size={13} />
        </button>
        <span className="w-12 text-center text-xs font-semibold text-slate-300">
          {overlayFontScalePercent}%
        </span>
        <button
          type="button"
          onClick={() => adjustOverlayFontScale(0.05)}
          className="flex h-7 w-7 items-center justify-center rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors cursor-pointer"
          title="Increase overlay text size"
          aria-label="Increase overlay text size"
        >
          <Plus size={13} />
        </button>
      </div>

      {/* Spacer - push profile/downloads to top-right */}
      <div className="flex-1" />

      {/* Pulsing OCR Info Badge */}
      {activePageOCR && activePageOCR.words && activePageOCR.words.length > 0 && (
        <div className="flex items-center gap-1.5 rounded-lg border border-[#5CC6F2]/25 bg-slate-900/55 px-2.5 py-1 text-[11px] text-[#5CC6F2]/90 font-medium tracking-wide shadow-[0_4px_12px_rgba(92,198,242,0.08)]">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
          <span className="font-bold text-white shrink-0">
            {activePageOCR.ocrEngine === 'paddleocr'
              ? 'Paddle'
              : 'Easy'}
          </span>
          <span className="text-slate-500 font-normal shrink-0">•</span>
          <span className="shrink-0">พบ {activePageOCR.words.length} คำ</span>
          <span className="text-slate-500 font-normal shrink-0">•</span>
          <span className="font-mono text-[10px] text-[#5CC6F2]/80 shrink-0">
            conf {activePageOCR.confidence.toFixed(0)}%
          </span>
        </div>
      )}

      {/* Profile selector dropdown */}
      <div className="flex items-center gap-1.5 rounded-lg border border-white/12 bg-slate-900/55 px-2 py-1 relative">
        <div className="relative">
          <button
            onClick={() => setIsModeDropdownOpen(!isModeDropdownOpen)}
            type="button"
            className={`flex items-center gap-1.5 px-2 py-0.5 h-6 rounded-md border text-[11px] font-semibold transition-all cursor-pointer ${activeOption.activeClass}`}
            title={`Active translation profile: ${activeOption.label}`}
          >
            <span className="shrink-0 scale-90">{activeOption.icon}</span>
            <span className="text-[10px] tracking-wide font-bold">{activeOption.label}</span>
            <ChevronDown size={10} className={`transition-transform duration-200 ${isModeDropdownOpen ? 'rotate-180' : ''}`} />
          </button>

          {isModeDropdownOpen && (
            <>
              <div 
                className="fixed inset-0 z-[190]" 
                onClick={() => setIsModeDropdownOpen(false)} 
              />
              <div className="absolute right-0 mt-1.5 w-36 bg-slate-950/98 border border-white/15 rounded-lg shadow-2xl z-[200] p-1 space-y-0.5 backdrop-blur-xl animate-in fade-in slide-in-from-top-1 duration-100">
                {profileOptions.map((option) => {
                  const isActive = translationMode === option.mode;
                  return (
                    <button
                      key={option.mode}
                      type="button"
                      onClick={() => {
                        setTranslationMode(option.mode);
                        setIsModeDropdownOpen(false);
                      }}
                      className={`w-full flex items-center gap-2 px-2.5 py-1 text-left text-xs rounded-md transition-colors cursor-pointer ${
                        isActive 
                          ? 'bg-white/10 text-white font-bold' 
                          : 'text-slate-300 hover:bg-white/5 hover:text-white'
                      }`}
                    >
                      <span className={`shrink-0 scale-90 ${isActive ? modeLabelColorClass : 'text-slate-400'}`}>
                        {option.icon}
                      </span>
                      <span className="text-[11px]">{option.label}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {file && (
        <SplitViewToggle 
          viewMode={splitViewMode}
          isActive={splitViewMode === 'split'}
          onToggle={() => setSplitViewMode(splitViewMode === 'split' ? 'overlay' : 'split')}
        />
      )}

      <div className="relative">
        <button
          type="button"
          onClick={() => setIsDownloadMenuOpen((prev) => !prev)}
          className={`p-2 rounded transition-colors cursor-pointer ${isDownloadMenuOpen ? 'bg-[#2B9BFF]/25 text-white' : 'hover:bg-white/10 text-slate-300 hover:text-white'}`}
          title="Download"
          disabled={isDownloadingResult || !file}
        >
          <Download size={16} />
        </button>
      </div>
    </header>
  );
});

AppHeaderToolbar.displayName = 'AppHeaderToolbar';
