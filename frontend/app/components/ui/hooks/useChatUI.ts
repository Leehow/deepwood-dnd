/**
 * useChatUI Hook
 * Manages UI state for chat panel (tabs, modals, dropdowns)
 */

import { useState, useCallback, useEffect } from 'react';
import type { Message } from './useChatMessages';

export interface UseChatUIResult {
  useModuleContext: boolean;
  setUseModuleContext: React.Dispatch<React.SetStateAction<boolean>>;
  // Tab state
  activeTab: 'chat' | 'dice';
  setActiveTab: (tab: 'chat' | 'dice') => void;

  // Input state
  input: string;
  setInput: (value: string) => void;
  editingMessageId: number | null;
  editingText: string;
  startEditing: (messageId: number, currentText: string) => void;
  cancelEditing: () => void;
  setEditingText: (text: string) => void;

  // Recipient selection (multi-select)
  selectedRecipients: string[];
  setSelectedRecipients: (recipients: string[]) => void;
  toggleRecipient: (recipientId: string) => void;
  clearRecipients: () => void;
  showRecipientsDropdown: boolean;
  setShowRecipientsDropdown: (show: boolean) => void;

  // Dice modals
  showDiceRecipientsModal: boolean;
  setShowDiceRecipientsModal: (show: boolean) => void;
  diceRecipientsSelection: string[];
  setDiceRecipientsSelection: (selection: string[]) => void;
  diceModalSourceMessage: Message | null;
  setDiceModalSourceMessage: (message: Message | null) => void;
  isPrivateRoll: boolean;
  setIsPrivateRoll: (isPrivate: boolean) => void;
  dcValue: string;
  setDcValue: (value: string) => void;
  aiDcReason: string;
  setAiDcReason: (reason: string) => void;
  isGeneratingDc: boolean;
  setIsGeneratingDc: (generating: boolean) => void;

  // Actor selection modal
  showActorSelectModal: boolean;
  setShowActorSelectModal: (show: boolean) => void;
  actorSelection: string | null;
  setActorSelection: (actor: string | null) => void;
  diceRollSource: { message: Message; check?: unknown } | null;
  setDiceRollSource: (source: { message: Message; check?: unknown } | null) => void;

  // Dice execution state
  diceExecuteLoading: string | null;
  setDiceExecuteLoading: (loading: string | null) => void;

  // Reply/Quote state
  replyingTo: { messageId: string; senderUserId: string; senderName: string; content: string } | null;
  setReplyingTo: (reply: { messageId: string; senderUserId: string; senderName: string; content: string } | null) => void;
  clearReply: () => void;

  // Delete confirmation state
  pendingDeleteId: number | null;
  setPendingDeleteId: (id: number | null) => void;

  // Proxy actors for DM dice rolls (multiple selection)
  proxyActorIds: string[];
  setProxyActorIds: (ids: string[]) => void;

  // Proxy private roll toggle for DM (暗投)
  proxyPrivateRoll: boolean;
  setProxyPrivateRoll: (isPrivate: boolean) => void;

  // New dice request modal state (DM发起检定)
  showNewDiceModal: boolean;
  setShowNewDiceModal: (show: boolean) => void;
  diceRequestMode: 'manual' | 'ai';
  setDiceRequestMode: (mode: 'manual' | 'ai') => void;
  diceSceneDescription: string;
  setDiceSceneDescription: (description: string) => void;
  showCheckTypeModal: boolean;
  setShowCheckTypeModal: (show: boolean) => void;
  selectedCheckTypes: Array<{ type: string; ability: string; skill: string | null; dc?: number }>;
  setSelectedCheckTypes: (checks: Array<{ type: string; ability: string; skill: string | null; dc?: number }>) => void;
  isAnalyzingCheck: boolean;
  setIsAnalyzingCheck: (analyzing: boolean) => void;
  aiCheckSuggestion: { checks: Array<{ check_type: string; ability: string; skill: string | null; dc: number }>; reason: string } | null;
  setAiCheckSuggestion: (suggestion: { checks: Array<{ check_type: string; ability: string; skill: string | null; dc: number }>; reason: string } | null) => void;
  // Dice roll modifier (advantage/disadvantage)
  diceRollModifier: 'advantage' | 'disadvantage' | null;
  setDiceRollModifier: (modifier: 'advantage' | 'disadvantage' | null) => void;
}

