import React from 'react';

// ─── Class Source Badge ──────────────────────────
const CLASS_NAMES: Record<string, string> = {
  wizard: '法师', cleric: '牧师', druid: '德鲁伊', sorcerer: '术士',
  bard: '吟游诗人', warlock: '邪术师', paladin: '圣骑士', ranger: '游侠',
  fighter: '战士', rogue: '游荡者', racial: '种族', invocation: '祈唤', unknown: '未知',
};
const CLASS_BADGE_COLORS: Record<string, string> = {
  wizard: 'bg-blue-800/50 text-blue-200 border-blue-500/40',
  cleric: 'bg-amber-800/50 text-amber-200 border-amber-500/40',
  druid: 'bg-green-800/50 text-green-200 border-green-500/40',
  sorcerer: 'bg-red-800/50 text-red-200 border-red-500/40',
  bard: 'bg-pink-800/50 text-pink-200 border-pink-500/40',
  warlock: 'bg-purple-800/50 text-purple-200 border-purple-500/40',
  paladin: 'bg-yellow-800/50 text-yellow-200 border-yellow-500/40',
  ranger: 'bg-emerald-800/50 text-emerald-200 border-emerald-500/40',
  fighter: 'bg-orange-800/50 text-orange-200 border-orange-500/40',
  rogue: 'bg-gray-700/50 text-gray-200 border-gray-500/40',
  racial: 'bg-violet-800/50 text-violet-200 border-violet-500/40',
  invocation: 'bg-teal-800/50 text-teal-200 border-teal-500/40',
  unknown: 'bg-gray-700/50 text-gray-300 border-gray-500/40',
};

export function SourceBadge({ source }: { source: string }) {
  return (
    <span className={`px-1 py-0.5 text-[9px] rounded border whitespace-nowrap ${CLASS_BADGE_COLORS[source] || CLASS_BADGE_COLORS.unknown}`}>
      {CLASS_NAMES[source] || source}
    </span>
  );
}

// ─── Ornamental Corner ───────────────────────────
/** Decorative corner piece. Mirror with CSS scale for each dialog corner. */
export function CornerOrnament({ className = '', color }: { className?: string; color?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={`w-12 h-12 pointer-events-none ${color ? '' : 'text-amber-500/60'} ${className}`} fill="none" style={color ? { color } : undefined}>
      <path d="M4 36L4 4L36 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M10 26C10 12 12 10 26 10" stroke="currentColor" strokeWidth="0.7" opacity="0.6" />
      <path d="M4 4C9 1 13 5 11 10" stroke="currentColor" strokeWidth="0.7" opacity="0.7" />
      <path d="M4 4C1 9 5 13 10 11" stroke="currentColor" strokeWidth="0.7" opacity="0.7" />
      <path d="M4 0L8 4L4 8L0 4Z" fill="currentColor" opacity="0.7" />
      <circle cx="36" cy="4" r="1.2" fill="currentColor" opacity="0.5" />
      <circle cx="4" cy="36" r="1.2" fill="currentColor" opacity="0.5" />
      <line x1="20" y1="3" x2="20" y2="5" stroke="currentColor" strokeWidth="0.4" opacity="0.4" />
      <line x1="3" y1="20" x2="5" y2="20" stroke="currentColor" strokeWidth="0.4" opacity="0.4" />
    </svg>
  );
}

// ─── Horizontal Divider ──────────────────────────
export function SpellDivider({ label, className = '' }: { label?: string; className?: string }) {
  return (
    <div className={`flex items-center gap-3 my-2 ${className}`}>
      <div className="flex-1 h-px bg-gradient-to-r from-transparent via-amber-600/40 to-transparent" />
      {label != null && (
        <div className="flex items-center gap-2">
          <svg viewBox="0 0 10 10" className="w-1.5 h-1.5 text-amber-500/60">
            <path d="M5 0L10 5L5 10L0 5Z" fill="currentColor" />
          </svg>
          <span className="text-[10px] tracking-[0.15em] text-amber-400/80 whitespace-nowrap">
            {label}
          </span>
          <svg viewBox="0 0 10 10" className="w-1.5 h-1.5 text-amber-500/60">
            <path d="M5 0L10 5L5 10L0 5Z" fill="currentColor" />
          </svg>
        </div>
      )}
      <div className="flex-1 h-px bg-gradient-to-r from-transparent via-amber-600/40 to-transparent" />
    </div>
  );
}

