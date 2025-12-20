import React, { useState } from 'react';
import { 
  ChevronLeft, 
  ChevronRight, 
  FileImage, 
  Settings, 
  Languages, 
  MousePointer2, 
  Square, 
  Type,
  Ghost,
  Sparkles,
  RefreshCw,
  BrainCircuit,
  Volume2
} from 'lucide-react';

// --- Gemini API Configurations ---
const apiKey = import.meta.env.VITE_GEMINI_API_KEY || ""; // Environment will provide this at runtime
const GEMINI_MODEL = "gemini-2.5-flash-preview-09-2025";

/**
 * Gemini API Caller with Exponential Backoff
 */
async function callGemini(userQuery: string, systemPrompt: string) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const payload = {
    contents: [{ parts: [{ text: userQuery }] }],
    systemInstruction: { parts: [{ text: systemPrompt }] }
  };

  let delay = 1000;
  for (let i = 0; i < 5; i++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const result = await response.json();
      return result.candidates?.[0]?.content?.parts?.[0]?.text || "No response";
    } catch (error) {
      if (i === 4) throw error;
      await new Promise(res => setTimeout(res, delay));
      delay *= 2;
    }
  }
}

// --- Mock Regions for Prototype ---
interface Region {
  id: string;
  type: 'text' | 'balloon' | 'sfx' | 'panel';
  originalText?: string;
  translatedText?: string;
  box: { x: number, y: number, w: number, h: number };
}

