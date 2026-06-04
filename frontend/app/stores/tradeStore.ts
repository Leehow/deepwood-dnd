import { create } from 'zustand';

interface Currency {
  cp: number;
  sp: number;
  ep: number;
  gp: number;
  pp: number;
}

export interface TradeItem {
  id: string;
  name: string;
  name_cn?: string;
  libraryItemId?: number;
  quantity: number;
  category?: string;
  icon?: string;
  rarity?: string;
  description?: string;
  [key: string]: any;  // preserve all original equipment fields
}

export interface TradeSession {
  tradeId: string;
  status: 'pending_incoming' | 'pending_outgoing' | 'active';
  myUserId: string;
  myCharacterId: number;
  myCharacterName: string;
  partnerUserId: string;
  partnerCharacterId: number;
  partnerCharacterName: string;
  myOffer: { items: TradeItem[]; currency: Currency };
  partnerOffer: { items: TradeItem[]; currency: Currency };
  myLocked: boolean;
  partnerLocked: boolean;
}

export interface PendingRequest {
  tradeId: string;
  fromUserId: string;
  fromCharacterId: number;
  fromCharacterName: string;
  targetCharacterId: number;
  targetCharacterName: string;
}

const emptyCurrency = (): Currency => ({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 });

interface TradeState {
  activeTrade: TradeSession | null;
  pendingRequest: PendingRequest | null;
  pendingOutgoing: { targetName: string; tradeId?: string } | null;  // outgoing trade request state

  setActiveTrade: (trade: TradeSession | null) => void;
  setPendingRequest: (req: PendingRequest | null) => void;
  setPendingOutgoing: (val: { targetName: string; tradeId?: string } | null) => void;
  updateMyOffer: (offer: { items: TradeItem[]; currency: Currency }) => void;
  updatePartnerOffer: (offer: { items: TradeItem[]; currency: Currency }) => void;
  setMyLocked: (locked: boolean) => void;
  setPartnerLocked: (locked: boolean) => void;
  reset: () => void;
}

export const useTradeStore = create<TradeState>((set) => ({
  activeTrade: null,
  pendingRequest: null,
  pendingOutgoing: null,

  setActiveTrade: (trade) => set({ activeTrade: trade }),
  setPendingRequest: (req) => set({ pendingRequest: req }),
  setPendingOutgoing: (val) => set({ pendingOutgoing: val }),

  updateMyOffer: (offer) => set((state) => {
    if (!state.activeTrade) return state;
    return { activeTrade: { ...state.activeTrade, myOffer: offer } };
  }),

  updatePartnerOffer: (offer) => set((state) => {
    if (!state.activeTrade) return state;
    return { activeTrade: { ...state.activeTrade, partnerOffer: offer } };
  }),

  setMyLocked: (locked) => set((state) => {
    if (!state.activeTrade) return state;
    return { activeTrade: { ...state.activeTrade, myLocked: locked } };
  }),

  setPartnerLocked: (locked) => set((state) => {
    if (!state.activeTrade) return state;
    return { activeTrade: { ...state.activeTrade, partnerLocked: locked } };
  }),

  reset: () => set({ activeTrade: null, pendingRequest: null, pendingOutgoing: null }),
}));

export { type Currency, emptyCurrency };
