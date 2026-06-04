interface ChatUnreadBadgeProps {
  count: number;
  className?: string;
}

export function ChatUnreadBadge({ count, className = '' }: ChatUnreadBadgeProps) {
  if (count <= 0) return null;
  const display = count > 9 ? '9+' : String(count);
  return (
    <span className={`inline-flex items-center justify-center bg-red-500 text-white text-[10px] font-bold min-w-[16px] h-4 rounded-full px-1 leading-none ${className}`}>
      {display}
    </span>
  );
}