export default function App() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [activeTool, setActiveTool] = useState<'select' | 'region' | 'text'>('select');
  const [isAiProcessing, setIsAiProcessing] = useState(false);
  const [translationMode, setTranslationMode] = useState<'manga' | 'official'>('manga');
  
  const [regions, setRegions] = useState<Region[]>([
    { id: '1', type: 'balloon', originalText: 'お前、何者だ？', box: { x: 150, y: 100, w: 120, h: 80 } },
    { id: '2', type: 'sfx', originalText: 'ゴゴゴ', box: { x: 50, y: 300, w: 100, h: 100 } }
  ]);

  /**
   * ✨ Feature: Translate All Regions using Gemini
   */
  const handleAiTranslate = async () => {
    setIsAiProcessing(true);
    try {
      const systemPrompt = `You are a professional manga translator. Translate to Thai. 
        Mode: ${translationMode === 'manga' ? 'Informal, emotional, use particle like "นะ", "โว้ย"' : 'Formal, polite'}.
        If the type is "sfx", explain the sound in brackets like [เสียงสั่นสะเทือน].`;

      const updatedRegions = await Promise.all(regions.map(async (reg) => {
        if (!reg.originalText) return reg;
        const translated = await callGemini(`Translate this text: "${reg.originalText}" (Type: ${reg.type})`, systemPrompt);
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

            {/* Regions List */}
            <section>
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
            </section>
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
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className={`absolute top-1/2 -right-3 -translate-y-1/2 bg-slate-800 border border-slate-600 shadow-xl rounded-full p-1.5 hover:bg-slate-700 hover:text-cyan-400 transition-all z-[100] ${!isSidebarOpen && 'right-[-40px]'}`}
        >
          {isSidebarOpen ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
        </button>
      </aside>

      {/* 2. MAIN WORKSPACE (Canvas) */}
      <main className="flex-1 relative overflow-hidden bg-slate-950 flex flex-col">
        
        {/* Floating Toolbar */}
        <div className="absolute top-6 left-1/2 -translate-x-1/2 bg-slate-800/80 backdrop-blur-xl border border-slate-700 shadow-2xl rounded-full px-6 py-3 flex items-center gap-4 z-50">
          <button 
            onClick={() => setActiveTool('select')}
            className={`p-2 rounded-full transition-all ${activeTool === 'select' ? 'bg-cyan-600 text-white shadow-lg' : 'hover:bg-slate-700 text-slate-400'}`}
          >
            <MousePointer2 size={20} />
          </button>
          <div className="w-[1px] h-6 bg-slate-700" />
          <button 
            onClick={() => setActiveTool('region')}
            className={`p-2 rounded-full transition-all ${activeTool === 'region' ? 'bg-cyan-600 text-white shadow-lg' : 'hover:bg-slate-700 text-slate-400'}`}
          >
            <Square size={20} />
          </button>
          <button 
            onClick={() => setActiveTool('text')}
            className={`p-2 rounded-full transition-all ${activeTool === 'text' ? 'bg-cyan-600 text-white shadow-lg' : 'hover:bg-slate-700 text-slate-400'}`}
          >
            <Type size={20} />
          </button>
          <div className="w-[1px] h-6 bg-slate-700" />
          <button className="p-2 rounded-full hover:bg-red-900/30 text-red-500 group relative">
            <Ghost size={20} />
            <span className="absolute -bottom-10 left-1/2 -translate-x-1/2 bg-red-600 text-[10px] text-white px-2 py-1 rounded opacity-0 group-hover:opacity-100 whitespace-nowrap transition-opacity">
              Ghost Refinement Mode
            </span>
          </button>
          <button className="p-2 rounded-full hover:bg-slate-700 text-yellow-400">
            <Volume2 size={20} title="Explain SFX" />
          </button>
        </div>

        {/* Viewport Area */}
        <div className="flex-1 overflow-auto p-12 flex items-center justify-center custom-scrollbar">
          <div className="relative bg-white shadow-[0_0_50px_rgba(0,0,0,0.5)] min-w-[500px] min-h-[700px] flex flex-col items-center justify-center border border-slate-700 group cursor-crosshair">
             {/* Manga Content Simulation */}
             <div className="text-slate-200 flex flex-col items-center gap-6 select-none opacity-20 group-hover:opacity-40 transition-opacity">
                <FileImage size={120} strokeWidth={0.5} />
                <div className="text-center">
                  <p className="text-xl font-bold">WORKSPACE CANVAS</p>
                  <p className="text-sm italic">Place PDF or Scan for AI Analysis</p>
                </div>
             </div>

             {/* GHOST FILTERS OVERLAY */}
             {regions.map(reg => (
               <div 
                 key={reg.id}
                 style={{
                   left: reg.box.x,
                   top: reg.box.y,
                   width: reg.box.w,
                   height: reg.box.h
                 }}
                 className={`absolute border-2 border-dashed transition-all cursor-move flex items-start p-1 ${
                   reg.type === 'balloon' ? 'border-green-500 bg-green-500/10' : 'border-orange-500 bg-orange-500/10'
                 }`}
               >
                 <div className="flex flex-col gap-1 w-full overflow-hidden">
                    <span className={`text-[8px] px-1 rounded self-start text-white uppercase font-black ${reg.type === 'balloon' ? 'bg-green-500' : 'bg-orange-500'}`}>
                      {reg.type}
                    </span>
                    {reg.translatedText && (
                      <div className="bg-white text-slate-900 p-1 text-[10px] leading-tight rounded shadow-sm">
                        {reg.translatedText}
                      </div>
                    )}
                 </div>
               </div>
             ))}
          </div>
        </div>

        {/* AI Status Bar */}
        <footer className="h-10 bg-slate-800 border-t border-slate-700 px-6 flex items-center justify-between text-[11px] text-slate-400">
          <div className="flex items-center gap-6">
            <span className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" />
              AI System Online
            </span>
            <span className="text-slate-500">|</span>
            <span>Current Language: JP → TH</span>
          </div>
          <div className="flex items-center gap-6">
             <span className="flex items-center gap-1.5 hover:text-cyan-400 cursor-pointer transition-colors">
               <BrainCircuit size={14} /> Gemini 2.5 Active
             </span>
             <span className="bg-slate-900 px-2 py-0.5 rounded border border-slate-700">
               FPS: 60
             </span>
          </div>
        </footer>
      </main>
    </div>
  );
}
