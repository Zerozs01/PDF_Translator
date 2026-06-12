import React, { useState } from 'react';
import { KeyRound, ShieldCheck, Eye, EyeOff, Loader2, ChevronRight, ChevronLeft } from 'lucide-react';
import { useAuthStore } from '../../stores/useAuthStore';

export const SetupScreen: React.FC = () => {
  const [step, setStep] = useState<1 | 2>(1);
  
  // Step 1: Master Password States
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  
  // Step 2: Emergency PIN States
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [showConfirmPin, setShowConfirmPin] = useState(false);

  const [localError, setLocalError] = useState<string | null>(null);
  const { setup, isLoading, error: storeError, clearError } = useAuthStore();

  const handleNextStep = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    if (!password) {
      setLocalError('กรุณากรอกรหัสผ่านหลัก');
      return;
    }
    if (password.length < 6) {
      setLocalError('รหัสผ่านหลักต้องมีความยาวอย่างน้อย 6 ตัวอักษร');
      return;
    }
    if (password !== confirmPassword) {
      setLocalError('ยืนยันรหัสผ่านหลักไม่ตรงกัน');
      return;
    }

    setStep(2);
  };

  const handlePrevStep = () => {
    setLocalError(null);
    setStep(1);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    clearError();

    if (!pin) {
      setLocalError('กรุณากรอกรหัส PIN ฉุกเฉิน');
      return;
    }
    if (pin.length < 4 || pin.length > 6) {
      setLocalError('รหัส PIN ฉุกเฉินต้องมีความยาว 4-6 หลัก');
      return;
    }
    if (pin !== confirmPin) {
      setLocalError('ยืนยันรหัส PIN ฉุกเฉินไม่ตรงกัน');
      return;
    }

    await setup(password, pin);
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-[#0a0c10] text-slate-100 overflow-hidden font-sans select-none">
      {/* Sleek Gradient Background Orbs */}
      <div className="absolute -left-1/4 -top-1/4 h-[800px] w-[800px] rounded-full bg-gradient-to-tr from-[#3b82f6]/10 to-indigo-900/10 blur-[120px]" />
      <div className="absolute -right-1/4 -bottom-1/4 h-[800px] w-[800px] rounded-full bg-gradient-to-tr from-indigo-950/15 to-[#8b5cf6]/10 blur-[120px]" />

      {/* Glassmorphic Card Container */}
      <div className="relative w-full max-w-md overflow-hidden rounded-3xl border border-white/10 bg-[#12161f]/75 p-8 shadow-[0_20px_50px_rgba(0,0,0,0.4)] backdrop-blur-2xl transition-all duration-300">
        
        {/* Glow highlight */}
        <div className="absolute -left-[50%] top-0 h-[1px] w-[200%] bg-gradient-to-r from-transparent via-[#2563eb]/40 to-transparent" />
        
        {/* Decorative Ring */}
        <div className="absolute -right-12 -top-12 h-36 w-36 rounded-full border border-blue-500/10" />

        {/* Step Indicator */}
        <div className="mb-6 flex justify-between items-center px-1">
          <span className="text-[10px] font-bold text-blue-400 uppercase tracking-widest">
            Step {step} of 2
          </span>
          <div className="flex gap-1.5">
            <div className={`h-1.5 w-8 rounded-full transition-all duration-300 ${step >= 1 ? 'bg-blue-500' : 'bg-white/10'}`} />
            <div className={`h-1.5 w-8 rounded-full transition-all duration-300 ${step >= 2 ? 'bg-blue-500' : 'bg-white/10'}`} />
          </div>
        </div>

        {step === 1 ? (
          /* Step 1 Form: Master Password Setup */
          <form onSubmit={handleNextStep} className="space-y-6">
            <div className="flex flex-col items-center text-center">
              <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-500/10 border border-blue-500/25 text-blue-400 shadow-[0_0_20px_rgba(59,130,246,0.1)]">
                <KeyRound size={26} />
              </div>
              <h1 className="text-xl font-bold text-slate-100">ตั้งค่ารหัสผ่านหลัก</h1>
              <p className="mt-1.5 text-xs text-slate-400 leading-relaxed px-4">
                รหัสผ่านนี้จะใช้สำหรับการเข้าใช้งานแอปพลิเคชัน และนำไปใช้เป็นคีย์ในการเข้ารหัสฐานข้อมูล (Database Encryption)
              </p>
            </div>

            <div className="space-y-4">
              {/* Input Password */}
              <div className="space-y-1.5">
                <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                  รหัสผ่านหลัก (อย่างน้อย 6 ตัวอักษร)
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="ป้อนรหัสผ่าน..."
                    className="w-full rounded-xl border border-white/10 bg-[#191e2b]/80 pl-4 pr-11 py-2.5 text-xs text-slate-100 transition-all focus:border-blue-500/60 focus:outline-none focus:ring-1 focus:ring-blue-500/20"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-slate-300 transition-colors"
                  >
                    {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>

              {/* Input Confirm Password */}
              <div className="space-y-1.5">
                <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                  ยืนยันรหัสผ่านหลัก
                </label>
                <div className="relative">
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="ป้อนยืนยันรหัสผ่าน..."
                    className="w-full rounded-xl border border-white/10 bg-[#191e2b]/80 pl-4 pr-11 py-2.5 text-xs text-slate-100 transition-all focus:border-blue-500/60 focus:outline-none focus:ring-1 focus:ring-blue-500/20"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-slate-300 transition-colors"
                  >
                    {showConfirmPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
            </div>

            {localError && (
              <div className="rounded-xl border border-rose-500/20 bg-rose-950/20 px-3.5 py-2.5 text-xs text-rose-300">
                {localError}
              </div>
            )}

            <button
              type="submit"
              className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 py-3 text-xs font-bold text-white transition-all hover:from-blue-500 hover:to-indigo-500 active:scale-98"
            >
              ขั้นตอนถัดไป
              <ChevronRight size={14} />
            </button>
          </form>
        ) : (
          /* Step 2 Form: Emergency PIN Setup */
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="flex flex-col items-center text-center">
              <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/10 border border-amber-500/25 text-amber-400 shadow-[0_0_20px_rgba(245,158,11,0.1)]">
                <ShieldCheck size={26} />
              </div>
              <h1 className="text-xl font-bold text-slate-100">ตั้งค่ารหัส PIN ฉุกเฉิน</h1>
              <p className="mt-1.5 text-xs text-slate-400 leading-relaxed px-4">
                รหัสนี้จะใช้สำหรับยืนยัน "Emergency Wipe" เพื่อทำลายฐานข้อมูลและประวัติการแปลทั้งหมดทันที ในกรณีที่จำเป็น
              </p>
            </div>

            <div className="space-y-4">
              {/* Input PIN */}
              <div className="space-y-1.5">
                <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                  รหัส PIN ฉุกเฉิน (ตัวเลข 4-6 หลัก)
                </label>
                <div className="relative">
                  <input
                    type={showPin ? 'text' : 'password'}
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="ป้อนรหัส PIN ฉุกเฉิน..."
                    className="w-full rounded-xl border border-white/10 bg-[#191e2b]/80 pl-4 pr-11 py-2.5 text-xs text-slate-100 transition-all focus:border-amber-500/60 focus:outline-none focus:ring-1 focus:ring-amber-500/20"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPin(!showPin)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-slate-300 transition-colors"
                  >
                    {showPin ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>

              {/* Input Confirm PIN */}
              <div className="space-y-1.5">
                <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                  ยืนยันรหัส PIN ฉุกเฉิน
                </label>
                <div className="relative">
                  <input
                    type={showConfirmPin ? 'text' : 'password'}
                    value={confirmPin}
                    onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="ป้อนยืนยันรหัส PIN ฉุกเฉิน..."
                    className="w-full rounded-xl border border-white/10 bg-[#191e2b]/80 pl-4 pr-11 py-2.5 text-xs text-slate-100 transition-all focus:border-amber-500/60 focus:outline-none focus:ring-1 focus:ring-amber-500/20"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPin(!showConfirmPin)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-slate-300 transition-colors"
                  >
                    {showConfirmPin ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
            </div>

            {(localError || storeError) && (
              <div className="rounded-xl border border-rose-500/20 bg-rose-950/20 px-3.5 py-2.5 text-xs text-rose-300">
                {localError || storeError}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={handlePrevStep}
                disabled={isLoading}
                className="flex-1 inline-flex items-center justify-center gap-1 rounded-xl border border-white/10 bg-white/5 py-2.5 text-xs font-bold text-slate-300 transition-all hover:bg-white/10"
              >
                <ChevronLeft size={14} />
                ย้อนกลับ
              </button>
              <button
                type="submit"
                disabled={isLoading}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 py-2.5 text-xs font-bold text-white transition-all hover:from-blue-500 hover:to-indigo-500 disabled:opacity-50"
              >
                {isLoading ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    กำลังบันทึก...
                  </>
                ) : (
                  'เสร็จสิ้นตั้งค่า'
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
