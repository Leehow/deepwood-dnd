/**
 * Connection Status Indicator
 * Displays WebSocket connection health and latency
 */
import { ConnectionHealth } from '~/hooks/useWebSocket';

interface ConnectionStatusProps {
  isConnected: boolean;
  health: ConnectionHealth;
  className?: string;
  compact?: boolean; // 只显示圆点，不显示文字
}

export function ConnectionStatus({ isConnected, health, className = '', compact = false }: ConnectionStatusProps) {
  if (!isConnected) {
    if (compact) {
      return (
        <div className={`flex items-center ${className}`} title="已断开连接">
          <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
        </div>
      );
    }
    return (
      <div className={`flex items-center gap-2 text-xs ${className}`}>
        <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
        <span className="text-red-400">已断开连接</span>
      </div>
    );
  }

  const statusColor = health.isHealthy ? 'bg-green-500' : 'bg-yellow-500';
  const statusText = health.isHealthy ? '已连接' : '连接不稳定';
  const textColor = health.isHealthy ? 'text-green-400' : 'text-yellow-400';

  if (compact) {
    const title = health.latency !== null ? `${statusText} (${health.latency}ms)` : statusText;
    return (
      <div className={`flex items-center ${className}`} title={title}>
        <div className={`w-2 h-2 rounded-full ${statusColor}`} />
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-2 text-xs ${className}`}>
      <div className={`w-2 h-2 rounded-full ${statusColor}`} />
      <span className={textColor}>{statusText}</span>
      {health.latency !== null && (
        <span className="text-gray-400">
          ({health.latency}ms)
        </span>
      )}
    </div>
  );
}
