/**
 * Performance monitoring hook for tracking frontend metrics.
 * Part of the project optimization initiative.
 */

import { useEffect, useRef, useCallback, useState } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8174';

interface PerformanceMetric {
  metric_type: 'fps' | 'latency' | 'memory_usage' | 'response_time';
  component: string;
  value: number;
  unit: string;
  threshold?: number;
  context?: Record<string, any>;
}

interface PerformanceReport {
  fps: number;
  frameTime: number;
  memoryUsage?: number;
  renderCount: number;
  errorCount: number;
  slowFrames: number;
}

/**
 * Hook to monitor performance metrics like FPS and render times.
 * Automatically reports metrics to the backend optimization API.
 */
export function usePerformanceMonitor(componentName: string, enabled: boolean = true) {
  const frameCountRef = useRef(0);
  const lastTimeRef = useRef(performance.now());
  const fpsRef = useRef(0);
  const renderCountRef = useRef(0);
  const errorCountRef = useRef(0);
  const slowFramesRef = useRef(0);
  const rafIdRef = useRef<number>();
  const metricsBufferRef = useRef<PerformanceMetric[]>([]);
  const lastFlushRef = useRef(Date.now());

  const [report, setReport] = useState<PerformanceReport>({
    fps: 0,
    frameTime: 0,
    memoryUsage: 0,
    renderCount: 0,
    errorCount: 0,
    slowFrames: 0
  });

  /**
   * Send metrics to the backend
   */
  const flushMetrics = useCallback(async () => {
    if (metricsBufferRef.current.length === 0) return;

    const metrics = [...metricsBufferRef.current];
    metricsBufferRef.current = [];

    try {
      const token = localStorage.getItem('dnd_auth_token');

      // Send each metric to the backend
      for (const metric of metrics) {
        await fetch(`${API_BASE_URL}/api/optimization/metrics`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': token ? `Bearer ${token}` : ''
          },
          body: JSON.stringify(metric)
        });
      }
    } catch (error) {
      console.error('Failed to send performance metrics:', error);
    }
  }, []);

  /**
   * Record a performance metric
   */
  const recordMetric = useCallback((metric: PerformanceMetric) => {
    metricsBufferRef.current.push({
      ...metric,
      context: {
        ...metric.context,
        userAgent: navigator.userAgent,
        timestamp: new Date().toISOString()
      }
    });

    // Flush every 10 seconds or when buffer gets large
    const now = Date.now();
    if (metricsBufferRef.current.length >= 20 ||
        now - lastFlushRef.current > 10000) {
      lastFlushRef.current = now;
      flushMetrics();
    }
  }, [flushMetrics]);

  /**
   * Track FPS using requestAnimationFrame
   */
  const measureFPS = useCallback(() => {
    const currentTime = performance.now();
    const deltaTime = currentTime - lastTimeRef.current;

    frameCountRef.current++;

    // Update FPS every second
    if (deltaTime >= 1000) {
      const fps = Math.round((frameCountRef.current * 1000) / deltaTime);
      fpsRef.current = fps;

      // Track slow frames (< 30 FPS)
      if (fps < 30) {
        slowFramesRef.current++;
      }

      // Record FPS metric if it's below threshold
      if (fps < 55) {  // Target 60 FPS with 5 FPS tolerance
        recordMetric({
          metric_type: 'fps',
          component: componentName,
          value: fps,
          unit: 'fps',
          threshold: 60,
          context: {
            slowFrames: slowFramesRef.current,
            renderCount: renderCountRef.current
          }
        });
      }

      // Update report
      setReport(prev => ({
        ...prev,
        fps,
        frameTime: 1000 / fps,
        slowFrames: slowFramesRef.current
      }));

      frameCountRef.current = 0;
      lastTimeRef.current = currentTime;
    }

    if (enabled) {
      rafIdRef.current = requestAnimationFrame(measureFPS);
    }
  }, [componentName, enabled, recordMetric]);

  /**
   * Track render count
   */
  useEffect(() => {
    renderCountRef.current++;
    setReport(prev => ({ ...prev, renderCount: renderCountRef.current }));
  });

  /**
   * Track memory usage if available
   */
  useEffect(() => {
    if (!enabled) return;

    const checkMemory = () => {
      // @ts-ignore - performance.memory is non-standard
      if (performance.memory) {
        // @ts-ignore
        const memoryMB = performance.memory.usedJSHeapSize / 1024 / 1024;

        setReport(prev => ({ ...prev, memoryUsage: memoryMB }));

        // Record if memory usage is high (> 100MB)
        if (memoryMB > 100) {
          recordMetric({
            metric_type: 'memory_usage',
            component: componentName,
            value: memoryMB,
            unit: 'MB',
            threshold: 100,
            context: {
              // @ts-ignore
              totalHeap: performance.memory.totalJSHeapSize / 1024 / 1024,
              // @ts-ignore
              heapLimit: performance.memory.jsHeapSizeLimit / 1024 / 1024
            }
          });
        }
      }
    };

    const intervalId = setInterval(checkMemory, 5000); // Check every 5 seconds
    return () => clearInterval(intervalId);
  }, [componentName, enabled, recordMetric]);

  /**
   * Start/stop FPS monitoring
   */
  useEffect(() => {
    if (enabled) {
      measureFPS();
    }

    return () => {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, [enabled, measureFPS]);

  /**
   * Track errors
   */
  const trackError = useCallback((error: Error) => {
    errorCountRef.current++;
    setReport(prev => ({ ...prev, errorCount: errorCountRef.current }));

    recordMetric({
      metric_type: 'latency',
      component: `ERROR:${componentName}`,
      value: 0,
      unit: 'count',
      context: {
        error: error.message,
        stack: error.stack
      }
    });
  }, [componentName, recordMetric]);

  /**
   * Track API response times
   */
  const trackApiCall = useCallback(async <T,>(
    apiCall: () => Promise<T>,
    endpoint: string
  ): Promise<T> => {
    const startTime = performance.now();

    try {
      const result = await apiCall();
      const responseTime = performance.now() - startTime;

      // Record if response time is slow (> 200ms)
      if (responseTime > 200) {
        recordMetric({
          metric_type: 'response_time',
          component: `${componentName}:${endpoint}`,
          value: responseTime,
          unit: 'ms',
          threshold: 200,
          context: {
            endpoint,
            component: componentName
          }
        });
      }

      return result;
    } catch (error) {
      const responseTime = performance.now() - startTime;

      recordMetric({
        metric_type: 'response_time',
        component: `ERROR:${componentName}:${endpoint}`,
        value: responseTime,
        unit: 'ms',
        context: {
          endpoint,
          error: error instanceof Error ? error.message : String(error)
        }
      });

      throw error;
    }
  }, [componentName, recordMetric]);

  /**
   * Manual performance mark
   */
  const mark = useCallback((markName: string) => {
    performance.mark(`${componentName}:${markName}`);
  }, [componentName]);

  /**
   * Measure between two marks
   */
  const measure = useCallback((measureName: string, startMark: string, endMark?: string) => {
    const fullStartMark = `${componentName}:${startMark}`;
    const fullEndMark = endMark ? `${componentName}:${endMark}` : undefined;

    try {
      const measure = performance.measure(
        `${componentName}:${measureName}`,
        fullStartMark,
        fullEndMark
      );

      // Record if duration is significant (> 50ms)
      if (measure.duration > 50) {
        recordMetric({
          metric_type: 'latency',
          component: componentName,
          value: measure.duration,
          unit: 'ms',
          threshold: 50,
          context: {
            measure: measureName,
            start: startMark,
            end: endMark
          }
        });
      }

      return measure.duration;
    } catch (error) {
      console.error('Performance measure failed:', error);
      return 0;
    }
  }, [componentName, recordMetric]);

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      // Flush any remaining metrics
      if (metricsBufferRef.current.length > 0) {
        flushMetrics();
      }
    };
  }, [flushMetrics]);

  return {
    report,
    trackError,
    trackApiCall,
    mark,
    measure,
    recordMetric
  };
}

/**
 * Higher-order component to wrap components with performance monitoring
 */
export function withPerformanceMonitor<P extends object>(
  Component: React.ComponentType<P>,
  componentName: string
) {
  return function PerformanceMonitoredComponent(props: P) {
    const { report, trackError } = usePerformanceMonitor(componentName);

    // Add error boundary behavior
    useEffect(() => {
      const handleError = (event: ErrorEvent) => {
        trackError(new Error(event.message));
      };

      window.addEventListener('error', handleError);
      return () => window.removeEventListener('error', handleError);
    }, [trackError]);

    // Show performance overlay in development
    const isDev = import.meta.env.DEV;

    return (
      <>
        {isDev && (
          <div className="fixed top-2 right-2 z-50 bg-black/80 text-white text-xs p-2 rounded font-mono">
            <div>FPS: {report.fps}</div>
            <div>Frame: {report.frameTime.toFixed(2)}ms</div>
            <div>Renders: {report.renderCount}</div>
            {report.memoryUsage ? (
              <div>Memory: {report.memoryUsage.toFixed(1)}MB</div>
            ) : null}
          </div>
        )}
        <Component {...props} />
      </>
    );
  };
}