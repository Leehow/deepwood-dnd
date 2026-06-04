/**
 * Logger utility for production-safe logging
 * Automatically filters logs in production environment
 */

interface LogLevel {
  DEBUG: 0;
  INFO: 1;
  WARN: 2;
  ERROR: 3;
}

interface LogConfig {
  enableInProduction: boolean;
  sendToMonitoring: boolean;
  monitoringEndpoint?: string;
}

class Logger {
  private module: string;
  private isDevelopment: boolean;
  private config: LogConfig;

  constructor(module: string, config?: Partial<LogConfig>) {
    this.module = module;
    this.isDevelopment = import.meta.env.MODE === 'development';
    this.config = {
      enableInProduction: false,
      sendToMonitoring: true,
      monitoringEndpoint: import.meta.env.VITE_MONITORING_URL,
      ...config
    };
  }

  private formatMessage(level: string, message: string): string {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${level}] [${this.module}] ${message}`;
  }

  private shouldLog(level: keyof LogLevel): boolean {
    if (this.isDevelopment) return true;
    if (this.config.enableInProduction) return true;
    return level === 'ERROR'; // Always log errors
  }

  debug(message: string, ...data: any[]): void {
    if (this.shouldLog('DEBUG')) {
      const formattedMessage = this.formatMessage('DEBUG', message);
      console.log(formattedMessage, ...data);
    }
  }

  info(message: string, ...data: any[]): void {
    if (this.shouldLog('INFO')) {
      const formattedMessage = this.formatMessage('INFO', message);
      console.info(formattedMessage, ...data);
    }
  }

  warn(message: string, ...data: any[]): void {
    if (this.shouldLog('WARN')) {
      const formattedMessage = this.formatMessage('WARN', message);
      console.warn(formattedMessage, ...data);
    }
  }

  error(message: string, error?: any): void {
    const formattedMessage = this.formatMessage('ERROR', message);

    if (this.shouldLog('ERROR')) {
      if (error) {
        console.error(formattedMessage, error);
      } else {
        console.error(formattedMessage);
      }
    }

    // Send to monitoring service in production
    if (!this.isDevelopment && this.config.sendToMonitoring) {
      this.sendToMonitoring(formattedMessage, error);
    }
  }

  private async sendToMonitoring(message: string, error?: any): Promise<void> {
    if (!this.config.monitoringEndpoint) return;

    try {
      const payload = {
        message,
        error: error ? {
          message: error.message || String(error),
          stack: error.stack,
          name: error.name
        } : undefined,
        module: this.module,
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent,
        url: window.location.href
      };

      // Send to monitoring service (e.g., Sentry, LogRocket, etc.)
      await fetch(this.config.monitoringEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      // Silently fail - we don't want logging to break the app
      if (this.isDevelopment) {
        console.error('Failed to send log to monitoring:', e);
      }
    }
  }

  /**
   * Group related logs together
   */
  group(label: string): void {
    if (this.shouldLog('DEBUG')) {
      console.group(this.formatMessage('GROUP', label));
    }
  }

  groupEnd(): void {
    if (this.shouldLog('DEBUG')) {
      console.groupEnd();
    }
  }

  /**
   * Measure performance
   */
  time(label: string): void {
    if (this.shouldLog('DEBUG')) {
      console.time(`[${this.module}] ${label}`);
    }
  }

  timeEnd(label: string): void {
    if (this.shouldLog('DEBUG')) {
      console.timeEnd(`[${this.module}] ${label}`);
    }
  }

  /**
   * Create a table for structured data
   */
  table(data: any): void {
    if (this.shouldLog('DEBUG')) {
      console.log(this.formatMessage('TABLE', 'Data table:'));
      console.table(data);
    }
  }
}

/**
 * Factory function to create logger instances
 * @param module - Module name for context
 * @param config - Optional configuration
 * @returns Logger instance
 */
export const createLogger = (module: string, config?: Partial<LogConfig>): Logger => {
  return new Logger(module, config);
};

/**
 * Default logger instance for quick usage
 */
export const defaultLogger = new Logger('App');

/**
 * Specialized loggers for common modules
 */
export const loggers = {
  websocket: createLogger('WebSocket'),
  api: createLogger('API'),
  store: createLogger('Store'),
  component: createLogger('Component'),
  hook: createLogger('Hook'),
  util: createLogger('Util')
};

export default Logger;
