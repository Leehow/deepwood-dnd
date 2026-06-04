declare module '@3d-dice/dice-box' {
  interface DiceBoxConfig {
    assetPath: string;
    theme?: string;
    themeColor?: string;
    scale?: number;
    gravity?: number;
    spinForce?: number;
    throwForce?: number;
    startingHeight?: number;
    settleTimeout?: number;
    offscreen?: boolean;
    delay?: number;
    lightIntensity?: number;
    shadowTransparency?: number;
  }

  interface DieResult {
    groupId: number;
    rollId: number;
    sides: number;
    theme: string;
    themeColor?: string;
    value: number;
  }

  class DiceBox {
    constructor(config: DiceBoxConfig & { container: string });
    /** @deprecated old API */
    constructor(selector: string, config: DiceBoxConfig);
    init(): Promise<void>;
    roll(notation: string | object | (string | object)[], options?: { theme?: string; newStartPoint?: boolean }): Promise<DieResult[]>;
    add(notation: string | object | (string | object)[]): Promise<DieResult[]>;
    reroll(notation: DieResult | DieResult[]): Promise<DieResult[]>;
    remove(notation: DieResult | DieResult[]): Promise<void>;
    clear(): void;
    updateConfig(config: Partial<DiceBoxConfig>): void;
    getRollResults(): DieResult[];
    onRollComplete?: (results: DieResult[]) => void;
    onThemeConfigLoaded?: (themeData: any) => void;
  }

  export default DiceBox;
}
