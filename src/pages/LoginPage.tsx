import '@/styles/dashboard.css';
import { useState, useEffect, type FormEvent } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

const commandCentreLogo = (
  <img
    src="/cc.png"
    alt="Command Centre"
    className="h-10 w-10 shrink-0 rounded-xl object-contain shadow-lg"
  />
);

function dashboardPathForRoles(roles: string[]): string {
  const normalized = roles.map((role) => role.trim().toLowerCase().replace(/_/g, '-'));
  if (normalized.some((role) => role === 'super-admin' || role === 'admin')) {
    return '/admin';
  }
  if (normalized.includes('agent')) return '/agent';
  return '/';
}

export default function LoginPage() {
  const { login, isAuthenticated, isLoading, roles } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (isLoading || !isAuthenticated) return;
    navigate(dashboardPathForRoles(roles), { replace: true });
  }, [isAuthenticated, isLoading, navigate, roles]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    let valid = true;

    if (!email.trim()) {
      setEmailError('Email is required.');
      valid = false;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setEmailError('Enter a valid email address.');
      valid = false;
    } else {
      setEmailError(null);
    }

    if (!password) {
      setPasswordError('Password is required.');
      valid = false;
    } else {
      setPasswordError(null);
    }

    if (!valid) return;
    setLoading(true);

    // ── Sign-in (Next.js role-based flow commented out) ──────────────────
    // const userData = await fetchCurrentUser();
    // const { role, ownerUid, isSuperAdmin, suspended } = userData;
    // if (role === 'super_admin') router.replace('/admin-dashboard');
    // else if (role === 'branch_admin') router.replace('/branches');
    // else router.replace('/dashboard');
    // ─────────────────────────────────────────────────────────────────────

    try {
      const response = await login(email.trim(), password);
      const from = location.state && typeof location.state === 'object'
        ? (location.state as { from?: { pathname?: string } }).from?.pathname
        : undefined;
      navigate(from || dashboardPathForRoles(response.roles ?? []), { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-neutral-100">

      {/* ── Mobile: dark branded header ─────────────────────────────────── */}
      <div
        className={`lg:hidden relative overflow-hidden bg-neutral-950 px-6 pt-12 pb-10 transition-all duration-700 ${
          mounted ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <img src="/login-bg.jpeg" alt="" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-black/60" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/50" />
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-6">
            {commandCentreLogo}
            <div>
              <span className="text-white font-bold text-lg tracking-tight">Command Centre</span>
              <span className="text-neutral-500 text-[10px] font-semibold tracking-[0.3em] uppercase ml-2">
                Call Center
              </span>
            </div>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white leading-tight tracking-tight">
            Your calls,{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-neutral-300 to-neutral-500">
              fully managed.
            </span>
          </h1>
          <p className="text-neutral-500 text-sm mt-2 max-w-xs">
            Agents, queues, bookings & operations in one dashboard.
          </p>
        </div>
      </div>

      {/* ── Desktop: left hero panel ─────────────────────────────────────── */}
      <div className="hidden lg:flex lg:w-[55%] relative overflow-hidden bg-neutral-950">
        <img src="/login-bg.jpeg" alt="" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-black/50" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/40 to-black/30" />

        <div
          className={`relative z-10 flex flex-col p-12 xl:p-16 w-full transition-all duration-1000 ${
            mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
          }`}
        >
          {/* Logo */}
          <div className="flex items-center gap-3 mb-auto">
            {commandCentreLogo}
            <div>
              <span className="text-white font-bold text-lg tracking-tight">Command Centre</span>
              <span className="text-neutral-500 text-[10px] font-semibold tracking-[0.3em] uppercase ml-2">
                Call Center
              </span>
            </div>
          </div>

          {/* Headline */}
          <div className="max-w-lg my-auto">
            <h1 className="text-4xl xl:text-5xl font-bold text-white leading-[1.1] tracking-tight mb-5">
              Your calls,
              <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-neutral-200 to-neutral-500">
                fully managed.
              </span>
            </h1>
            <p className="text-neutral-400 text-base xl:text-lg leading-relaxed max-w-md">
              Agents, queues, bookings and operations — all from one powerful dashboard.
            </p>
            <div className="flex flex-wrap gap-2 mt-8">
              {['Live Calls', 'Agent Management', 'Bookings', 'SIP Lines', 'Multi-tenant'].map((f) => (
                <span
                  key={f}
                  className="px-3 py-1.5 rounded-full text-[11px] font-medium bg-white/[0.06] text-neutral-400 border border-white/[0.06]"
                >
                  {f}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Right / bottom: login form ───────────────────────────────────── */}
      <div className="flex-1 flex items-start lg:items-center justify-center bg-neutral-100 lg:bg-white px-5 sm:px-8 py-8 lg:px-12 lg:py-12">
        <div
          className={`w-full max-w-[420px] transition-all duration-700 delay-200 ${
            mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
          }`}
        >
          <div className="bg-white rounded-2xl lg:rounded-none lg:bg-transparent p-6 sm:p-8 lg:p-0 shadow-xl shadow-neutral-900/[0.04] lg:shadow-none border border-neutral-200/60 lg:border-0 -mt-6 lg:mt-0 relative z-10">

            {/* Header */}
            <div className="mb-7">
              <h2 className="text-xl sm:text-2xl font-bold text-neutral-900 tracking-tight">
                Welcome back
              </h2>
              <p className="text-sm text-neutral-400 mt-1">Sign in to your command centre</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">

              {/* Error banner */}
              {error && (
                <div className="rounded-xl bg-rose-50 border border-rose-200/60 text-rose-700 px-3.5 py-3 flex items-start gap-2.5 text-sm">
                  <div className="w-7 h-7 rounded-lg bg-rose-100 flex items-center justify-center shrink-0 mt-0.5">
                    <span className="text-rose-500 text-xs">✕</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-[13px]">Sign in failed</p>
                    <p className="text-rose-600/80 text-xs mt-0.5">{error}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setError(null)}
                    className="text-rose-400 hover:text-rose-600 transition p-1"
                  >
                    <span className="text-xs">✕</span>
                  </button>
                </div>
              )}

              {/* Email */}
              <div>
                <label className="block text-[13px] font-semibold text-neutral-700 mb-1.5">
                  Email
                </label>
                <input
                  type="email"
                  placeholder="name@company.com"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setEmailError(null); setError(null); }}
                  onBlur={() => {
                    if (!email.trim()) setEmailError('Email is required.');
                    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) setEmailError('Enter a valid email address.');
                  }}
                  className={`w-full px-4 py-3 text-sm bg-neutral-50/80 border-2 rounded-xl focus:ring-0 focus:border-neutral-900 focus:bg-white transition-all outline-none placeholder:text-neutral-400 ${
                    emailError ? 'border-rose-300 bg-rose-50/40' : 'border-neutral-200 hover:border-neutral-300'
                  }`}
                />
                {emailError && (
                  <p className="mt-1.5 text-xs text-rose-500 flex items-center gap-1.5">
                    <span className="text-[10px]">⚠</span>{emailError}
                  </p>
                )}
              </div>

              {/* Password */}
              <div>
                <label className="block text-[13px] font-semibold text-neutral-700 mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setPasswordError(null); setError(null); }}
                    onBlur={() => { if (!password) setPasswordError('Password is required.'); }}
                    className={`w-full px-4 py-3 pr-12 text-sm bg-neutral-50/80 border-2 rounded-xl focus:ring-0 focus:border-neutral-900 focus:bg-white transition-all outline-none placeholder:text-neutral-400 ${
                      passwordError ? 'border-rose-300 bg-rose-50/40' : 'border-neutral-200 hover:border-neutral-300'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    className="absolute inset-y-0 right-0 flex items-center justify-center px-4 text-neutral-400 hover:text-neutral-600 transition-colors"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? (
                      <EyeOff className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
                    ) : (
                      <Eye className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
                    )}
                  </button>
                </div>
                {passwordError && (
                  <p className="mt-1.5 text-xs text-rose-500 flex items-center gap-1.5">
                    <span className="text-[10px]">⚠</span>{passwordError}
                  </p>
                )}
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 bg-neutral-900 text-white text-sm font-semibold rounded-xl hover:bg-neutral-800 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-neutral-900/20 hover:shadow-xl hover:shadow-neutral-900/25 mt-1"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Signing in...
                  </span>
                ) : 'Sign in'}
              </button>
            </form>

            {/* Footer note */}
            <p className="text-[11px] text-neutral-400 mt-6 text-center font-mono uppercase tracking-[0.18em]">
              Contact your administrator for access
            </p>

          </div>

          {/* Terms */}
          <p className="text-[11px] text-neutral-400 mt-6 text-center leading-relaxed px-2">
            By continuing you agree to our{' '}
            <a href="#" className="text-neutral-500 hover:text-neutral-900 underline underline-offset-2 transition-colors">
              Terms
            </a>{' '}
            and{' '}
            <a href="#" className="text-neutral-500 hover:text-neutral-900 underline underline-offset-2 transition-colors">
              Privacy Policy
            </a>.
          </p>

          {/* Trust badges (mobile) */}
          <div className="flex items-center justify-center gap-4 mt-5 lg:hidden">
            <div className="flex items-center gap-1.5 text-neutral-400 text-[11px]">
              <span>🔒</span><span>Secured</span>
            </div>
            <div className="w-px h-3 bg-neutral-300" />
            <div className="flex items-center gap-1.5 text-neutral-400 text-[11px]">
              <span>🔐</span><span>Encrypted</span>
            </div>
            <div className="w-px h-3 bg-neutral-300" />
            <div className="flex items-center gap-1.5 text-neutral-400 text-[11px]">
              <span>⚡</span><span>Fast</span>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(100%); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
