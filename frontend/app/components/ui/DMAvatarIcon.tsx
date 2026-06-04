/**
 * DM Avatar Icon - 城主专用头像 SVG 组件
 * 神秘兜帽人物形象，带有发光眼睛和 DM 字样
 */

export function DMAvatarIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* 背景圆形 */}
      <circle cx="50" cy="50" r="48" fill="#1f2937" />

      {/* 神秘兜帽轮廓 */}
      <path
        d="M50 12 C25 12, 15 35, 15 55 C15 75, 30 88, 50 88 C70 88, 85 75, 85 55 C85 35, 75 12, 50 12"
        fill="#374151"
        stroke="#6b7280"
        strokeWidth="2"
      />

      {/* 内部阴影/脸部区域 */}
      <ellipse
        cx="50"
        cy="52"
        rx="22"
        ry="26"
        fill="#111827"
      />

      {/* 神秘发光眼睛 */}
      <ellipse cx="40" cy="48" rx="5" ry="4" fill="#fbbf24" opacity="0.9" />
      <ellipse cx="60" cy="48" rx="5" ry="4" fill="#fbbf24" opacity="0.9" />
      <ellipse cx="40" cy="48" rx="2" ry="2" fill="#fff" />
      <ellipse cx="60" cy="48" rx="2" ry="2" fill="#fff" />

      {/* DM 字样 */}
      <text
        x="50"
        y="72"
        textAnchor="middle"
        fontSize="16"
        fontWeight="bold"
        fill="#9ca3af"
        fontFamily="sans-serif"
      >
        DM
      </text>
    </svg>
  );
}
