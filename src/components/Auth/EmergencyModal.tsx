import React, { useState } from 'react';
import { RotateCcw, X, Eye, EyeOff, Loader2 } from 'lucide-react';
import { useAuthStore } from '../../stores/useAuthStore';

interface EmergencyModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const EmergencyModal: React.FC<EmergencyModalProps> = ({ isOpen, onClose }) => {
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const { hardReset, isLoading, error: storeError, clearError } = useAuthStore();

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    clearError();

    if (!pin.trim()) {
      setLocalError('กรุณากรอกรหัส PIN รีเซ็ตระบบ');
      return;
    }

    const success = await hardReset(pin);
    if (!success) {
      setLocalError('รหัส PIN รีเซ็ตระบบไม่ถูกต้อง');
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-md transition-opacity duration-300">
      <div 
        className="relative w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-[#121620]/95 p-6 shadow-[0_0_50px_rgba(0,0,0,0.5)] backdrop-blur-xl animate-in fade-in zoom-in-95 duration-200"
      >
        {/* Decorative Background Glow */}
        <div className="absolute -right-20 -top-20 h-40 w-40 rounded-full bg-slate-500/5 blur-[80px]" />
        <div className="absolute -bottom-20 -left-20 h-40 w-40 rounded-full bg-slate-700/5 blur-[80px]" />

        {/* Close Button */}
        <button
          onClick={onClose}
          disabled={isLoading}
          className="absolute right-4 top-4 p-1.5 rounded-lg border border-white/5 bg-white/5 text-slate-400 hover:text-slate-200 hover:bg-white/10 transition-all duration-200"
        >
          <X size={16} />
        </button>

        {/* Header */}
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-500/10 border border-white/10 text-slate-300 shadow-[0_0_20px_rgba(255,255,255,0.05)]">
            <RotateCcw size={24} className="text-slate-300 animate-spin-slow" />
          </div>
          <h2 className="text-lg font-bold text-slate-250">รีเซ็ตระบบ (Reset System)</h2>
          <p className="mt-2 text-xs text-slate-400/90 leading-relaxed px-4">
            การดำเนินการนี้จะล้างข้อมูลการตั้งค่า ประวัติทั้งหมด และเริ่มต้นระบบใหม่เสมือนเพิ่งติดตั้งแอปพลิเคชัน
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
              กรอกรหัส PIN รีเซ็ตระบบ
            </label>
            <div className="relative">
              <input
                type={showPin ? 'text' : 'password'}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                disabled={isLoading}
                placeholder="••••••"
                maxLength={6}
                autoFocus
                className="w-full text-center tracking-[0.7em] text-lg rounded-xl border border-white/10 bg-slate-900/60 py-3 text-slate-100 focus:outline-none focus:border-slate-500/60 focus:ring-1 focus:ring-slate-500/20 placeholder-slate-700 transition-all placeholder:tracking-normal"
              />
              <button
                type="button"
                onClick={() => setShowPin(!showPin)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-305 transition-colors"
              >
                {showPin ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {/* Errors */}
          {(localError || storeError) && (
            <div className="rounded-xl border border-rose-500/10 bg-rose-950/10 p-3 text-center text-xs text-rose-350">
              {localError || storeError}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="flex-1 rounded-xl border border-white/10 bg-white/5 py-2.5 text-xs font-semibold text-slate-300 hover:bg-white/10 active:scale-98 transition-all"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-slate-800 border border-white/10 py-2.5 text-xs font-semibold text-slate-100 shadow-md hover:bg-slate-700 hover:border-white/15 active:scale-98 transition-all disabled:opacity-50"
            >
              {isLoading ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  กำลังดำเนินการ...
                </>
              ) : (
                'ยืนยันรีเซ็ตระบบ'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
