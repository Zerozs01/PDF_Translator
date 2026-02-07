import React, { useState, useEffect } from 'react';
import { 
  ChevronLeft, 
  ChevronRight, 
  Settings, 
  Languages, 
  MousePointer2, 
  Hand,
  Square, 
  Type,
  Sparkles,
  RefreshCw,
  BrainCircuit,
  Undo2,
  Redo2,
  Home,
  Bold,
  Italic,
  Underline,
  AlignLeft,
  AlignCenter,
  AlignRight
} from 'lucide-react';
import { SmartCanvas } from './components/SmartCanvas';
import { UploadScreen } from './components/Home/UploadScreen';
import { useUIStore } from './stores/useUIStore';
import { useProjectStore } from './stores/useProjectStore';

// Lazy Load Heavy Components
const RightSidebar = React.lazy(() => import('./components/Layout/RightSidebar').then(module => ({ default: module.RightSidebar })));
const PDFCanvas = React.lazy(() => import('./components/PDF/PDFCanvas').then(module => ({ default: module.PDFCanvas })));
const LeftSidebar = React.lazy(() => import('./components/Layout/LeftSidebar').then(module => ({ default: module.LeftSidebar })));
import { Region } from './types';
import { visionService } from './services/vision/VisionService';
import './types/electron.d'; // Import type declarations

// --- Gemini API: Secure IPC to Main Process ---
// API key is stored securely in Main Process, not exposed to renderer

/**
 * Translate text using Gemini API via secure IPC
 * @param text - Text to translate
 * @param type - Type of text (text, sfx, etc.)
 * @param mode - Translation mode (manga or official)
 */
async function translateWithGemini(text: string, type: string, mode: 'manga' | 'official'): Promise<string> {
  try {
    // Use secure electronAPI instead of direct API call
    const result = await window.electronAPI.gemini.translate(text, {
      mode,
      sourceType: type
    });
    return result;
  } catch (error) {
    console.error('Gemini translation error:', error);
    throw error;
  }
}

// --- Mock Regions for Prototype ---
// Region interface moved to src/types/index.ts

