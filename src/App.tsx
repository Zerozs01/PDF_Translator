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
  BrainCircuit
} from 'lucide-react';
import { SmartCanvas } from './components/SmartCanvas';
import { UploadScreen } from './components/Home/UploadScreen';
import { useUIStore } from './stores/useUIStore';
import { useProjectStore } from './stores/useProjectStore';

// Lazy Load Heavy Components
const RightSidebar = React.lazy(() => import('./components/Layout/RightSidebar').then(module => ({ default: module.RightSidebar })));
const PDFCanvas = React.lazy(() => import('./components/PDF/PDFCanvas').then(module => ({ default: module.PDFCanvas })));
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
  const { isSidebarOpen, toggleSidebar, activeTool, setActiveTool } = useUIStore();
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

  const [regions, setRegions] = useState<Region[]>([]); // Empty regions initially

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
    <div className="flex h-screen w-full bg-slate-900 text-slate-100 overflow-hidden font-sans">
      
      {/* 1. LEFT SIDEBAR (Zero-Edge Toggle) */}
      <aside 
        className={`bg-slate-800 border-r border-slate-700 flex flex-col transition-all duration-300 ease-in-out relative ${
          isSidebarOpen ? 'w-72' : 'w-0'
        }`}
      >
        <div className={`flex-1 overflow-hidden flex flex-col ${isSidebarOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
          <div className="p-6 border-b border-slate-700">
            <h1 className="text-xl font-black bg-gradient-to-br from-cyan-400 to-blue-500 bg-clip-text text-transparent flex items-center gap-2">
              <BrainCircuit className="text-cyan-400" />
              MangaRebirth
            </h1>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-6">
            {/* Page Navigation (Moved to Right Sidebar) */}


            {/* className="text-xl font-black bg-gradient-to-br from-cyan-400 to-blue-500 bg-clip-text text-transparent flex items-center gap-2">
              <BrainCircuit className="text-cyan-400" />
              MangaRebirth
            </h1>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-6">
            {/* Tools & Settings (Replaces Detected Regions) */}
            <section className="space-y-4">
              {/* Tool Palette */}
              <div>
                <h2 className="text-[10px] uppercase font-bold text-slate-500 mb-3 tracking-widest">Tools</h2>
                <div className="grid grid-cols-4 gap-2">
                  <button 
                    onClick={() => setActiveTool('select')}
                    className={`p-2 rounded-lg transition-all flex justify-center items-center ${activeTool === 'select' ? 'bg-cyan-600 text-white shadow-lg' : 'bg-slate-800 hover:bg-slate-700 text-slate-400 border border-slate-700'}`}
                    title="Select Tool"
                  >
                    <MousePointer2 size={18} />
                  </button>
                  <button 
                    onClick={() => setActiveTool('hand')}
                    className={`p-2 rounded-lg transition-all flex justify-center items-center ${activeTool === 'hand' ? 'bg-cyan-600 text-white shadow-lg' : 'bg-slate-800 hover:bg-slate-700 text-slate-400 border border-slate-700'}`}
                    title="Pan Tool (Hand)"
                  >
                    <Hand size={18} />
                  </button>
                  <button 
                    onClick={() => setActiveTool('region')}
                    className={`p-2 rounded-lg transition-all flex justify-center items-center ${activeTool === 'region' ? 'bg-cyan-600 text-white shadow-lg' : 'bg-slate-800 hover:bg-slate-700 text-slate-400 border border-slate-700'}`}
                    title="Draw Region"
                  >
                    <Square size={18} />
                  </button>
                  <button 
                    onClick={() => setActiveTool('text')}
                    className={`p-2 rounded-lg transition-all flex justify-center items-center ${activeTool === 'text' ? 'bg-cyan-600 text-white shadow-lg' : 'bg-slate-800 hover:bg-slate-700 text-slate-400 border border-slate-700'}`}
                    title="Text Tool"
                  >
                    <Type size={18} />
                  </button>
                </div>
              </div>

              {/* Language Settings */}
              <div>
                <h2 className="text-[10px] uppercase font-bold text-slate-500 mb-3 tracking-widest">Language</h2>
                <div className="space-y-2">
                  <div className="flex items-center justify-between bg-slate-800 p-2 rounded-lg border border-slate-700">
                    <span className="text-xs text-slate-400">OCR Source</span>
                    <button 
                      onClick={() => setSourceLanguage(sourceLanguage === 'eng' ? 'jpn' : 'eng')}
                      className="text-xs font-bold text-cyan-400 hover:text-cyan-300 uppercase"
                    >
                      {sourceLanguage === 'eng' ? 'English' : 'Japanese'}
                    </button>
                  </div>
                  <div className="flex items-center justify-between bg-slate-800 p-2 rounded-lg border border-slate-700">
                    <span className="text-xs text-slate-400">Translate To</span>
                    <button 
                      onClick={() => setTargetLanguage(targetLanguage === 'th' ? 'en' : 'th')}
                      className="text-xs font-bold text-green-400 hover:text-green-300 uppercase"
                    >
                      {targetLanguage === 'th' ? 'Thai' : 'English'}
                    </button>
                  </div>
                </div>
              </div>
            </section>

            {/* Translation Settings */}
            <section>
              <h2 className="text-[10px] uppercase font-bold text-slate-500 mb-3 tracking-widest">Translation Context ✨</h2>
              <div className="grid grid-cols-2 gap-2">
                <button 
                  onClick={() => setTranslationMode('manga')}
                  className={`text-xs p-2 rounded-md border ${translationMode === 'manga' ? 'bg-blue-600 border-blue-400' : 'bg-slate-700 border-slate-600 hover:bg-slate-600'}`}
                >
                  🎭 Manga Style
                </button>
                <button 
                  onClick={() => setTranslationMode('official')}
                  className={`text-xs p-2 rounded-md border ${translationMode === 'official' ? 'bg-blue-600 border-blue-400' : 'bg-slate-700 border-slate-600 hover:bg-slate-600'}`}
                >
                  📜 Official Doc
                </button>
              </div>
            </section>

            {/* AI Control Center */}
            <section className="bg-slate-700/50 p-4 rounded-xl border border-slate-600">
              <h3 className="text-sm font-bold mb-3 flex items-center gap-2">
                <Sparkles size={16} className="text-yellow-400" />
                Gemini Intelligence
              </h3>
              <button 
                onClick={handleAiTranslate}
                disabled={isAiProcessing}
                className="w-full bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 disabled:opacity-50 py-2 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-all shadow-lg"
              >
                {isAiProcessing ? <RefreshCw className="animate-spin" size={16} /> : <Languages size={16} />}
                {isAiProcessing ? "Thinking..." : "✨ AI Translate Page"}
              </button>
              
              <p className="text-[10px] text-slate-400 mt-3 italic text-center">
                Powered by Gemini 2.5 Flash
              </p>
            </section>

            {/* Regions List (Hidden for now as per request) */}
            {/* <section>
              <h2 className="text-[10px] uppercase font-bold text-slate-500 mb-3 tracking-widest flex items-center justify-between">
                Detected Regions
                <span className="bg-slate-700 px-2 py-0.5 rounded-full text-cyan-400">{regions.length}</span>
              </h2>
              <div className="space-y-2">
                {regions.map(reg => (
                  <div key={reg.id} className="bg-slate-800 p-3 rounded-lg border border-slate-700 text-xs hover:border-slate-500 transition-all group">
                    <div className="flex justify-between items-center mb-2">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase font-bold ${reg.type === 'balloon' ? 'bg-green-900 text-green-300' : 'bg-orange-900 text-orange-300'}`}>
                        {reg.type}
                      </span>
                      <Ghost size={12} className="text-slate-600 group-hover:text-red-400 cursor-help" title="Potential Ghost Region?" />
                    </div>
                    <p className="text-slate-400 mb-1 truncate">Original: {reg.originalText}</p>
                    <p className="text-cyan-400 font-medium">Translation: {reg.translatedText || '...'}</p>
                  </div>
                ))}
              </div>
            </section> */}
          </div>

          {/* Footer Sidebar */}
          <div className="p-4 border-t border-slate-700 bg-slate-800/50">
            <button className="flex items-center gap-2 text-xs text-slate-400 hover:text-white transition-colors">
              <Settings size={14} />
              Model Configuration
            </button>
          </div>
        </div>

        {/* TOGGLE BUTTON */}
        <button 
          onClick={toggleSidebar}
          className={`absolute top-1/2 -right-3 -translate-y-1/2 bg-slate-800 border border-slate-600 shadow-xl rounded-full p-1.5 hover:bg-slate-700 hover:text-cyan-400 transition-all z-[100] ${!isSidebarOpen && 'right-[-40px]'}`}
        >
          {isSidebarOpen ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
        </button>
      </aside>

      {/* 2. MAIN WORKSPACE (Canvas) */}
      <main className="flex-1 relative overflow-hidden bg-slate-950 flex flex-col">
        
        {/* Viewport Area */}
        <div className="flex-1 overflow-hidden relative bg-slate-900/50">
         <React.Suspense fallback={<div className="flex items-center justify-center h-full text-slate-500">Loading Canvas...</div>}>
            {file.type === 'application/pdf' ? (
              <PDFCanvas />
            ) : (
              <SmartCanvas regions={regions} />
            )}
          </React.Suspense>
        </div>

      </main>

      {/* 3. RIGHT SIDEBAR (Navigation & OCR) */}
      <React.Suspense fallback={<div className="w-80 bg-slate-800 border-l border-slate-700" />}>
        <RightSidebar />
      </React.Suspense>
    </div>
  );
}
