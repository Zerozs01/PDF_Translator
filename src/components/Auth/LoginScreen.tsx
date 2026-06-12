import React, { useState } from 'react';
import { Lock, Unlock, Eye, EyeOff, Loader2, RotateCcw } from 'lucide-react';
import { useAuthStore } from '../../stores/useAuthStore';
import { EmergencyModal } from './EmergencyModal';

export const LoginScreen: React.FC = () => {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isEmergencyOpen, setIsEmergencyOpen] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const { login, isLoading, error: storeError, clearError } = useAuthStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    clearError();

    if (!password) {
      setLocalError('กรุณากรอกรหัสผ่านหลักเพื่อปลดล็อก');
      return;
    }

    const success = await login(password);
    if (!success) {
      setPassword(''); // clear password field on fail
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-[#0a0c10] text-slate-100 overflow-hidden font-sans select-none">
      {/* Sleek Gradient Background Orbs */}
      <div className="absolute -left-1/4 -top-1/4 h-[800px] w-[800px] rounded-full bg-gradient-to-tr from-indigo-900/20 to-blue-900/10 blur-[120px] animate-pulse duration-[10000ms]" />
      <div className="absolute -right-1/4 -bottom-1/4 h-[800px] w-[800px] rounded-full bg-gradient-to-tr from-purple-900/20 to-indigo-950/15 blur-[120px] animate-pulse duration-[8000ms]" />

      {/* Glassmorphic Card Container */}
      <div className="relative w-full max-w-md overflow-hidden rounded-3xl border border-white/10 bg-[#12161f]/75 p-8 shadow-[0_20px_50px_rgba(0,0,0,0.4)] backdrop-blur-2xl transition-all duration-300">
        
        {/* Glow highlight */}
        <div className="absolute -left-[50%] top-0 h-[1px] w-[200%] bg-gradient-to-r from-transparent via-[#4f46e5]/40 to-transparent" />
        
        {/* Decorative Ring */}
        <div className="absolute -right-12 -top-12 h-36 w-36 rounded-full border border-indigo-500/10" />

        {/* Brand Header */}
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-tr from-indigo-500/10 to-indigo-500/20 border border-indigo-500/35 text-indigo-400 shadow-[0_0_30px_rgba(99,102,241,0.15)] transition-all duration-300 hover:rotate-6 hover:scale-105">
            <Lock size={30} className="text-indigo-400" />
          </div>
          <h1 className="bg-gradient-to-r from-slate-100 via-slate-100 to-indigo-200 bg-clip-text text-2xl font-black tracking-tight text-transparent">
            PDF Translator
          </h1>
          <p className="mt-2 text-xs text-slate-400/80 uppercase tracking-widest font-semibold">
            Secure Desktop Environment
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              รหัสผ่านหลัก (Master Password)
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
                placeholder="กรอกรหัสผ่านหลัก..."
                autoFocus
                className="w-full rounded-xl border border-white/10 bg-[#191e2b]/80 pl-4 pr-11 py-3 text-sm text-slate-100 placeholder-slate-500 transition-all focus:border-indigo-500/60 focus:outline-none focus:ring-1 focus:ring-indigo-500/20 focus:bg-[#1a2030]"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-colors"
                title={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {/* Errors display */}
          {(localError || storeError) && (
            <div className="rounded-xl border border-rose-500/20 bg-rose-950/20 px-4 py-3 text-xs text-rose-300 animate-in fade-in slide-in-from-top-2 duration-200">
              {localError || storeError}
            </div>
          )}

          {/* Login Button */}
          <button
            type="submit"
            disabled={isLoading}
            className="group relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-950/50 transition-all duration-300 hover:from-indigo-500 hover:to-blue-500 active:scale-[0.98] disabled:opacity-50"
          >
            {isLoading ? (
              <>
                <Loader2 size={16} className="animate-spin text-white" />
                กำลังปลดล็อกแอปพลิเคชัน...
              </>
            ) : (
              <>
                <Unlock size={16} className="transition-transform group-hover:rotate-12" />
                ปลดล็อกแอปพลิเคชัน
              </>
            )}
          </button>
        </form>

        {/* Footer / System Reset trigger */}
        <div className="mt-8 flex justify-center border-t border-white/5 pt-5 text-center">
          <button
            onClick={() => setIsEmergencyOpen(true)}
            className="inline-flex items-center gap-1.5 text-[10px] font-bold text-slate-500/70 uppercase tracking-widest hover:text-slate-400 transition-colors py-1.5 px-3 rounded-lg hover:bg-white/5 border border-transparent hover:border-white/5"
          >
            <RotateCcw size={12} className="text-slate-500" />
            รีเซ็ตระบบ (Reset System)
          </button>
        </div>
      </div>

      {/* Emergency Wipe Modal */}
      <EmergencyModal isOpen={isEmergencyOpen} onClose={() => setIsEmergencyOpen(false)} />
    </div>
  );
};