export function useChatUI(): UseChatUIResult {
  // Tab state
  const [activeTab, setActiveTab] = useState<'chat' | 'dice'>('chat');

  // Input state
  const [input, setInput] = useState('');
  const [editingMessageId, setEditingMessageId] = useState<number | null>(null);
  const [editingText, setEditingText] = useState('');

  // Recipient selection (multi-select)
  const [selectedRecipients, setSelectedRecipients] = useState<string[]>([]);
  const [showRecipientsDropdown, setShowRecipientsDropdown] = useState(false);

  // Dice modals
  const [showDiceRecipientsModal, setShowDiceRecipientsModal] = useState(false);
  const [diceRecipientsSelection, setDiceRecipientsSelection] = useState<string[]>([]);
  const [diceModalSourceMessage, setDiceModalSourceMessage] = useState<Message | null>(null);
  const [isPrivateRoll, setIsPrivateRoll] = useState(false);
  const [dcValue, setDcValue] = useState<string>('');
  const [aiDcReason, setAiDcReason] = useState<string>('');
  const [isGeneratingDc, setIsGeneratingDc] = useState(false);

  // Actor selection modal
  const [showActorSelectModal, setShowActorSelectModal] = useState(false);
  const [actorSelection, setActorSelection] = useState<string | null>(null);
  const [diceRollSource, setDiceRollSource] = useState<{ message: Message; check?: unknown } | null>(null);

  // Dice execution state
  const [diceExecuteLoading, setDiceExecuteLoading] = useState<string | null>(null);

  // Reply/Quote state
  const [replyingTo, setReplyingTo] = useState<{ messageId: string; senderUserId: string; senderName: string; content: string } | null>(null);

  // Delete confirmation state
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);

  // Proxy actors for DM dice rolls (multiple selection)
  const [proxyActorIds, setProxyActorIds] = useState<string[]>([]);

  // Proxy private roll toggle for DM (暗投)
  const [proxyPrivateRoll, setProxyPrivateRoll] = useState(false);

  // New dice request modal state (DM发起检定)
  const [showNewDiceModal, setShowNewDiceModal] = useState(false);
  const [diceRequestMode, setDiceRequestMode] = useState<'manual' | 'ai'>('manual');
  const [diceSceneDescription, setDiceSceneDescription] = useState('');
  const [showCheckTypeModal, setShowCheckTypeModal] = useState(false);
  const [selectedCheckTypes, setSelectedCheckTypes] = useState<Array<{ type: string; ability: string; skill: string | null; dc?: number }>>([]);
  const [isAnalyzingCheck, setIsAnalyzingCheck] = useState(false);
  const [aiCheckSuggestion, setAiCheckSuggestion] = useState<{ checks: Array<{ check_type: string; ability: string; skill: string | null; dc: number }>; reason: string } | null>(null);
  // Dice roll modifier (advantage/disadvantage)
  const [diceRollModifier, setDiceRollModifier] = useState<'advantage' | 'disadvantage' | null>(null);
  // 与模组关联 (link dice check to module RAG context)
  const [useModuleContext, setUseModuleContext] = useState(false);

  /**
   * Clear reply state
   */
  const clearReply = useCallback(() => {
    setReplyingTo(null);
  }, []);

  /**
   * Start editing a message
   */
  const startEditing = useCallback((messageId: number, currentText: string) => {
    setEditingMessageId(messageId);
    setEditingText(currentText);
  }, []);

  /**
   * Cancel editing
   */
  const cancelEditing = useCallback(() => {
    setEditingMessageId(null);
    setEditingText('');
  }, []);

  /**
   * Toggle recipient selection (for multi-select)
   */
  const toggleRecipient = useCallback((recipientId: string) => {
    setSelectedRecipients(prev => {
      if (prev.includes(recipientId)) {
        return prev.filter(id => id !== recipientId);
      } else {
        return [...prev, recipientId];
      }
    });
  }, []);

  /**
   * Clear all recipients
   */
  const clearRecipients = useCallback(() => {
    setSelectedRecipients([]);
  }, []);

  /**
   * Close dropdown when clicking outside
   */
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (showRecipientsDropdown && !target.closest('.recipients-dropdown-container')) {
        setShowRecipientsDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showRecipientsDropdown]);

  return {
    // Tab state
    activeTab,
    setActiveTab,

    // Input state
    input,
    setInput,
    editingMessageId,
    editingText,
    startEditing,
    cancelEditing,
    setEditingText,

    // Recipient selection (multi-select)
    selectedRecipients,
    setSelectedRecipients,
    toggleRecipient,
    clearRecipients,
    showRecipientsDropdown,
    setShowRecipientsDropdown,

    // Dice modals
    showDiceRecipientsModal,
    setShowDiceRecipientsModal,
    diceRecipientsSelection,
    setDiceRecipientsSelection,
    diceModalSourceMessage,
    setDiceModalSourceMessage,
    isPrivateRoll,
    setIsPrivateRoll,
    dcValue,
    setDcValue,
    aiDcReason,
    setAiDcReason,
    isGeneratingDc,
    setIsGeneratingDc,

    // Actor selection modal
    showActorSelectModal,
    setShowActorSelectModal,
    actorSelection,
    setActorSelection,
    diceRollSource,
    setDiceRollSource,

    // Dice execution state
    diceExecuteLoading,
    setDiceExecuteLoading,

    // Reply/Quote state
    replyingTo,
    setReplyingTo,
    clearReply,

    // Delete confirmation state
    pendingDeleteId,
    setPendingDeleteId,

    // Proxy actors for DM dice rolls (multiple selection)
    proxyActorIds,
    setProxyActorIds,

    // Proxy private roll toggle for DM (暗投)
    proxyPrivateRoll,
    setProxyPrivateRoll,

    // New dice request modal state (DM发起检定)
    showNewDiceModal,
    setShowNewDiceModal,
    diceRequestMode,
    setDiceRequestMode,
    diceSceneDescription,
    setDiceSceneDescription,
    showCheckTypeModal,
    setShowCheckTypeModal,
    selectedCheckTypes,
    setSelectedCheckTypes,
    isAnalyzingCheck,
    setIsAnalyzingCheck,
    aiCheckSuggestion,
    setAiCheckSuggestion,
    // Dice roll modifier (advantage/disadvantage)
    diceRollModifier,
    setDiceRollModifier,
    // 与模组关联
    useModuleContext,
    setUseModuleContext
  };
}