// ─── Spell Slot Gem ──────────────────────────────
export function SlotGem({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width={14} height={14} className="inline-block flex-shrink-0">
      <path
        d="M8 1.5L14.5 8L8 14.5L1.5 8Z"
        fill={filled ? '#D4AD4F' : 'rgba(45,38,60,0.9)'}
        stroke={filled ? '#F0D880' : 'rgba(100,88,120,0.7)'}
        strokeWidth="1"
      />
      {filled && (
        <>
          <path d="M8 4L11.5 8L8 10.5" fill="none" stroke="rgba(255,248,230,0.4)" strokeWidth="0.7" />
          <path d="M5 6L8 3.5" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="0.5" />
        </>
      )}
    </svg>
  );
}

export function SlotGemRow({ current, max }: { current: number; max: number }) {
  if (max <= 0) return null;
  return (
    <div className="flex items-center gap-px">
      {Array.from({ length: max }, (_, i) => (
        <SlotGem key={i} filled={i < current} />
      ))}
    </div>
  );
}

// ─── Level Section Header ────────────────────────
export function LevelHeader({ level, current, max }: {
  level: number; current?: number; max?: number;
}) {
  return (
    <div className="flex items-center gap-3 mb-1.5 mt-1">
      <div className="flex-1 h-px bg-gradient-to-r from-amber-600/50 to-transparent" />
      <div className="flex items-center gap-2">
        <span className="text-[11px] tracking-wider text-amber-300/90 tabular-nums">
          {level}环
        </span>
        {max != null && max > 0 && current != null && (
          <>
            <SlotGemRow current={current} max={max} />
            <span className="text-[9px] text-amber-400/60 tabular-nums">
              {current}/{max}
            </span>
          </>
        )}
      </div>
      <div className="flex-1 h-px bg-gradient-to-l from-amber-600/50 to-transparent" />
    </div>
  );
}

// ─── Book Icon ───────────────────────────────────
export function BookIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`w-5 h-5 ${className}`} fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
    </svg>
  );
}

// ─── School Accent Colors ────────────────────────
export const SCHOOL_ACCENTS: Record<string, string> = {
  abjuration: 'bg-blue-400/70',
  conjuration: 'bg-purple-400/70',
  divination: 'bg-yellow-400/70',
  enchantment: 'bg-pink-400/70',
  evocation: 'bg-red-400/70',
  illusion: 'bg-teal-400/70',
  necromancy: 'bg-emerald-400/70',
  transmutation: 'bg-green-400/70',
};

// ─── Scroll Frame ───────────────────────────────

