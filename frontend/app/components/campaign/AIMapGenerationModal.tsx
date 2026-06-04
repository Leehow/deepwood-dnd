import { useState, useCallback } from 'react';
import { getApiEndpoint } from '~/config/api';
import { apiFetch } from '~/utils/api-client';

interface AIMapGenerationModalProps {
  open: boolean;
  onClose: () => void;
  campaignId: string;
  onMapGenerated: () => void;
}

export function AIMapGenerationModal({
  open,
  onClose,
  campaignId,
  onMapGenerated,
}: AIMapGenerationModalProps) {
  const [description, setDescription] = useState('');
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedMap, setGeneratedMap] = useState<{ map_url: string; map_name: string } | null>(null);

  const handleOptimize = useCallback(async () => {
    if (!description.trim() || description.trim().length < 4) {
      setError('请输入至少4个字的描述');
      return;
    }
    setIsOptimizing(true);
    setError(null);
    try {
      const resp = await apiFetch(`/api/campaigns/${campaignId}/optimize-map-prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: description.trim() }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.detail || 'AI优化失败');
      }
      const data = await resp.json();
      setDescription(data.optimized);
    } catch (e: any) {
      setError(e.message || 'AI优化失败');
    } finally {
      setIsOptimizing(false);
    }
  }, [description, campaignId]);

  const handleGenerate = useCallback(async () => {
    if (!description.trim() || description.trim().length < 4) {
      setError('请输入至少4个字的地图描述');
      return;
    }
    setIsGenerating(true);
    setError(null);
    setGeneratedMap(null);
    try {
      const resp = await apiFetch(`/api/campaigns/${campaignId}/generate-ai-map`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: description.trim() }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.detail || '地图生成失败');
      }
      const data = await resp.json();
      if (data.success) {
        setGeneratedMap({ map_url: data.map_url, map_name: data.map_name });
        onMapGenerated();
      } else {
        throw new Error('地图生成失败');
      }
    } catch (e: any) {
      setError(e.message || '地图生成失败');
    } finally {
      setIsGenerating(false);
    }
  }, [description, campaignId, onMapGenerated]);

  const handleClose = useCallback(() => {
    if (!isOptimizing && !isGenerating) {
      setDescription('');
      setError(null);
      setGeneratedMap(null);
      onClose();
    }
  }, [isOptimizing, isGenerating, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center" onClick={handleClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-[520px] max-h-[85vh] overflow-y-auto rounded-xl border border-amber-900/40 bg-gradient-to-b from-[#1a1207] to-[#0d0a04] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-amber-900/30">
          <div className="flex items-center gap-2">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5 text-amber-400">
              <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
            </svg>
            <h3 className="text-base font-semibold text-amber-200">AI 生成地图</h3>
          </div>
          <button
            onClick={handleClose}
            disabled={isOptimizing || isGenerating}
            className="p-1 rounded text-amber-600 hover:text-amber-400 hover:bg-amber-900/20 transition disabled:opacity-50"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* Description Input */}
          <div>
            <label className="block text-sm text-amber-400/80 mb-1.5">地图场景描述</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isOptimizing || isGenerating}
              placeholder="描述你想要的地图场景，例如：&#10;• 一片阴暗的沼泽地，雾气弥漫&#10;• 繁华的港口城镇，有灯塔和码头&#10;• 地下城的祭坛大厅，石柱环绕"
              rows={5}
              className="w-full rounded-lg border border-amber-900/40 bg-black/30 px-3 py-2 text-sm text-amber-100 placeholder:text-amber-800/60 focus:outline-none focus:border-amber-600/60 focus:ring-1 focus:ring-amber-600/30 resize-none disabled:opacity-50"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2">
            <button
              onClick={handleOptimize}
              disabled={isOptimizing || isGenerating || !description.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-purple-700/50 bg-purple-900/20 text-sm text-purple-300 hover:bg-purple-900/40 hover:border-purple-600/60 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isOptimizing ? (
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                  <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75" />
                </svg>
              ) : (
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                  <path d="M10 2a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5A.75.75 0 0110 2zM10 15a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5A.75.75 0 0110 15zM10 7a3 3 0 100 6 3 3 0 000-6zM15.657 5.404a.75.75 0 10-1.06-1.06l-1.061 1.06a.75.75 0 001.06 1.06l1.06-1.06zM6.464 14.596a.75.75 0 10-1.06-1.06l-1.06 1.06a.75.75 0 001.06 1.06l1.06-1.06zM18 10a.75.75 0 01-.75.75h-1.5a.75.75 0 010-1.5h1.5A.75.75 0 0118 10zM5 10a.75.75 0 01-.75.75h-1.5a.75.75 0 010-1.5h1.5A.75.75 0 015 10zM14.596 15.657a.75.75 0 001.06-1.06l-1.06-1.061a.75.75 0 10-1.06 1.06l1.06 1.06zM5.404 6.464a.75.75 0 001.06-1.06l-1.06-1.06a.75.75 0 10-1.06 1.06l1.06 1.06z" />
                </svg>
              )}
              {isOptimizing ? 'AI 优化中...' : 'AI 优化'}
            </button>
            <button
              onClick={handleGenerate}
              disabled={isOptimizing || isGenerating || !description.trim()}
              className="flex-1 flex items-center justify-center gap-1.5 px-4 py-1.5 rounded-lg border border-amber-600/50 bg-amber-900/30 text-sm font-medium text-amber-200 hover:bg-amber-800/40 hover:border-amber-500/60 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isGenerating ? (
                <>
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                    <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75" />
                  </svg>
                  生成中，请稍候...
                </>
              ) : (
                <>
                  <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                    <path d="M15.98 1.804a1 1 0 00-1.96 0l-.24 1.192a1 1 0 01-.784.785l-1.192.238a1 1 0 000 1.962l1.192.238a1 1 0 01.785.785l.238 1.192a1 1 0 001.962 0l.238-1.192a1 1 0 01.785-.785l1.192-.238a1 1 0 000-1.962l-1.192-.238a1 1 0 01-.785-.785l-.238-1.192zM6.949 5.684a1 1 0 00-1.898 0l-.683 2.051a1 1 0 01-.633.633l-2.051.683a1 1 0 000 1.898l2.051.684a1 1 0 01.633.632l.683 2.051a1 1 0 001.898 0l.683-2.051a1 1 0 01.633-.633l2.051-.683a1 1 0 000-1.898l-2.051-.683a1 1 0 01-.633-.633L6.95 5.684zM13.949 13.684a1 1 0 00-1.898 0l-.184.551a1 1 0 01-.632.633l-.551.183a1 1 0 000 1.898l.551.183a1 1 0 01.633.633l.183.551a1 1 0 001.898 0l.184-.551a1 1 0 01.632-.633l.551-.183a1 1 0 000-1.898l-.551-.184a1 1 0 01-.633-.632l-.183-.551z" />
                  </svg>
                  生成地图
                </>
              )}
            </button>
          </div>

          {/* Error Message */}
          {error && (
            <div className="px-3 py-2 rounded-lg bg-red-900/20 border border-red-800/40 text-sm text-red-400">
              {error}
            </div>
          )}

          {/* Generating Hint */}
          {isGenerating && (
            <div className="px-3 py-2 rounded-lg bg-amber-900/10 border border-amber-900/20 text-xs text-amber-600/80 text-center">
              AI 正在绘制地图，通常需要 30-60 秒...
            </div>
          )}

          {/* Generated Map Preview */}
          {generatedMap && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-sm text-green-400">
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
                </svg>
                地图已生成：{generatedMap.map_name}
              </div>
              <div className="rounded-lg overflow-hidden border border-amber-900/30">
                <img
                  src={generatedMap.map_url}
                  alt={generatedMap.map_name}
                  className="w-full h-auto"
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {generatedMap && (
          <div className="px-5 py-3 border-t border-amber-900/30 flex justify-end">
            <button
              onClick={handleClose}
              className="px-4 py-1.5 rounded-lg bg-amber-800/30 border border-amber-700/40 text-sm text-amber-300 hover:bg-amber-700/40 transition"
            >
              完成
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
