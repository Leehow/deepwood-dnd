import { useState, useEffect } from 'react';

interface Character {
  id: number;
  name: string;
  user_id: string;
  avatar_url?: string;
}

interface XPRewardModalProps {
  isOpen: boolean;
  characters: Character[];
  campaignId: string;
  onConfirm: (data: {
    recipients: number[];
    amount: number;
    source: string;
    description: string;
    is_private: boolean;
  }) => void;
  onCancel: () => void;
}

const XP_SOURCES = [
  { value: 'Combat', label: '战斗' },
  { value: 'Quest', label: '任务' },
  { value: 'Roleplay', label: '角色扮演' },
  { value: 'Exploration', label: '探索' },
  { value: 'Puzzle', label: '谜题' },
  { value: 'Social', label: '社交' },
  { value: 'Manual', label: '手动' }
];

export function XPRewardModal({
  isOpen,
  characters,
  campaignId,
  onConfirm,
  onCancel
}: XPRewardModalProps) {
  const [selectedCharacters, setSelectedCharacters] = useState<Set<number>>(new Set());
  const [xpAmount, setXpAmount] = useState<string>('');
  const [source, setSource] = useState<string>('Manual');
  const [description, setDescription] = useState<string>('');
  const [isPrivate, setIsPrivate] = useState<boolean>(false);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedCharacters(new Set());
      setXpAmount('');
      setSource('Manual');
      setDescription('');
      setIsPrivate(false);
    }
  }, [isOpen]);

  const toggleCharacter = (charId: number) => {
    const newSet = new Set(selectedCharacters);
    if (newSet.has(charId)) {
      newSet.delete(charId);
    } else {
      newSet.add(charId);
    }
    setSelectedCharacters(newSet);
  };

  const toggleAll = () => {
    if (selectedCharacters.size === characters.length) {
      setSelectedCharacters(new Set());
    } else {
      setSelectedCharacters(new Set(characters.map(c => c.id)));
    }
  };

  const handleConfirm = () => {
    const amount = parseInt(xpAmount);
    if (isNaN(amount) || amount <= 0) {
      alert('请输入有效的经验值数量');
      return;
    }

    if (selectedCharacters.size === 0) {
      alert('请至少选择一个角色');
      return;
    }

    onConfirm({
      recipients: Array.from(selectedCharacters),
      amount,
      source,
      description,
      is_private: isPrivate
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[90dvh] overflow-y-auto">
        {/* Header */}
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-white mb-2">
            ⚡ 发放经验值
          </h2>
          <p className="text-sm text-gray-400">
            为角色的成就奖励经验值
          </p>
        </div>

        <div className="space-y-6">
          {/* XP Amount */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              经验值数量 *
            </label>
            <input
              type="number"
              min="1"
              value={xpAmount}
              onChange={(e) => setXpAmount(e.target.value)}
              placeholder="例如：300"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
            />
          </div>

          {/* Source */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              来源
            </label>
            <select
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-white focus:outline-none focus:border-purple-500"
            >
              {XP_SOURCES.map(src => (
                <option key={src.value} value={src.value}>{src.label}</option>
              ))}
            </select>
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              描述（可选）
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="例如：击败哥布林首领"
              rows={2}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 resize-none"
            />
          </div>

          {/* Recipients */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="block text-sm font-medium text-gray-300">
                接收者 * ({selectedCharacters.size} 已选择)
              </label>
              <button
                onClick={toggleAll}
                className="text-xs text-purple-400 hover:text-purple-300"
              >
                {selectedCharacters.size === characters.length ? '取消全选' : '全选'}
              </button>
            </div>
            <div className="space-y-1 max-h-48 overflow-y-auto bg-gray-800 rounded border border-gray-600 p-2">
              {characters.length === 0 ? (
                <p className="text-sm text-gray-500 p-2">战役中没有角色</p>
              ) : (
                characters.map(char => (
                  <label
                    key={char.id}
                    className="flex items-center gap-3 cursor-pointer hover:bg-gray-700 p-2 rounded"
                  >
                    <input
                      type="checkbox"
                      checked={selectedCharacters.has(char.id)}
                      onChange={() => toggleCharacter(char.id)}
                      className="w-4 h-4 rounded border-gray-500 text-purple-500 focus:ring-purple-500 flex-shrink-0"
                    />
                    {/* Avatar */}
                    <div className="w-8 h-8 rounded-full overflow-hidden bg-gray-700 flex-shrink-0">
                      {char.avatar_url ? (
                        <img
                          src={char.avatar_url}
                          alt={char.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">
                          {char.name.charAt(0).toUpperCase()}
                        </div>
                      )}
                    </div>
                    <span className="text-white truncate">{char.name}</span>
                  </label>
                ))
              )}
            </div>
          </div>

          {/* Privacy Toggle */}
          <div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isPrivate}
                onChange={(e) => setIsPrivate(e.target.checked)}
                className="w-4 h-4 rounded border-gray-500 text-purple-500 focus:ring-purple-500"
              />
              <span className="text-sm text-gray-300">
                私密（仅DM和接收者可见）
              </span>
            </label>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 mt-6">
          <button
            onClick={handleConfirm}
            disabled={selectedCharacters.size === 0 || !xpAmount}
            className="flex-1 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed text-white rounded font-medium transition-colors"
          >
            发放经验值
          </button>
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded font-medium transition-colors"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
