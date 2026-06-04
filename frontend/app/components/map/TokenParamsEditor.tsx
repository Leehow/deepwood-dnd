/**
 * TokenParamsEditor Component
 * DM-only modal to view/edit an arbitrary parameter table on a token
 */

import { useMemo, useState } from "react";
import type { Token } from "./types/TacticalMapTypes";

interface TokenParamsEditorProps {
  token: Token | null;
  open: boolean;
  onClose: () => void;
  onSave: (params: Record<string, any>) => void;
}

export function TokenParamsEditor({ token, open, onClose, onSave }: TokenParamsEditorProps) {
  const initialPairs = useMemo(() => {
    const obj = (token as any)?.params || {};
    const entries = Object.entries(obj) as Array<[string, any]>;
    if (entries.length === 0) return [{ key: "", value: "" }];
    return entries.map(([k, v]) => ({ key: String(k), value: typeof v === 'string' ? v : JSON.stringify(v) }));
  }, [token]);

  const [pairs, setPairs] = useState<Array<{ key: string; value: string }>>(initialPairs);

  if (!open || !token) return null;

  const addRow = () => setPairs((prev) => [...prev, { key: "", value: "" }]);
  const removeRow = (idx: number) => setPairs((prev) => prev.filter((_, i) => i !== idx));

  const handleSave = () => {
    const obj: Record<string, any> = {};
    for (const p of pairs) {
      if (!p.key) continue;
      // Try parse JSON, fallback to string
      try {
        obj[p.key] = JSON.parse(p.value);
      } catch {
        obj[p.key] = p.value;
      }
    }
    onSave(obj);
  };

  return (
    <div
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: '#1a1a1a', padding: '20px', borderRadius: '8px', border: '2px solid #3b82f6', minWidth: '440px'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ color: '#60a5fa', marginBottom: '12px', fontWeight: 'bold' }}>Token 参数表</h3>
        <div style={{ maxHeight: '50vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {pairs.map((p, idx) => (
            <div key={idx} style={{ display: 'flex', gap: '8px' }}>
              <input
                placeholder="键 (key)"
                value={p.key}
                onChange={(e) => setPairs(prev => prev.map((x, i) => i === idx ? { ...x, key: e.target.value } : x))}
                style={{ flex: 1, padding: '6px', backgroundColor: '#2a2a2a', border: '1px solid #444', borderRadius: '4px', color: '#fff' }}
              />
              <input
                placeholder="值 (可以是JSON)"
                value={p.value}
                onChange={(e) => setPairs(prev => prev.map((x, i) => i === idx ? { ...x, value: e.target.value } : x))}
                style={{ flex: 2, padding: '6px', backgroundColor: '#2a2a2a', border: '1px solid #444', borderRadius: '4px', color: '#fff' }}
              />
              <button
                onClick={() => removeRow(idx)}
                style={{ padding: '6px 8px', backgroundColor: '#ef4444', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer' }}
              >删除</button>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '12px' }}>
          <button onClick={addRow} style={{ padding: '6px 10px', backgroundColor: '#10b981', border: 'none', borderRadius: '4px', color: '#000', fontWeight: 'bold', cursor: 'pointer' }}>添加一行</button>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={onClose} style={{ padding: '6px 10px', backgroundColor: '#444', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer' }}>取消</button>
            <button onClick={handleSave} style={{ padding: '6px 10px', backgroundColor: '#fbbf24', border: 'none', borderRadius: '4px', color: '#000', fontWeight: 'bold', cursor: 'pointer' }}>保存</button>
          </div>
        </div>
      </div>
    </div>
  );
}

