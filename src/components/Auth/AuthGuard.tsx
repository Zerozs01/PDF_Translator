import React, { useEffect } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { SetupScreen } from './SetupScreen';
import { LoginScreen } from './LoginScreen';
import { Loader2 } from 'lucide-react';

interface AuthGuardProps {
  children: React.ReactNode;
}

export const AuthGuard: React.FC<AuthGuardProps> = ({ children }) => {
  const { isUnlocked, isSetup, isLoading, checkStatus, autoLogin } = useAuthStore();

  // Allow OCR test harness ONLY during local development (import.meta.env.DEV is statically stripped in production)
  const isDevHarness = Boolean(
    import.meta.env.DEV
    && typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('ocr_harness') === '1'
  );

  useEffect(() => {
    if (isDevHarness) return;
    // ตรวจสอบสถานะการตั้งค่าความปลอดภัยและพยายามทำ auto-login หากเปิด Relax Mode
    const initAuth = async () => {
      await checkStatus();
      await autoLogin();
    };
    void initAuth();
  }, [checkStatus, autoLogin, isDevHarness]);

  if (isDevHarness) {
    return <>{children}</>;
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#0a0c10] text-slate-100 font-sans select-none">
        <div className="relative flex flex-col items-center">
          <div className="absolute h-16 w-16 rounded-full border border-indigo-500/10 bg-indigo-500/5 blur-md" />
          <Loader2 size={32} className="animate-spin text-indigo-500 relative z-10" />
          <span className="mt-4 text-[10px] font-bold text-slate-400/80 uppercase tracking-widest">
            กำลังตรวจสอบสิทธิ์ความปลอดภัย...
          </span>
        </div>
      </div>
    );
  }

  if (!isUnlocked) {
    if (!isSetup) {
      return <SetupScreen />;
    }
    return <LoginScreen />;
  }

  return <>{children}</>;
};

