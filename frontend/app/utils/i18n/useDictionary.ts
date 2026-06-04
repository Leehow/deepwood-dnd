/**
 * React hook to ensure translation dictionary is initialized
 */

import { useEffect, useState } from 'react';
import { ensureDictionaryInitialized } from './dictionary';

export function useDictionary() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    ensureDictionaryInitialized().then(() => {
      setReady(true);
    });
  }, []);

  return ready;
}

