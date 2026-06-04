import { useState, useEffect } from 'react';

interface Recipient {
  id: number | string;  // number for characters, string like "m_123" for monsters
  name: string;
  user_id?: string;
  avatar_url?: string;
  type: 'character' | 'monster' | 'npc';
}

interface CurrencyRewardModalProps {
  isOpen: boolean;
  recipients: Recipient[];
  campaignId: string;
  onConfirm: (data: {
    recipients: (number | string)[];
    currency_changes: {
      cp?: number;
      sp?: number;
      ep?: number;
      gp?: number;
      pp?: number;
    };
    source: string;
    description: string;
    is_private: boolean;
  }) => void;
  onCancel: () => void;
}

const CURRENCY_SOURCES = [
  'Loot',
  'Quest',
  'Trade',
  'Reward',
  'Sale',
  'Manual'
];

export function CurrencyRewardModal({
  isOpen,
  recipients,
  campaignId,
  onConfirm,
  onCancel
}: CurrencyRewardModalProps) {
  const [selectedRecipients, setSelectedRecipients] = useState<Set<number | string>>(new Set());
  const [cp, setCp] = useState<string>('0');
  const [sp, setSp] = useState<string>('0');
  const [ep, setEp] = useState<string>('0');
  const [gp, setGp] = useState<string>('0');
  const [pp, setPp] = useState<string>('0');
  const [source, setSource] = useState<string>('Manual');
  const [description, setDescription] = useState<string>('');
  const [isPrivate, setIsPrivate] = useState<boolean>(false);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedRecipients(new Set());
      setCp('0');
      setSp('0');
      setEp('0');
      setGp('0');
      setPp('0');
      setSource('Manual');
      setDescription('');
      setIsPrivate(false);
    }
  }, [isOpen]);

  const toggleRecipient = (id: number | string) => {
    const newSet = new Set(selectedRecipients);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedRecipients(newSet);
  };

  const toggleAll = () => {
    if (selectedRecipients.size === recipients.length) {
      setSelectedRecipients(new Set());
    } else {
      setSelectedRecipients(new Set(recipients.map(r => r.id)));
    }
  };

  const handleConfirm = () => {
    const currency_changes: any = {};

    const cpVal = parseInt(cp);
    const spVal = parseInt(sp);
    const epVal = parseInt(ep);
    const gpVal = parseInt(gp);
    const ppVal = parseInt(pp);

    if (cpVal !== 0) currency_changes.cp = cpVal;
    if (spVal !== 0) currency_changes.sp = spVal;
    if (epVal !== 0) currency_changes.ep = epVal;
    if (gpVal !== 0) currency_changes.gp = gpVal;
    if (ppVal !== 0) currency_changes.pp = ppVal;

    if (Object.keys(currency_changes).length === 0) {
      alert('Please enter at least one currency amount');
      return;
    }

    if (selectedRecipients.size === 0) {
      alert('Please select at least one recipient');
      return;
    }

    onConfirm({
      recipients: Array.from(selectedRecipients),
      currency_changes,
      source,
      description,
      is_private: isPrivate
    });
  };

  // Get type badge color
  const getTypeBadgeColor = (type: string) => {
    switch (type) {
      case 'character': return 'bg-blue-600';
      case 'monster': return 'bg-red-600';
      case 'npc': return 'bg-green-600';
      default: return 'bg-gray-600';
    }
  };

  // Get type label
  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'character': return 'PC';
      case 'monster': return '怪物';
      case 'npc': return 'NPC';
      default: return type;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[90dvh] overflow-y-auto">
        {/* Header */}
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-white mb-2">
            💰 Grant Currency
          </h2>
          <p className="text-sm text-gray-400">
            Reward characters with coins (use negative values to deduct)
          </p>
        </div>

        <div className="space-y-6">
          {/* Currency Inputs */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-3">
              Currency Amounts
            </label>
            <div className="grid grid-cols-5 gap-3">
              <div>
                <label className="block text-xs text-amber-400 mb-1">CP</label>
                <input
                  type="number"
                  value={cp}
                  onChange={(e) => setCp(e.target.value)}
                  className="w-full px-2 py-2 bg-gray-800 border border-gray-600 rounded text-white text-center focus:outline-none focus:border-amber-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">SP</label>
                <input
                  type="number"
                  value={sp}
                  onChange={(e) => setSp(e.target.value)}
                  className="w-full px-2 py-2 bg-gray-800 border border-gray-600 rounded text-white text-center focus:outline-none focus:border-gray-500"
                />
              </div>
              <div>
                <label className="block text-xs text-green-400 mb-1">EP</label>
                <input
                  type="number"
                  value={ep}
                  onChange={(e) => setEp(e.target.value)}
                  className="w-full px-2 py-2 bg-gray-800 border border-gray-600 rounded text-white text-center focus:outline-none focus:border-green-500"
                />
              </div>
              <div>
                <label className="block text-xs text-yellow-400 mb-1">GP</label>
                <input
                  type="number"
                  value={gp}
                  onChange={(e) => setGp(e.target.value)}
                  className="w-full px-2 py-2 bg-gray-800 border border-gray-600 rounded text-white text-center focus:outline-none focus:border-yellow-500"
                />
              </div>
              <div>
                <label className="block text-xs text-purple-400 mb-1">PP</label>
                <input
                  type="number"
                  value={pp}
                  onChange={(e) => setPp(e.target.value)}
                  className="w-full px-2 py-2 bg-gray-800 border border-gray-600 rounded text-white text-center focus:outline-none focus:border-purple-500"
                />
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Tip: Use negative values (e.g., -10) to deduct currency
            </p>
          </div>

          {/* Source */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Source
            </label>
            <select
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-white focus:outline-none focus:border-yellow-500"
            >
              {CURRENCY_SOURCES.map(src => (
                <option key={src} value={src}>{src}</option>
              ))}
            </select>
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Description (Optional)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g., Treasure chest loot"
              rows={2}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-white placeholder-gray-500 focus:outline-none focus:border-yellow-500 resize-none"
            />
          </div>

          {/* Recipients */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="block text-sm font-medium text-gray-300">
                Recipients * ({selectedRecipients.size} selected)
              </label>
              <button
                onClick={toggleAll}
                className="text-xs text-yellow-400 hover:text-yellow-300"
              >
                {selectedRecipients.size === recipients.length ? 'Deselect All' : 'Select All'}
              </button>
            </div>
            <div className="space-y-1 max-h-48 overflow-y-auto bg-gray-800 rounded border border-gray-600 p-2">
              {recipients.length === 0 ? (
                <p className="text-sm text-gray-500 p-2">No recipients available</p>
              ) : (
                recipients.map(recipient => (
                  <label
                    key={recipient.id}
                    className="flex items-center gap-3 cursor-pointer hover:bg-gray-700 p-2 rounded"
                  >
                    <input
                      type="checkbox"
                      checked={selectedRecipients.has(recipient.id)}
                      onChange={() => toggleRecipient(recipient.id)}
                      className="w-4 h-4 rounded border-gray-500 text-yellow-500 focus:ring-yellow-500 flex-shrink-0"
                    />
                    {/* Avatar */}
                    <div className="w-8 h-8 rounded-full overflow-hidden bg-gray-700 flex-shrink-0">
                      {recipient.avatar_url ? (
                        <img
                          src={recipient.avatar_url}
                          alt={recipient.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">
                          {recipient.name.charAt(0).toUpperCase()}
                        </div>
                      )}
                    </div>
                    {/* Name and Type Badge */}
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="text-white truncate">{recipient.name}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${getTypeBadgeColor(recipient.type)} text-white flex-shrink-0`}>
                        {getTypeLabel(recipient.type)}
                      </span>
                    </div>
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
                className="w-4 h-4 rounded border-gray-500 text-yellow-500 focus:ring-yellow-500"
              />
              <span className="text-sm text-gray-300">
                Private (only visible to DM and recipients)
              </span>
            </label>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 mt-6">
          <button
            onClick={handleConfirm}
            disabled={selectedRecipients.size === 0}
            className="flex-1 px-4 py-2 bg-yellow-600 hover:bg-yellow-700 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed text-white rounded font-medium transition-colors"
          >
            Grant Currency
          </button>
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded font-medium transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
