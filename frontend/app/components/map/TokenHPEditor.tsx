/**
 * TokenHPEditor Component
 * Modal dialog for editing token HP and removing tokens
 */

interface TokenHPEditorProps {
  editingTokenId: number | null;
  editingTokenHP: number;
  editingTokenMaxHP: number | null;
  onHPChange: (hp: number) => void;
  onMaxHPChange: (hp: number | null) => void;
  onUpdate: () => void;
  onRemove: () => void;
  onCancel: () => void;
  onOpenParams?: (tokenId: number) => void; // open parameter table editor (DM only)
  disableMaxHP?: boolean; // when true, Max HP input is read-only/disabled
}

export function TokenHPEditor({
  editingTokenId,
  editingTokenHP,
  editingTokenMaxHP,
  onHPChange,
  onMaxHPChange,
  onUpdate,
  onRemove,
  onCancel,
  onOpenParams,
  disableMaxHP = false,
}: TokenHPEditorProps) {
  if (editingTokenId === null) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onCancel}
    >
      <div
        style={{
          backgroundColor: '#1a1a1a',
          padding: '24px',
          borderRadius: '8px',
          border: '2px solid #fbbf24',
          minWidth: '360px',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ color: '#fbbf24', marginBottom: '16px', fontSize: '18px', fontWeight: 'bold', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span>修改Token HP</span>
          {onOpenParams && (
            <button
              onClick={() => editingTokenId && onOpenParams(editingTokenId)}
              style={{
                padding: '4px 8px',
                backgroundColor: '#3b82f6',
                border: 'none',
                borderRadius: '4px',
                color: '#ffffff',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: 'bold',
              }}
            >参数表</button>
          )}
        </h3>
        <div style={{ marginBottom: '16px' }}>
          <label style={{ color: '#ffffff', display: 'block', marginBottom: '8px' }}>
            当前HP / 最大HP:
          </label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="number"
              value={editingTokenHP}
              onChange={(e) => onHPChange(parseInt(e.target.value) || 0)}
              style={{
                width: '50%',
                padding: '8px',
                backgroundColor: '#2a2a2a',
                border: '1px solid #444',
                borderRadius: '4px',
                color: '#ffffff',
                fontSize: '16px',
              }}
              autoFocus
            />
            <input
              type="number"
              value={editingTokenMaxHP ?? ''}
              placeholder="Max"
              onChange={(e) => onMaxHPChange(e.target.value === '' ? null : (parseInt(e.target.value) || 0))}
              disabled={disableMaxHP}
              style={{
                width: '50%',
                padding: '8px',
                backgroundColor: disableMaxHP ? '#1f2937' : '#2a2a2a',
                border: '1px solid #444',
                borderRadius: '4px',
                color: '#ffffff',
                fontSize: '16px',
                opacity: disableMaxHP ? 0.6 : 1,
                cursor: disableMaxHP ? 'not-allowed' : 'text',
              }}
            />
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'space-between' }}>
          <button
            onClick={onRemove}
            style={{
              padding: '8px 16px',
              backgroundColor: '#dc2626',
              border: 'none',
              borderRadius: '4px',
              color: '#ffffff',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 'bold',
            }}
          >
            🗑️ 移除Token
          </button>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={onCancel}
              style={{
                padding: '8px 16px',
                backgroundColor: '#444',
                border: 'none',
                borderRadius: '4px',
                color: '#ffffff',
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              取消
            </button>
            <button
              onClick={onUpdate}
              style={{
                padding: '8px 16px',
                backgroundColor: '#fbbf24',
                border: 'none',
                borderRadius: '4px',
                color: '#000000',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: 'bold',
              }}
            >
              确定
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
