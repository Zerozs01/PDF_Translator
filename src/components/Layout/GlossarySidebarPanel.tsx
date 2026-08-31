import React, { useState, useMemo, useRef } from 'react';
import { useGlossaryStore, GlossaryEntry } from '../../stores/useGlossaryStore';
import { 
  Search, 
  Plus, 
  Trash2, 
  BookOpen, 
  Info, 
  Sparkles, 
  Volume2, 
  Tag, 
  Download, 
  Upload, 
  Globe2, 
  FileJson, 
  FileSpreadsheet,
  Check,
  Languages
} from 'lucide-react';

const LANGUAGE_OPTIONS = [
  { code: 'all', label: 'ทุกภาษา (All)', flag: '🌐' },
  { code: 'ko', label: 'เกาหลี (Korean)', flag: '🇰🇷' },
  { code: 'es', label: 'สเปน (Spanish)', flag: '🇪🇸' },
  { code: 'en', label: 'อังกฤษ (English)', flag: '🇬🇧' },
  { code: 'ja', label: 'ญี่ปุ่น (Japanese)', flag: '🇯🇵' },
  { code: 'zh', label: 'จีน (Chinese)', flag: '🇨🇳' },
];

export const GlossarySidebarPanel: React.FC = () => {
  const { entries, addEntry, removeEntry, toggleEntry, importEntries, exportEntries } = useGlossaryStore();
  const [sourceText, setSourceText] = useState('');
  const [targetText, setTargetText] = useState('');
  const [sourceLang, setSourceLang] = useState<string>('all');
  const [type, setType] = useState<'TERM' | 'SFX'>('TERM');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<'ALL' | 'KO' | 'ES' | 'EN' | 'JA' | 'SFX'>('ALL');
  const [showAddForm, setShowAddForm] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [importNotification, setImportNotification] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sourceText.trim() || !targetText.trim()) return;
    await addEntry({ 
      sourceText: sourceText.trim(), 
      targetText: targetText.trim(), 
      sourceLang,
      targetLang: 'th',
      type 
    });
    setSourceText('');
    setTargetText('');
  };

  const handleExport = (format: 'json' | 'csv') => {
    const data = exportEntries(format);
    const mimeType = format === 'json' ? 'application/json' : 'text/csv;charset=utf-8;';
    const blob = new Blob([data], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pdf_translator_glossary_${Date.now()}.${format}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setShowExportMenu(false);
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      let importedItems: Array<{
        sourceText: string;
        targetText: string;
        sourceLang?: string;
        targetLang?: string;
        type?: 'TERM' | 'SFX';
      }> = [];

      if (file.name.endsWith('.json') || text.trim().startsWith('[') || text.trim().startsWith('{')) {
        const parsed = JSON.parse(text);
        const arrayData = Array.isArray(parsed) ? parsed : (parsed.entries || []);
        importedItems = arrayData.map((item: any) => ({
          sourceText: String(item.sourceText || item.source_text || item.source || '').trim(),
          targetText: String(item.targetText || item.target_text || item.target || '').trim(),
          sourceLang: item.sourceLang || item.source_lang || 'all',
          targetLang: item.targetLang || item.target_lang || 'th',
          type: (item.type === 'SFX' ? 'SFX' : 'TERM') as 'TERM' | 'SFX',
        })).filter((i: any) => i.sourceText && i.targetText);
      } else {
        // CSV parser
        const lines = text.split(/\r?\n/);
        for (let idx = 0; idx < lines.length; idx++) {
          const line = lines[idx].trim();
          if (!line || idx === 0 && line.toLowerCase().includes('source_text')) continue;
          // Simple CSV unquoting
          const parts = line.split(',').map((p) => p.replace(/^"|"$/g, '').trim());
          if (parts.length >= 2 && parts[0] && parts[1]) {
            importedItems.push({
              sourceText: parts[0],
              targetText: parts[1],
              sourceLang: parts[2] || 'all',
              targetLang: parts[3] || 'th',
              type: parts[4] === 'SFX' ? 'SFX' : 'TERM',
            });
          }
        }
      }

      if (importedItems.length > 0) {
        const res = await importEntries(importedItems);
        setImportNotification(`นำเข้าสำเร็จ ${res.count || importedItems.length} คำศัพท์`);
        setTimeout(() => setImportNotification(null), 3500);
      } else {
        setImportNotification('ไม่พบคำศัพท์ที่สามารถนำเข้าได้');
        setTimeout(() => setImportNotification(null), 3500);
      }
    } catch (err: any) {
      console.error('[GlossaryImport] Error reading file:', err);
      setImportNotification('ไฟล์นำเข้าไม่ถูกต้อง');
      setTimeout(() => setImportNotification(null), 3500);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      const q = searchQuery.toLowerCase();
      const matchesSearch = 
        entry.sourceText.toLowerCase().includes(q) ||
        entry.targetText.toLowerCase().includes(q);
      
      let matchesFilter = true;
      if (activeFilter === 'SFX') {
        matchesFilter = entry.type === 'SFX';
      } else if (activeFilter === 'KO') {
        matchesFilter = entry.sourceLang === 'ko' || /[\uAC00-\uD7AF]/.test(entry.sourceText);
      } else if (activeFilter === 'ES') {
        matchesFilter = entry.sourceLang === 'es';
      } else if (activeFilter === 'EN') {
        matchesFilter = entry.sourceLang === 'en';
      } else if (activeFilter === 'JA') {
        matchesFilter = entry.sourceLang === 'ja' || /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(entry.sourceText);
      }

      return matchesSearch && matchesFilter;
    });
  }, [entries, searchQuery, activeFilter]);

  return (
    <div className="w-full h-full bg-slate-950 text-white flex flex-col overflow-hidden select-none">
      {/* Hidden File Input for Import */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleImportFile}
        accept=".json,.csv,text/csv,application/json"
        className="hidden"
      />

      {/* Header zone with premium gradient */}
      <div className="p-3 border-b border-white/10 bg-slate-950/60 backdrop-blur-md flex items-center justify-between gap-1">
        <h2 className="text-sm font-bold flex items-center gap-2 text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-indigo-300 to-purple-400 truncate">
          <BookOpen size={16} className="text-blue-400 shrink-0" />
          <span className="truncate">พจนานุกรมส่วนตัว</span>
        </h2>
        
        <div className="flex items-center gap-1 shrink-0">
          {/* Import Button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="p-1.5 rounded-lg border border-white/10 bg-slate-900/80 text-slate-300 hover:text-sky-300 hover:bg-sky-500/10 hover:border-sky-500/30 transition-all text-[10px] flex items-center gap-1"
            title="นำเข้าคำศัพท์ (Import JSON / CSV)"
          >
            <Upload size={12} />
          </button>

          {/* Export Button & Dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowExportMenu(!showExportMenu)}
              className="p-1.5 rounded-lg border border-white/10 bg-slate-900/80 text-slate-300 hover:text-emerald-300 hover:bg-emerald-500/10 hover:border-emerald-500/30 transition-all text-[10px] flex items-center gap-1"
              title="ส่งออกคำศัพท์ (Export)"
            >
              <Download size={12} />
            </button>

            {showExportMenu && (
              <div className="absolute right-0 top-full mt-1.5 w-36 bg-slate-900 border border-white/15 rounded-xl shadow-2xl p-1.5 z-50 backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150">
                <div className="text-[9px] font-semibold text-slate-400 px-2 py-1 uppercase tracking-wider">ส่งออกเป็น</div>
                <button
                  onClick={() => handleExport('json')}
                  className="w-full px-2 py-1.5 rounded-lg text-xs flex items-center gap-2 text-slate-200 hover:bg-blue-600/20 hover:text-blue-300 transition-colors text-left"
                >
                  <FileJson size={14} className="text-blue-400" />
                  <span>JSON File</span>
                </button>
                <button
                  onClick={() => handleExport('csv')}
                  className="w-full px-2 py-1.5 rounded-lg text-xs flex items-center gap-2 text-slate-200 hover:bg-emerald-600/20 hover:text-emerald-300 transition-colors text-left"
                >
                  <FileSpreadsheet size={14} className="text-emerald-400" />
                  <span>CSV File</span>
                </button>
              </div>
            )}
          </div>

          {/* Add Entry Toggle */}
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className={`p-1.5 rounded-lg border transition-all duration-200 flex items-center justify-center ${
              showAddForm 
                ? 'bg-rose-500/10 border-rose-500/30 text-rose-400 hover:bg-rose-500/20' 
                : 'bg-blue-500/15 border-blue-500/30 text-blue-400 hover:bg-blue-500/25 shadow-[0_0_8px_rgba(59,130,246,0.2)]'
            }`}
            title={showAddForm ? "ปิดฟอร์มเพิ่มคำ" : "เพิ่มคำศัพท์ใหม่"}
          >
            <Plus size={13} className={`transition-transform duration-200 ${showAddForm ? 'rotate-45' : ''}`} />
          </button>
        </div>
      </div>

      {/* Import Notification Banner */}
      {importNotification && (
        <div className="mx-3 mt-2 p-2 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-[11px] text-emerald-300 flex items-center gap-2 animate-in fade-in duration-200">
          <Check size={14} className="shrink-0 text-emerald-400" />
          <span>{importNotification}</span>
        </div>
      )}

      {/* Info message when starting */}
      {!showAddForm && entries.length === 0 && (
        <div className="mx-3 mt-3 p-2.5 rounded-lg bg-blue-500/5 border border-blue-500/15 text-[11px] text-blue-300 flex gap-2">
          <Info size={14} className="shrink-0 mt-0.5 text-blue-400" />
          <p className="leading-relaxed">
            คลังคำศัพท์นี้ถูกบันทึกลงฐานข้อมูล SQLite ปลอดภัยและมีสิทธิ์สูงสุดเหนือนักแปล AI คุณสามารถเพิ่มศัพท์หรือนำเข้าไฟล์เพื่อใช้งานได้ทันที
          </p>
        </div>
      )}

      {/* Collapsible Add Entry Form */}
      {showAddForm && (
        <form 
          onSubmit={handleSubmit} 
          className="m-3 p-3 bg-slate-900/80 border border-white/10 rounded-xl space-y-2.5 shadow-xl backdrop-blur-md transition-all duration-300"
        >
          <div className="space-y-1">
            <label className="block text-[10px] font-medium text-slate-400 uppercase tracking-wider">
              คำต้นทาง (เกาหลี/สเปน/อังกฤษ/SFX)
            </label>
            <input
              type="text"
              value={sourceText}
              onChange={(e) => setSourceText(e.target.value)}
              className="w-full bg-slate-950/90 border border-white/10 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-blue-500/60 focus:ring-1 focus:ring-blue-500/25 transition-all"
              placeholder="เช่น 선배, joder, Arthur, 쿵"
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
              className="w-full bg-slate-950/90 border border-white/10 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-blue-500/60 focus:ring-1 focus:ring-blue-500/25 transition-all"
              placeholder="เช่น รุ่นพี่, เชี่ยเอ๊ย, อาเธอร์, ตึง!"
              required
            />
          </div>

          {/* Language and Type Selector Row */}
          <div className="grid grid-cols-2 gap-2 pt-0.5">
            <div>
              <label className="block text-[9px] font-medium text-slate-400 uppercase mb-1">
                ภาษาต้นทาง
              </label>
              <select
                value={sourceLang}
                onChange={(e) => setSourceLang(e.target.value)}
                className="w-full bg-slate-950/90 border border-white/10 rounded-lg p-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-blue-500"
              >
                {LANGUAGE_OPTIONS.map((opt) => (
                  <option key={opt.code} value={opt.code}>
                    {opt.flag} {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[9px] font-medium text-slate-400 uppercase mb-1">
                ประเภท
              </label>
              <div className="flex bg-slate-950 border border-white/10 rounded-lg p-0.5 h-[30px] items-center">
                <button
                  type="button"
                  onClick={() => setType('TERM')}
                  className={`flex-1 py-1 rounded-md text-[9.5px] font-semibold flex items-center justify-center gap-1 transition-all ${
                    type === 'TERM' 
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' 
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Tag size={9} />
                  <span>คำศัพท์</span>
                </button>
                <button
                  type="button"
                  onClick={() => setType('SFX')}
                  className={`flex-1 py-1 rounded-md text-[9.5px] font-semibold flex items-center justify-center gap-1 transition-all ${
                    type === 'SFX' 
                      ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30' 
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Volume2 size={9} />
                  <span>SFX</span>
                </button>
              </div>
            </div>
          </div>

          <div className="pt-1 flex justify-end">
            <button
              type="submit"
              className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold py-2 rounded-lg shadow-lg hover:shadow-blue-500/20 active:scale-[0.98] transition-all flex items-center justify-center gap-1.5"
            >
              <Plus size={12} />
              <span>บันทึกคำศัพท์ลงฐานข้อมูล</span>
            </button>
          </div>
        </form>
      )}

      {/* Filter and Search Bar */}
      <div className="px-3 pb-2 pt-1.5 space-y-2 border-b border-white/5 bg-slate-950/30">
        {/* Search Input */}
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="ค้นหาคำศัพท์หรือคำแปล..."
            className="w-full bg-slate-900/70 border border-white/10 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 transition-all"
          />
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
        </div>

        {/* Tab Filters */}
        <div className="flex bg-slate-900/50 border border-white/10 rounded-lg p-0.5 text-[9.5px] gap-0.5 overflow-x-auto custom-scrollbar">
          {[
            { id: 'ALL', label: 'ทั้งหมด' },
            { id: 'KO', label: '🇰🇷 เกาหลี' },
            { id: 'ES', label: '🇪🇸 สเปน' },
            { id: 'EN', label: '🇬🇧 อังกฤษ' },
            { id: 'JA', label: '🇯🇵 ญี่ปุ่น' },
            { id: 'SFX', label: '🔊 SFX' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveFilter(tab.id as any)}
              className={`px-2 py-1 rounded-md text-center shrink-0 transition-all ${
                activeFilter === tab.id 
                  ? 'bg-blue-600/30 text-blue-200 border border-blue-500/40 font-semibold shadow-sm' 
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Entries List Area */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2">
        {filteredEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center text-slate-500">
            <Sparkles size={26} className="text-slate-600 mb-2 animate-pulse" />
            <p className="text-xs font-semibold text-slate-400">ยังไม่มีคำศัพท์ในหมวดนี้</p>
            <p className="text-[10px] text-slate-500 mt-1 max-w-[200px]">
              {searchQuery ? 'ไม่พบคลิกที่คำค้นหาของคุณ' : 'กดปุ่ม + ด้านบนขวา เพื่อเริ่มบันทึกศัพท์ใหม่'}
            </p>
          </div>
        ) : (
          filteredEntries.map((entry) => {
            const langCode = (entry.sourceLang || 'all').toLowerCase();
            const langBadge = langCode === 'ko' ? '🇰🇷 KO' : langCode === 'es' ? '🇪🇸 ES' : langCode === 'en' ? '🇬🇧 EN' : langCode === 'ja' ? '🇯🇵 JA' : langCode === 'zh' ? '🇨🇳 ZH' : '🌐 ALL';

            return (
              <div 
                key={entry.id} 
                className={`p-2.5 rounded-xl border transition-all duration-200 flex items-center justify-between gap-2.5 group bg-gradient-to-r ${
                  entry.isActive 
                    ? 'bg-slate-900/50 border-white/10 hover:border-white/20' 
                    : 'bg-slate-900/10 border-white/5 opacity-50 hover:opacity-75'
                }`}
              >
                {/* Text content details */}
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold tracking-wider uppercase border ${
                      entry.type === 'SFX' 
                        ? 'bg-purple-500/10 border-purple-500/30 text-purple-300' 
                        : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                    }`}>
                      {entry.type === 'SFX' ? 'SFX' : 'TERM'}
                    </span>
                    <span className="px-1 py-0.5 rounded text-[8px] font-semibold bg-slate-800/80 border border-white/10 text-slate-300">
                      {langBadge}
                    </span>
                    <span className="font-semibold text-xs text-white truncate max-w-[130px] block" title={entry.sourceText}>
                      {entry.sourceText}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-300 flex items-center gap-1 truncate pl-0.5" title={entry.targetText}>
                    <span className="text-slate-500 font-bold">👉</span>
                    <span className="font-medium text-sky-200 truncate">{entry.targetText}</span>
                  </div>
                </div>

                {/* Action components (Toggle active, Delete) */}
                <div className="flex items-center gap-2 shrink-0">
                  {/* Switch Toggle */}
                  <label className="relative inline-flex items-center cursor-pointer" title={entry.isActive ? 'เปิดใช้งานอยู่ (คลิกเพื่อปิด)' : 'ปิดใช้งาน (คลิกเพื่อเปิด)'}>
                    <input
                      type="checkbox"
                      checked={entry.isActive}
                      onChange={() => toggleEntry(entry.id)}
                      className="sr-only peer"
                    />
                    <div className="w-7 h-4 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-400 after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-blue-600 peer-checked:after:bg-white peer-checked:after:border-white"></div>
                  </label>

                  {/* Delete button */}
                  <button
                    onClick={() => removeEntry(entry.id)}
                    className="p-1 rounded-md text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                    title="ลบคำศัพท์นี้"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer message */}
      <div className="p-2.5 bg-slate-950/90 border-t border-white/5 text-[9px] text-slate-500 flex justify-between items-center px-3">
        <div className="flex items-center gap-1">
          <Sparkles size={10} className="text-yellow-500/70" />
          <span>บันทึก {entries.length} คำศัพท์ (SQLite DB)</span>
        </div>
        <span className="text-[8.5px] text-slate-600">Top Priority $O(1)$</span>
      </div>
    </div>
  );
};

