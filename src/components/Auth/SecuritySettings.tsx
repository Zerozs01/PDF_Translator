import React, { useState } from 'react';
import { Shield, Eye, EyeOff, Loader2, KeyRound, Check } from 'lucide-react';
import { useAuthStore } from '../../stores/useAuthStore';

export const SecuritySettings: React.FC = () => {
  const { appMode, setMode, isLoading, error: storeError, clearError } = useAuthStore();
  const [isChangingToRelax, setIsChangingToRelax] = useState(false);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleToggleMode = async (newMode: 'RELAX' | 'SECURITY') => {
    setLocalError(null);
    clearError();

    if (newMode === 'RELAX') {
      setIsChangingToRelax(true);
      setPassword('');
      return;
    }

    // Changing to SECURITY mode (no password required to downgrade security)
    await setMode('SECURITY');
  };

  const handleConfirmRelax = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    clearError();

    if (!password) {
      setLocalError('กรุณากรอกรหัสผ่านหลักเพื่อยืนยัน');
      return;
    }

    const success = await setMode('RELAX', password);
    if (success) {
      setIsChangingToRelax(false);
      setPassword('');
    } else {
      setLocalError('รหัสผ่านหลักไม่ถูกต้อง');
    }
  };

  return (
    <div className="rounded-xl border border-white/10 bg-[#13151a]/92 p-3 space-y-3">
      <div className="flex items-center justify-between border-b border-white/5 pb-2">
        <label className="text-[11px] font-bold text-slate-300 flex items-center gap-1.5">
          <Shield size={13} className="text-indigo-400" />
          Login Mode
        </label>
        <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider ${
          appMode === 'RELAX' 
            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
            : 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20'
        }`}>
          {appMode === 'RELAX' ? 'Relax' : 'Security'}
        </span>
      </div>

      {!isChangingToRelax ? (
        <div className="space-y-2.5">
          <p className="text-[10px] text-slate-400/80 leading-relaxed">
            สลับโหมดการทำงานตามความเหมาะสมเพื่อความสะดวกหรือความปลอดภัยสูงสุด
          </p>
          
          <div className="flex gap-2">
            {/* Security Mode Button */}
            <button
              type="button"
              disabled={isLoading}
              onClick={() => appMode !== 'SECURITY' && handleToggleMode('SECURITY')}
              className={`flex-1 flex flex-col items-center justify-center p-2 rounded-lg border text-center transition-all ${
                appMode === 'SECURITY'
                  ? 'border-indigo-500/35 bg-indigo-950/20 text-indigo-200'
                  : 'border-white/5 bg-slate-900/50 text-slate-400 hover:border-white/10 hover:text-slate-300'
              }`}
            >
              <span className="text-[10px] font-bold">Security Mode</span>
              <span className="text-[8px] text-slate-500 mt-0.5">บังคับใส่รหัสทุกครั้ง</span>
            </button>

            {/* Relax Mode Button */}
            <button
              type="button"
              disabled={isLoading}
              onClick={() => appMode !== 'RELAX' && handleToggleMode('RELAX')}
              className={`flex-1 flex flex-col items-center justify-center p-2 rounded-lg border text-center transition-all ${
                appMode === 'RELAX'
                  ? 'border-emerald-500/35 bg-emerald-950/20 text-emerald-200'
                  : 'border-white/5 bg-slate-900/50 text-slate-400 hover:border-white/10 hover:text-slate-300'
              }`}
            >
              <span className="text-[10px] font-bold">Relax Mode</span>
              <span className="text-[8px] text-slate-500 mt-0.5">Auto-login ด้วย Keychain</span>
            </button>
          </div>
        </div>
      ) : (
        /* Password Confirmation for Relax Mode */
        <form onSubmit={handleConfirmRelax} className="space-y-2.5 animate-in fade-in duration-200">
          <p className="text-[10px] text-amber-300/80 leading-relaxed font-semibold">
            ต้องการยืนยันรหัสผ่านหลักเพื่อผูกข้อมูลเข้ากับ OS Keychain สำหรับโหมด Relax
          </p>

          <div className="relative">
            <KeyRound size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="ยืนยันรหัสผ่านหลัก..."
              className="w-full rounded-lg border border-white/12 bg-slate-900/85 pl-7 pr-8 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-[#2B9BFF]/55"
              autoFocus
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-white/10"
            >
              {showPassword ? <EyeOff size={11} /> : <Eye size={11} />}
            </button>
          </div>

          {(localError || storeError) && (
            <p className="text-[9px] text-rose-300">
              {localError || storeError}
            </p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              disabled={isLoading}
              onClick={() => setIsChangingToRelax(false)}
              className="flex-1 rounded-lg border border-white/10 bg-slate-900/40 py-1.5 text-[10px] font-semibold text-slate-300 hover:bg-slate-800 transition-colors"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg bg-emerald-600 py-1.5 text-[10px] font-semibold text-white hover:bg-emerald-500 transition-colors"
            >
              {isLoading ? (
                <Loader2 size={10} className="animate-spin" />
              ) : (
                <Check size={10} />
              )}
              ยืนยันเปิดโหมด
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