export default function App() {
  const { activeTool, setActiveTool } = useUIStore();
  const { 
    file, 
    currentPage, 
    totalPages, 
    setPage, 
    closeProject, 
    viewMode, 
    setViewMode,
    sourceLanguage,
    setSourceLanguage,
    targetLanguage,
    setTargetLanguage,
    translationMode,
    setTranslationMode
  } = useProjectStore();
  
  const [isAiProcessing, setIsAiProcessing] = useState(false);
  const [isVisionReady, setIsVisionReady] = useState(false);
  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(true);
  const [regions, setRegions] = useState<Region[]>([]); // Empty regions initially
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState(file?.name || '');

  const handleBackToHome = () => {
    visionService.cancelAll('Project closed');
    closeProject();
  };
  
  useEffect(() => {
    // Lazy Initialize Vision Worker (low priority)
    const timer = setTimeout(() => {
      visionService.initialize().then(() => {
        console.log('Vision System Ready (Lazy Loaded)');
        setIsVisionReady(true);
      });
    }, 2000); // Delay 2s to let UI render first

    return () => clearTimeout(timer);
  }, []);

  // Update editedName when file changes
  useEffect(() => {
    if (file) {
      setEditedName(file.name);
    }
  }, [file]);

  // If no file is loaded, show Upload Screen
  if (!file) {
    return <UploadScreen />;
  }

  /**
   * ✨ Feature: Translate All Regions using Gemini (via secure IPC)
   */
  const handleAiTranslate = async () => {
    setIsAiProcessing(true);
    try {
      const updatedRegions = await Promise.all(regions.map(async (reg) => {
        if (!reg.originalText) return reg;
        
        // Use secure IPC call instead of direct API
        const translated = await translateWithGemini(
          reg.originalText,
          reg.type,
          translationMode
        );
        
        return { ...reg, translatedText: translated };
      }));
      
      setRegions(updatedRegions);
    } catch (err) {
      console.error("AI Translation Failed", err);
    } finally {
      setIsAiProcessing(false);
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-900 text-slate-100 overflow-hidden font-sans">
      
      {/* HEADER TOOLBAR - Google Docs Style */}
      <header className="h-12 bg-slate-800 border-b border-slate-700 flex items-center px-2 gap-1 shrink-0">
        {/* Home Button */}
        <button 
          onClick={handleBackToHome}
          className="p-2 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
          title="Back to Home"
        >
          <Home size={18} />
        </button>

        <div className="w-px h-6 bg-slate-700 mx-1" />

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
              className="bg-slate-700 border border-cyan-500 rounded px-2 py-1 text-sm text-white focus:outline-none min-w-[120px]"
              autoFocus
            />
          ) : (
            <button 
              onClick={() => { setEditedName(file?.name || ''); setIsEditingName(true); }}
              className="text-sm text-slate-200 hover:text-white truncate px-2 py-1 rounded hover:bg-slate-700 transition-colors"
              title="Click to rename"
            >
              {editedName || file?.name || 'Untitled'}
            </button>
          )}
        </div>

        {/* Spacer - push tools to center */}
        <div className="flex-1" />

        {/* Undo/Redo */}
        <button className="p-2 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition-colors" title="Undo">
          <Undo2 size={16} />
        </button>
        <button className="p-2 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition-colors" title="Redo">
          <Redo2 size={16} />
        </button>

        <div className="w-px h-6 bg-slate-700 mx-1" />

        {/* Drawing Tools */}
        <button 
          onClick={() => setActiveTool('select')}
          className={`p-2 rounded transition-colors ${activeTool === 'select' ? 'bg-cyan-600 text-white' : 'hover:bg-slate-700 text-slate-400 hover:text-white'}`}
          title="Select Tool (V)"
        >
          <MousePointer2 size={16} />
        </button>
        <button 
          onClick={() => setActiveTool('hand')}
          className={`p-2 rounded transition-colors ${activeTool === 'hand' ? 'bg-cyan-600 text-white' : 'hover:bg-slate-700 text-slate-400 hover:text-white'}`}
          title="Pan Tool (H)"
        >
          <Hand size={16} />
        </button>
        <button 
          onClick={() => setActiveTool('region')}
          className={`p-2 rounded transition-colors ${activeTool === 'region' ? 'bg-cyan-600 text-white' : 'hover:bg-slate-700 text-slate-400 hover:text-white'}`}
          title="Draw Region (R)"
        >
          <Square size={16} />
        </button>
        <button 
          onClick={() => setActiveTool('text')}
          className={`p-2 rounded transition-colors ${activeTool === 'text' ? 'bg-cyan-600 text-white' : 'hover:bg-slate-700 text-slate-400 hover:text-white'}`}
          title="Text Tool (T)"
        >
          <Type size={16} />
        </button>

        <div className="w-px h-6 bg-slate-700 mx-1" />

        {/* Text Formatting */}
        <button className="p-2 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition-colors" title="Bold">
          <Bold size={16} />
        </button>
        <button className="p-2 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition-colors" title="Italic">
          <Italic size={16} />
        </button>
        <button className="p-2 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition-colors" title="Underline">
          <Underline size={16} />
        </button>

        <div className="w-px h-6 bg-slate-700 mx-1" />

        {/* Text Align */}
        <button className="p-2 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition-colors" title="Align Left">
          <AlignLeft size={16} />
        </button>
        <button className="p-2 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition-colors" title="Align Center">
          <AlignCenter size={16} />
        </button>
        <button className="p-2 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition-colors" title="Align Right">
          <AlignRight size={16} />
        </button>

        {/* Spacer - balance tools to center */}
        <div className="flex-1" />
      </header>

      {/* MAIN CONTENT AREA */}
      <div className="flex flex-1 overflow-hidden">
        
        {/* 1. LEFT SIDEBAR - Pages Navigator Only */}
        <React.Suspense fallback={<div className="w-48 bg-slate-800 border-r border-slate-700" />}>
          <LeftSidebar 
            isOpen={isLeftSidebarOpen} 
            onToggle={() => setIsLeftSidebarOpen(!isLeftSidebarOpen)} 
          />
        </React.Suspense>

        {/* 2. MAIN WORKSPACE (Canvas) */}
        <main className="flex-1 relative overflow-hidden bg-slate-950">
          <React.Suspense fallback={<div className="flex items-center justify-center h-full text-slate-500">Loading Canvas...</div>}>
            {file.type === 'application/pdf' ? (
              <PDFCanvas />
            ) : (
              <SmartCanvas regions={regions} />
            )}
          </React.Suspense>
        </main>

        {/* 3. RIGHT SIDEBAR - OCR & Settings */}
        <React.Suspense fallback={<div className="w-80 bg-slate-800 border-l border-slate-700" />}>
          <RightSidebar 
            isAiProcessing={isAiProcessing}
            onAiTranslate={handleAiTranslate}
          />
        </React.Suspense>
      </div>
    </div>
  );
}
