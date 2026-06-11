import React, { useState, useMemo } from 'react';
import { useGlossaryStore, GlossaryEntry } from '../../stores/useGlossaryStore';
import { 
  Search, 
  Plus, 
  Trash2, 
  BookOpen, 
  Info, 
  Sparkles,
  HelpCircle,
  Volume2,
  Tag
} from 'lucide-react';

export const GlossarySidebarPanel: React.FC = () => {
  const { entries, addEntry, removeEntry, toggleEntry } = useGlossaryStore();
  const [sourceText, setSourceText] = useState('');
  const [targetText, setTargetText] = useState('');
  const [type, setType] = useState<'TERM' | 'SFX'>('TERM');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<'ALL' | 'TERM' | 'SFX'>('ALL');
  const [showAddForm, setShowAddForm] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!sourceText.trim() || !targetText.trim()) return;
    addEntry({ 
      sourceText: sourceText.trim(), 
      targetText: targetText.trim(), 
      type 
    });
    setSourceText('');
    setTargetText('');
  };

  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      const matchesSearch = 
        entry.sourceText.toLowerCase().includes(searchQuery.toLowerCase()) ||
        entry.targetText.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesFilter = 
        activeFilter === 'ALL' || 
        entry.type === activeFilter;

      return matchesSearch && matchesFilter;
    });
  }, [entries, searchQuery, activeFilter]);

  return (
    <div className="w-full h-full bg-slate-950 text-white flex flex-col overflow-hidden select-none">
      {/* Header zone with premium gradient */}
      <div className="p-3 border-b border-white/10 bg-slate-950/40 backdrop-blur-md flex items-center justify-between">
        <h2 className="text-sm font-bold flex items-center gap-2 text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-indigo-300 to-purple-400">
          <BookOpen size={16} className="text-blue-400" />
          <span>พจนานุกรมส่วนตัว</span>
        </h2>
        
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className={`p-1.5 rounded-lg border transition-all duration-200 flex items-center justify-center ${
            showAddForm 
              ? 'bg-rose-500/10 border-rose-500/30 text-rose-400 hover:bg-rose-500/20' 
              : 'bg-blue-500/10 border-blue-500/30 text-blue-400 hover:bg-blue-500/20 shadow-[0_0_8px_rgba(59,130,246,0.15)]'
          }`}
          title={showAddForm ? "ปิดฟอร์มเพิ่มคำ" : "เพิ่มคำศัพท์ใหม่"}
        >
          <Plus size={14} className={`transition-transform duration-200 ${showAddForm ? 'rotate-45' : ''}`} />
        </button>
      </div>

      {/* Info message when starting */}
      {!showAddForm && entries.length === 0 && (
        <div className="mx-3 mt-3 p-2.5 rounded-lg bg-blue-500/5 border border-blue-500/15 text-[11px] text-blue-300 flex gap-2">
          <Info size={14} className="shrink-0 mt-0.5 text-blue-400" />
          <p className="leading-relaxed">
            คลังคำศัพท์เดิม  และ SFX ระบบจะทำงานเบื้องหลังโดยไม่แสดงที่นี่ เพื่อความเป็นส่วนตัวสูงสุด คุณสามารถกำหนดคำแปลใหม่ของคุณเองได้ที่แผงควบคุมนี้
          </p>
        </div>
      )}

      {/* Collapsible Add Entry Form */}
      {showAddForm && (
        <form 
          onSubmit={handleSubmit} 
          className="m-3 p-3 bg-slate-900/60 border border-white/10 rounded-xl space-y-3 shadow-inner backdrop-blur-sm transition-all duration-300"
        >
          <div className="space-y-1">
            <label className="block text-[10px] font-medium text-slate-400 uppercase tracking-wider">
              คำต้นทาง (เกาหลี/สเปน/อังกฤษ)
            </label>
            <input
              type="text"
              value={sourceText}
              onChange={(e) => setSourceText(e.target.value)}
              className="w-full bg-slate-950/80 border border-white/10 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-blue-500/60 focus:ring-1 focus:ring-blue-500/25 transition-all"
              placeholder="เช่น 쿵, Arthur, zoom"
              required
            />
          </div>

          <div className="space-y-1">
            <label className="block text-[10px] font-medium text-slate-400 uppercase tracking-wider">
              คำแปลภาษาไทยที่ต้องการ
            </label>
            <input
              type="text"
              value={targetText}
              onChange={(e) => setTargetText(e.target.value)}
              className="w-full bg-slate-950/80 border border-white/10 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-blue-500/60 focus:ring-1 focus:ring-blue-500/25 transition-all"
              placeholder="เช่น ตึง!, อาเธอร์, ฟิ้วว"
              required
            />
          </div>

          <div className="flex items-center justify-between gap-3 pt-1">
            <div className="flex bg-slate-950 border border-white/10 rounded-lg p-0.5">
              <button
                type="button"
                onClick={() => setType('TERM')}
                className={`px-2 py-1 rounded-md text-[10px] font-semibold flex items-center gap-1 transition-all ${
                  type === 'TERM' 
                    ? 'bg-gradient-to-r from-emerald-500/20 to-teal-500/20 text-emerald-300 border border-emerald-500/30' 
                    : 'text-slate-400 hover:text-white border border-transparent'
                }`}
              >
                <Tag size={10} />
                <span>คำเฉพาะ</span>
              </button>
              <button
                type="button"
                onClick={() => setType('SFX')}
                className={`px-2 py-1 rounded-md text-[10px] font-semibold flex items-center gap-1 transition-all ${
                  type === 'SFX' 
                    ? 'bg-gradient-to-r from-purple-500/20 to-indigo-500/20 text-purple-300 border border-purple-500/30' 
                    : 'text-slate-400 hover:text-white border border-transparent'
                }`}
              >
                <Volume2 size={10} />
                <span>เสียงเอฟเฟกต์</span>
              </button>
            </div>

            <button
              type="submit"
              className="bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-400 hover:to-indigo-500 text-white text-[10px] font-bold px-3 py-1.5 rounded-lg shadow-lg hover:shadow-blue-500/20 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center gap-1"
            >
              <Plus size={10} />
              <span>บันทึกคำ</span>
            </button>
          </div>
        </form>
      )}

      {/* Filter and Search Bar */}
      <div className="px-3 pb-2 pt-1.5 space-y-2 border-b border-white/5 bg-slate-950/20">
        {/* Search Input */}
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="ค้นหาคำศัพท์ที่บันทึกไว้..."
            className="w-full bg-slate-900/60 border border-white/10 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 transition-all"
          />
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
        </div>

        {/* Tab Filters */}
        <div className="flex bg-slate-900/40 border border-white/10 rounded-lg p-0.5 text-[10px]">
          <button
            onClick={() => setActiveFilter('ALL')}
            className={`flex-1 py-1 rounded-md text-center transition-all ${
              activeFilter === 'ALL' 
                ? 'bg-slate-800 text-white font-medium shadow-sm' 
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            ทั้งหมด ({entries.length})
          </button>
          <button
            onClick={() => setActiveFilter('TERM')}
            className={`flex-1 py-1 rounded-md text-center transition-all ${
              activeFilter === 'TERM' 
                ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-500/20 font-medium' 
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            คำเฉพาะ ({entries.filter(e => e.type === 'TERM').length})
          </button>
          <button
            onClick={() => setActiveFilter('SFX')}
            className={`flex-1 py-1 rounded-md text-center transition-all ${
              activeFilter === 'SFX' 
                ? 'bg-purple-950/60 text-purple-300 border border-purple-500/20 font-medium' 
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            เสียง SFX ({entries.filter(e => e.type === 'SFX').length})
          </button>
        </div>
      </div>

      {/* Entries List Area */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2">
        {filteredEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center text-slate-500">
            <Sparkles size={28} className="text-slate-600 mb-2 animate-pulse" />
            <p className="text-xs font-semibold text-slate-400">ไม่พบคลังคำแปลที่กำหนดเอง</p>
            <p className="text-[10px] text-slate-500 mt-1 max-w-[200px]">
              {searchQuery ? 'ไม่พบคลิกที่คำค้นหาของคุณ' : 'กดปุ่ม + ด้านบนขวา เพื่อเริ่มบันทึกศัพท์ใหม่'}
            </p>
          </div>
        ) : (
          filteredEntries.map((entry) => (
            <div 
              key={entry.id} 
              className={`p-2.5 rounded-xl border transition-all duration-200 flex items-center justify-between gap-3 group bg-gradient-to-r ${
                entry.isActive 
                  ? 'bg-slate-900/40 border-white/10 hover:border-white/20' 
                  : 'bg-slate-900/10 border-white/5 opacity-50 hover:opacity-75'
              }`}
            >
              {/* Text content details */}
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-1.5">
                  <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold tracking-wider uppercase border ${
                    entry.type === 'SFX' 
                      ? 'bg-purple-500/10 border-purple-500/30 text-purple-300' 
                      : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                  }`}>
                    {entry.type === 'SFX' ? 'SFX' : 'TERM'}
                  </span>
                  <span className="font-semibold text-xs text-white truncate max-w-[130px] block" title={entry.sourceText}>
                    {entry.sourceText}
                  </span>
                </div>
                <div className="text-[11px] text-slate-400 flex items-center gap-1 truncate" title={entry.targetText}>
                  <span className="text-slate-600 font-bold">👉</span>
                  <span className="font-medium text-slate-200">{entry.targetText}</span>
                </div>
              </div>

              {/* Action components (Toggle active, Delete) */}
              <div className="flex items-center gap-2 shrink-0">
                {/* Switch Toggle */}
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={entry.isActive}
                    onChange={() => toggleEntry(entry.id)}
                    className="sr-only peer"
                  />
                  <div className="w-7 h-4 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-400 after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-blue-600 peer-checked:after:bg-white peer-checked:after:border-white"></div>
                </label>

                {/* Delete button (displays on hover in desktop, visible always on mobile) */}
                <button
                  onClick={() => removeEntry(entry.id)}
                  className="p-1 rounded-md text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                  title="ลบคำศัพท์นี้"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer message */}
      <div className="p-2.5 bg-slate-950/80 border-t border-white/5 text-[9px] text-slate-600 flex justify-center items-center gap-1">
        <Sparkles size={10} className="text-yellow-500/60" />
        <span>พจนานุกรมถูกบันทึกและซิงค์แบบเรียลไทม์</span>
      </div>
    </div>
  );
};