/** Arcane corner filigree — interlocking curves with a gem accent */
function ScrollCorner({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 80 80" className={`w-16 h-16 pointer-events-none ${className}`} fill="none">
      {/* Outer sweeping arc */}
      <path d="M6 50 C6 18 18 6 50 6" stroke="url(#scg)" strokeWidth="1.2" strokeLinecap="round" opacity="0.7" />
      {/* Inner arc — tighter, thinner */}
      <path d="M10 38 C12 16 16 12 38 10" stroke="url(#scg)" strokeWidth="0.8" opacity="0.5" />
      {/* Tiny decorative curl at the corner */}
      <path d="M6 6 C12 2 16 6 13 12" stroke="url(#scg)" strokeWidth="0.9" strokeLinecap="round" opacity="0.6" />
      <path d="M6 6 C2 12 6 16 12 13" stroke="url(#scg)" strokeWidth="0.9" strokeLinecap="round" opacity="0.6" />
      {/* Ornamental diamond at the vertex */}
      <path d="M6 2 L10 6 L6 10 L2 6Z" fill="url(#scg)" opacity="0.55" />
      {/* Small terminal dots */}
      <circle cx="50" cy="6" r="1.3" fill="url(#scg)" opacity="0.45" />
      <circle cx="6" cy="50" r="1.3" fill="url(#scg)" opacity="0.45" />
      {/* Delicate midpoint ticks */}
      <line x1="28" y1="5" x2="28" y2="8" stroke="url(#scg)" strokeWidth="0.5" opacity="0.35" />
      <line x1="5" y1="28" x2="8" y2="28" stroke="url(#scg)" strokeWidth="0.5" opacity="0.35" />
      {/* Shared gradient */}
      <defs>
        <linearGradient id="scg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f0d880" />
          <stop offset="100%" stopColor="#8b5c2a" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/** Top/bottom parchment curl — subtle shadow band implying a rolled edge */
function ScrollEdge({ position }: { position: 'top' | 'bottom' }) {
  const isTop = position === 'top';
  return (
    <div className="absolute left-3 right-3 pointer-events-none z-20"
      style={{ [isTop ? 'top' : 'bottom']: 0, height: 10 }}>
      <svg width="100%" height="10" viewBox="0 0 400 10" preserveAspectRatio="none">
        <defs>
          <linearGradient id={`curl-${position}`} x1="0" y1={isTop ? '0' : '1'} x2="0" y2={isTop ? '1' : '0'}>
            <stop offset="0%" stopColor="rgba(10,8,4,0.55)" />
            <stop offset="50%" stopColor="rgba(40,30,18,0.18)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0)" />
          </linearGradient>
        </defs>
        <rect width="400" height="10" fill={`url(#curl-${position})`} />
        {/* Fine line implying the fold crease */}
        <line x1="10" y1={isTop ? 1.5 : 8.5} x2="390" y2={isTop ? 1.5 : 8.5}
          stroke="rgba(139,92,42,0.18)" strokeWidth="0.6" />
      </svg>
    </div>
  );
}

/** Left/right parchment side shadow */
function SideGrain({ side }: { side: 'left' | 'right' }) {
  const isLeft = side === 'left';
  return (
    <div className="absolute top-0 bottom-0 pointer-events-none z-20"
      style={{ [side]: 0, width: 18 }}>
      <svg width="100%" height="100%" viewBox="0 0 18 100" preserveAspectRatio="none">
        <defs>
          <linearGradient id={`sg-${side}`} x1={isLeft ? '0' : '1'} y1="0" x2={isLeft ? '1' : '0'} y2="0">
            <stop offset="0%" stopColor="rgba(10,8,4,0.45)" />
            <stop offset="35%" stopColor="rgba(40,30,18,0.12)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0)" />
          </linearGradient>
        </defs>
        <rect width="18" height="100" fill={`url(#sg-${side})`} />
        <line x1={isLeft ? 2.5 : 15.5} y1="0" x2={isLeft ? 2.5 : 15.5} y2="100"
          stroke="rgba(139,92,42,0.13)" strokeWidth="0.5" />
      </svg>
    </div>
  );
}

export function ScrollFrame({ children, className = '' }: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`scroll-frame flex flex-col relative ${className}`}>
      {/* Corner filigrees */}
      <div className="absolute -top-1 -left-1 z-30"><ScrollCorner /></div>
      <div className="absolute -top-1 -right-1 z-30 -scale-x-100"><ScrollCorner /></div>
      <div className="absolute -bottom-1 -left-1 z-30 -scale-y-100"><ScrollCorner /></div>
      <div className="absolute -bottom-1 -right-1 z-30 scale-[-1]"><ScrollCorner /></div>
      {/* Top & bottom parchment curl shadows */}
      <ScrollEdge position="top" />
      <ScrollEdge position="bottom" />
      {/* Left & right grain */}
      <SideGrain side="left" />
      <SideGrain side="right" />
      {/* Warm candlelight inner glow overlay */}
      <div className="absolute inset-0 rounded-[14px] pointer-events-none z-20"
        style={{ boxShadow: 'inset 0 0 50px rgba(212,173,79,0.04), inset 0 0 100px rgba(0,0,0,0.2)' }} />
      {children}
    </div>
  );
}
