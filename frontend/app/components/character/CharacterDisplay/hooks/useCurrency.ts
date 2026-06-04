import { useCallback, useEffect, useState } from "react";

import type { Character, Currency, EquipmentItem } from "../types/Character";

export interface UseCurrencyArgs {
  character: Character;
  persistCharacterPartial: (
    nextEquipment?: EquipmentItem[] | undefined,
    nextPreparedSpells?: string[] | undefined,
    nextCurrency?: Currency | undefined
  ) => Promise<boolean | any>;
}

const DEFAULT_CURRENCY: Currency = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } as const;

export function useCurrency({ character, persistCharacterPartial }: UseCurrencyArgs) {
  const [currencyLocal, setCurrencyLocal] = useState<Currency>(character.currency || DEFAULT_CURRENCY);
  const [currencyDialogOpen, setCurrencyDialogOpen] = useState(false);

  // Sync currency when character changes - use JSON to detect deep changes
  const currencyJson = JSON.stringify(character.currency);
  useEffect(() => {
    setCurrencyLocal(character.currency || DEFAULT_CURRENCY);
  }, [character.id, currencyJson]);

  const handleSaveCurrency = useCallback(async () => {
    const payload = {
      cp: Number(currencyLocal?.cp || 0),
      sp: Number(currencyLocal?.sp || 0),
      ep: Number(currencyLocal?.ep || 0),
      gp: Number(currencyLocal?.gp || 0),
      pp: Number(currencyLocal?.pp || 0),
    };
    const ok = await persistCharacterPartial(undefined, undefined, payload);
    if (ok) {
      setCurrencyDialogOpen(false);
      // Normalize local display values
      setCurrencyLocal((prev: Currency) => ({
        cp: Number(prev?.cp || 0),
        sp: Number(prev?.sp || 0),
        ep: Number(prev?.ep || 0),
        gp: Number(prev?.gp || 0),
        pp: Number(prev?.pp || 0),
      }));
    }
    return ok;
  }, [currencyLocal, persistCharacterPartial]);

  return {
    currencyLocal,
    setCurrencyLocal,
    currencyDialogOpen,
    setCurrencyDialogOpen,
    handleSaveCurrency,
  } as const;
}

