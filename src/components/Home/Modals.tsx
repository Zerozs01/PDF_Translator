import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Check, Folder, Database } from 'lucide-react';
import type { DBTag, DBProject, ProjectStatsResult } from '../../types/electron.d';
import { TAG_COLOR_PALETTES } from '../../constants/colorPalettes';
import { hexToRgba, resolveStableAccent } from './libraryUtils';

export const EditTagModal: React.FC<{
  isOpen: boolean;
  tag: DBTag | null;
  name: string;
  color: string;
  onChangeName: (name: string) => void;
  onChangeColor: (color: string) => void;
  onSave: () => void;
  onClose: () => void;
}> = ({ isOpen, tag, name, color, onChangeName, onChangeColor, onSave, onClose }) => {
  if (!isOpen || !tag) return null;

  return createPortal(
    <div 
      className="fixed inset-0 z-[180] flex items-center justify-center bg-black/65 backdrop-blur-md p-4 animate-fade-in"
      onClick={onClose}
    >
      <div 
        className="w-full max-w-lg rounded-3xl border border-white/12 bg-[#0e1116]/98 p-6 shadow-[0_32px_96px_rgba(0,0,0,0.6)] text-left flex flex-col gap-4 max-h-[90vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2.5">
            <div 
              className="w-8 h-8 rounded-xl flex items-center justify-center text-sm shadow-inner border border-white/10"
              style={{ backgroundColor: hexToRgba(color || '#8B5CF6', 0.2) }}
            >
              <span className="h-3 w-3 rounded-full" style={{ backgroundColor: color || '#8B5CF6' }} />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-100">แก้ไขแท็ก (Edit Tag)</h3>
              <p className="text-xs text-slate-400">เปลี่ยนชื่อและชุดสีแท็กสำหรับแยกหมวดหมู่</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-white/10 text-slate-400 hover:text-slate-200 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tag Name Input */}
        <div>
          <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1.5">
            ชื่อแท็ก (Tag Name)
          </label>
          <input
            autoFocus
            type="text"
            value={name}
            onChange={(e) => onChangeName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSave();
            }}
            placeholder="Tag name"
            className="w-full rounded-2xl border border-white/10 bg-slate-900/70 px-4 py-2.5 text-sm text-slate-100 outline-none transition-colors focus:border-sky-400/60"
          />
        </div>

        {/* Live Preview Pill */}
        <div className="flex items-center gap-3 p-3 rounded-2xl bg-white/[0.02] border border-white/5">
          <span className="text-xs text-slate-400 select-none">ตัวอย่างแท็ก (Preview):</span>
          <span 
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border border-white/10 bg-[#131519]/88 text-slate-200 shadow-sm"
            style={{ boxShadow: `0 0 0 1px ${hexToRgba(color || '#8B5CF6', 0.28)}` }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color || '#8B5CF6' }} />
            {name || 'Tag Name'}
          </span>
        </div>

        {/* Categorized Color Palettes */}
        <div className="flex-1 overflow-y-auto space-y-3.5 pr-1 custom-scrollbar max-h-64">
          <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block sticky top-0 bg-[#0e1116] py-1 z-10">
            เลือกโทนสี (Select Color Palette)
          </label>
          {TAG_COLOR_PALETTES.map((group) => (
            <div key={group.name} className="space-y-1.5">
              <div className="text-[11px] font-semibold text-slate-400 flex items-center gap-1.5">
                <span>{group.icon}</span>
                <span>{group.name}</span>
              </div>
              <div className="grid grid-cols-6 gap-2">
                {group.colors.map((c) => {
                  const isSelected = (color || '').toUpperCase() === c.toUpperCase();
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => onChangeColor(c)}
                      className="h-8 w-8 rounded-full border border-white/10 transition-all flex items-center justify-center hover:scale-110 active:scale-95 shadow-sm"
                      style={{ 
                        backgroundColor: c,
                        boxShadow: isSelected ? `0 0 0 2px rgb(15, 23, 42), 0 0 0 4px ${c}` : 'none'
                      }}
                      title={c}
                    >
                      {isSelected && <Check size={13} className="text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]" />}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-3 border-t border-white/10 pt-3">
          <button
            onClick={onClose}
            className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={!name.trim()}
            className="rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(14,165,233,0.35)] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Save (บันทึก)
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export const FolderInfoModal: React.FC<{
  project: DBProject;
  onClose: () => void;
}> = ({ project, onClose }) => {
  const [stats, setStats] = useState<ProjectStatsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const accent = project.color || resolveStableAccent(project.id);

  useEffect(() => {
    let canceled = false;
    async function load() {
      try {
        setLoading(true);
        if (window.electronAPI?.projects?.getStats) {
          const res = await window.electronAPI.projects.getStats(project.id);
          if (!canceled && res) {
            setStats(res);
          }
        }
      } catch (err) {
        console.error('Failed to load project stats:', err);
      } finally {
        if (!canceled) setLoading(false);
      }
    }
    load();
    return () => { canceled = true; };
  }, [project.id]);

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return createPortal(
    <div 
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-md p-4 animate-fade-in"
      onClick={onClose}
    >
      <div 
        className="w-full max-w-xl rounded-3xl border border-white/12 bg-[#0e1116]/98 p-6 shadow-[0_32px_96px_rgba(0,0,0,0.6)] text-left flex flex-col gap-5 max-h-[85vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-white/10 pb-4 shrink-0">
          <div className="flex items-center gap-3">
            <div 
              className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl shadow-inner border border-white/10"
              style={{ backgroundColor: hexToRgba(accent, 0.18) }}
            >
              <Folder size={24} style={{ color: accent }} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                {project.name}
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                ข้อมูลสรุปและสถานะแคชในฐานข้อมูล SQLite
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-white/10 text-slate-400 hover:text-slate-200 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {loading ? (
          <div className="py-12 flex flex-col items-center justify-center gap-3 text-slate-400">
            <div className="h-6 w-6 rounded-full border-2 border-sky-400 border-t-transparent animate-spin" />
            <span className="text-xs font-medium">กำลังคำนวณขนาดและสถานะแคช...</span>
          </div>
        ) : stats ? (
          <div className="flex-1 overflow-y-auto space-y-4 custom-scrollbar pr-1">
            {/* Quick Stat Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div className="rounded-2xl border border-white/8 bg-slate-900/60 p-3 flex flex-col">
                <span className="text-[10px] uppercase font-bold text-slate-400">ไฟล์ทั้งหมด</span>
                <span className="text-lg font-extrabold text-slate-100 mt-1">{stats.totalDocuments}</span>
                <span className="text-[10px] text-slate-500 mt-0.5">เอกสารในโฟลเดอร์</span>
              </div>
              <div className="rounded-2xl border border-white/8 bg-slate-900/60 p-3 flex flex-col">
                <span className="text-[10px] uppercase font-bold text-slate-400">จำนวนหน้ารวม</span>
                <span className="text-lg font-extrabold text-sky-400 mt-1">{stats.totalPages}</span>
                <span className="text-[10px] text-slate-500 mt-0.5">หน้าทั้งหมด</span>
              </div>
              <div className="rounded-2xl border border-white/8 bg-slate-900/60 p-3 flex flex-col">
                <span className="text-[10px] uppercase font-bold text-slate-400">OCR แล้ว</span>
                <span className="text-lg font-extrabold text-emerald-400 mt-1">
                  {stats.totalOcrPages}
                  <span className="text-xs font-medium text-slate-400 ml-1">
                    ({stats.totalPages > 0 ? Math.round((stats.totalOcrPages / stats.totalPages) * 100) : 0}%)
                  </span>
                </span>
                <span className="text-[10px] text-slate-500 mt-0.5">หน้าที่มี OCR Cache</span>
              </div>
              <div className="rounded-2xl border border-white/8 bg-slate-900/60 p-3 flex flex-col">
                <span className="text-[10px] uppercase font-bold text-slate-400">แปลแล้ว</span>
                <span className="text-lg font-extrabold text-indigo-400 mt-1">
                  {stats.totalTranslationPages}
                  <span className="text-xs font-medium text-slate-400 ml-1">
                    ({stats.totalPages > 0 ? Math.round((stats.totalTranslationPages / stats.totalPages) * 100) : 0}%)
                  </span>
                </span>
                <span className="text-[10px] text-slate-500 mt-0.5">หน้าที่มีคำแปล</span>
              </div>
            </div>

            {/* Cache Storage Footprint Banner */}
            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3.5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 shrink-0">
                  <Database size={16} />
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-200">ขนาดแคชในฐานข้อมูล SQLite</div>
                  <div className="text-[10px] text-slate-400">เก็บเฉพาะตัวอักษรและพิกัด ไม่โคลนไฟล์ PDF ต้นฉบับ</div>
                </div>
              </div>
              <div className="text-right">
                <span className="text-sm font-bold text-cyan-300 font-mono">{formatBytes(stats.totalCacheSizeBytes)}</span>
              </div>
            </div>

            {/* Document List Breakdown */}
            <div>
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center justify-between">
                <span>รายการไฟล์ในโฟลเดอร์ ({stats.documents.length})</span>
              </div>
              <div className="space-y-1.5 max-h-56 overflow-y-auto custom-scrollbar pr-1">
                {stats.documents.length === 0 ? (
                  <div className="py-6 text-center text-xs text-slate-500 border border-white/5 rounded-2xl">
                    ไม่มีไฟล์ในโฟลเดอร์นี้
                  </div>
                ) : (
                  stats.documents.map((doc) => {
                    const ocrPct = doc.totalPages > 0 ? Math.min(100, Math.round((doc.ocrPages / doc.totalPages) * 100)) : 0;
                    const transPct = doc.totalPages > 0 ? Math.min(100, Math.round((doc.translationPages / doc.totalPages) * 100)) : 0;
                    return (
                      <div 
                        key={doc.id}
                        className="flex items-center justify-between p-2.5 rounded-xl border border-white/6 bg-slate-950/40 hover:bg-slate-900/50 transition-colors text-xs"
                      >
                        <div className="min-w-0 flex-1 pr-3">
                          <div className="font-medium text-slate-200 truncate">{doc.filename}</div>
                          <div className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-2">
                            <span>{doc.totalPages} หน้า</span>
                            <span>•</span>
                            <span className="text-emerald-400">OCR: {doc.ocrPages}/{doc.totalPages} ({ocrPct}%)</span>
                            <span>•</span>
                            <span className="text-indigo-400">แปล: {doc.translationPages}/{doc.totalPages} ({transPct}%)</span>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-[11px] font-mono text-slate-400">{formatBytes(doc.cacheSizeBytes)}</div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        ) : null}

        {/* Footer */}
        <div className="border-t border-white/10 pt-3 flex justify-end shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-semibold transition-colors"
          >
            ปิด
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export const CreateProjectModal: React.FC<{
  isOpen: boolean;
  name: string;
  color: string;
  parentId?: number | null;
  onChangeName: (name: string) => void;
  onChangeColor: (color: string) => void;
  onCreate: () => void;
  onClose: () => void;
}> = ({ isOpen, name, color, parentId, onChangeName, onChangeColor, onCreate, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="absolute inset-0 z-[170] flex items-center justify-center bg-black/55 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-950/95 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.45)] text-left flex flex-col gap-4">
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2.5">
            <div 
              className="w-8 h-8 rounded-xl flex items-center justify-center text-sm shadow-inner border border-white/10"
              style={{ backgroundColor: hexToRgba(color || '#38BDF8', 0.2) }}
            >
              <Folder size={16} style={{ color: color || '#38BDF8' }} />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-100">
                {parentId ? 'สร้างโฟลเดอร์ย่อย (Create Subfolder)' : 'สร้างโฟลเดอร์ใหม่ (Create Folder)'}
              </h3>
              <p className="text-xs text-slate-400">สำหรับจัดหมวดหมู่เอกสารในคลัง</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-white/10 text-slate-400 hover:text-slate-200 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div>
          <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1.5">
            ชื่อโฟลเดอร์ (Folder Name)
          </label>
          <input
            autoFocus
            type="text"
            value={name}
            onChange={(e) => onChangeName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onCreate();
            }}
            placeholder="Folder name"
            className="w-full rounded-2xl border border-white/10 bg-slate-900/70 px-4 py-2.5 text-sm text-slate-100 outline-none transition-colors focus:border-sky-400/60"
          />
        </div>

        <div>
          <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-2">
            เลือกสีไอคอนโฟลเดอร์ (Folder Color)
          </label>
          <div className="grid grid-cols-6 gap-2">
            {['#38BDF8', '#34D399', '#FBBF24', '#F472B6', '#A78BFA', '#FB7185'].map((c) => {
              const isSelected = (color || '').toUpperCase() === c.toUpperCase();
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => onChangeColor(c)}
                  className="h-8 w-8 rounded-full border border-white/10 transition-all flex items-center justify-center hover:scale-110 active:scale-95 shadow-sm"
                  style={{ 
                    backgroundColor: c,
                    boxShadow: isSelected ? `0 0 0 2px rgb(15, 23, 42), 0 0 0 4px ${c}` : 'none'
                  }}
                  title={c}
                >
                  {isSelected && <Check size={13} className="text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]" />}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-white/10 pt-3">
          <button
            onClick={onClose}
            className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            onClick={onCreate}
            disabled={!name.trim()}
            className="rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(14,165,233,0.35)] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Create (สร้าง)
          </button>
        </div>
      </div>
    </div>
  );
};

export const EditProjectModal: React.FC<{
  isOpen: boolean;
  name: string;
  color: string;
  onChangeName: (name: string) => void;
  onChangeColor: (color: string) => void;
  onSave: () => void;
  onClose: () => void;
}> = ({ isOpen, name, color, onChangeName, onChangeColor, onSave, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="absolute inset-0 z-[170] flex items-center justify-center bg-black/55 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-950/95 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.45)] text-left flex flex-col gap-4">
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2.5">
            <div 
              className="w-8 h-8 rounded-xl flex items-center justify-center text-sm shadow-inner border border-white/10"
              style={{ backgroundColor: hexToRgba(color || '#38BDF8', 0.2) }}
            >
              <Folder size={16} style={{ color: color || '#38BDF8' }} />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-100">แก้ไขโฟลเดอร์ (Edit Folder)</h3>
              <p className="text-xs text-slate-400">เปลี่ยนชื่อหรือเลือกสีไอคอนสำหรับโฟลเดอร์นี้</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-white/10 text-slate-400 hover:text-slate-200 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div>
          <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1.5">
            ชื่อโฟลเดอร์ (Folder Name)
          </label>
          <input
            autoFocus
            type="text"
            value={name}
            onChange={(e) => onChangeName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSave();
            }}
            placeholder="Folder name"
            className="w-full rounded-2xl border border-white/10 bg-slate-900/70 px-4 py-2.5 text-sm text-slate-100 outline-none transition-colors focus:border-sky-400/60"
          />
        </div>

        <div>
          <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-2">
            เลือกสีไอคอนโฟลเดอร์ (Folder Color)
          </label>
          <div className="grid grid-cols-6 gap-2">
            {['#38BDF8', '#34D399', '#FBBF24', '#F472B6', '#A78BFA', '#FB7185'].map((c) => {
              const isSelected = (color || '').toUpperCase() === c.toUpperCase();
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => onChangeColor(c)}
                  className="h-8 w-8 rounded-full border border-white/10 transition-all flex items-center justify-center hover:scale-110 active:scale-95 shadow-sm"
                  style={{ 
                    backgroundColor: c,
                    boxShadow: isSelected ? `0 0 0 2px rgb(15, 23, 42), 0 0 0 4px ${c}` : 'none'
                  }}
                  title={c}
                >
                  {isSelected && <Check size={13} className="text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]" />}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-white/10 pt-3">
          <button
            onClick={onClose}
            className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={!name.trim()}
            className="rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(14,165,233,0.35)] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Save (บันทึก)
          </button>
        </div>
      </div>
    </div>
  );
};

