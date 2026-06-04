/**
 * CampaignContext
 * Provides centralized state management for campaign-related data
 * Reduces prop drilling by making campaign state available to all child components
 */

import { createContext, useContext, useState, useCallback, useMemo, ReactNode } from 'react';

// ===== Types =====

export interface CampaignMap {
  id?: string;
  url: string;
  name?: string;
  width?: number;
  height?: number;
  gridSize?: number;
}

export type DrawTool = 'circle' | 'sketch' | 'arrow' | 'eraser' | null;
export type FogMode = 'brush' | 'eraser';
export type RulerMode = 'measure' | 'erase' | null;

export interface CampaignState {
  // Campaign info
  campaignId: string;
  isDM: boolean;
  userId: string;

  // Map state
  currentMapUrl: string | null;
  selectedMap: CampaignMap | null;
  selectedModule: string | null;
  moduleMaps: CampaignMap[];
  mapImageScale: number;
  gridUnitLength: number;

  // Tool state
  selectedTool: string;
  fogMode: FogMode;
  rulerMode: RulerMode;
  drawTool: DrawTool;
  drawColor: string;
  drawStrokeWidth: number;

  // UI state
  showFogOfWar: boolean;
  showGrid: boolean;
  showLeftSidebar: boolean;
  showRightSidebar: boolean;
  showGridUnitDialog: boolean;
  rightSidebarWidth: number;
  isResizing: boolean;

  // Triggers
  mapListRefreshTrigger: number;
}

export interface CampaignContextValue extends CampaignState {
  // Map actions
  setCurrentMapUrl: (url: string | null) => void;
  setSelectedMap: (map: CampaignMap | null) => void;
  setSelectedModule: (moduleId: string | null) => void;
  setModuleMaps: (maps: CampaignMap[]) => void;
  setMapImageScale: (scale: number) => void;
  setGridUnitLength: (length: number) => void;

  // Tool actions
  selectTool: (tool: string) => void;
  setFogMode: (mode: FogMode) => void;
  setRulerMode: (mode: RulerMode) => void;
  setDrawTool: (tool: DrawTool) => void;
  setDrawColor: (color: string) => void;
  setDrawStrokeWidth: (width: number) => void;

  // UI actions
  toggleFogOfWar: () => void;
  toggleGrid: () => void;
  toggleLeftSidebar: () => void;
  toggleRightSidebar: () => void;
  setShowGridUnitDialog: (show: boolean) => void;
  setRightSidebarWidth: (width: number) => void;
  setIsResizing: (resizing: boolean) => void;

  // Trigger actions
  refreshMapList: () => void;
}

// ===== Context =====

const CampaignContext = createContext<CampaignContextValue | undefined>(undefined);

// ===== Provider =====

export interface CampaignProviderProps {
  children: ReactNode;
  campaignId: string;
  isDM: boolean;
  userId: string;
}

export function CampaignProvider({
  children,
  campaignId,
  isDM,
  userId
}: CampaignProviderProps) {
  // Map state
  const [currentMapUrl, setCurrentMapUrl] = useState<string | null>(null);
  const [selectedMap, setSelectedMap] = useState<CampaignMap | null>(null);
  const [selectedModule, setSelectedModule] = useState<string | null>(null);
  const [moduleMaps, setModuleMaps] = useState<CampaignMap[]>([]);
  const [mapImageScale, setMapImageScale] = useState<number>(1);
  const [gridUnitLength, setGridUnitLength] = useState<number>(5);

  // Tool state
  const [selectedTool, setSelectedTool] = useState<string>('move');
  const [fogMode, setFogMode] = useState<FogMode>('brush');
  const [rulerMode, setRulerMode] = useState<RulerMode>(null);
  const [drawTool, setDrawTool] = useState<DrawTool>(null);
  const [drawColor, setDrawColor] = useState<string>('#ff0000');
  const [drawStrokeWidth, setDrawStrokeWidth] = useState<number>(2);

  // UI state
  const [showFogOfWar, setShowFogOfWar] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [showLeftSidebar, setShowLeftSidebar] = useState(true);
  const [showRightSidebar, setShowRightSidebar] = useState(true);
  const [showGridUnitDialog, setShowGridUnitDialog] = useState(false);
  const [rightSidebarWidth, setRightSidebarWidth] = useState(384);
  const [isResizing, setIsResizing] = useState(false);

  // Triggers
  const [mapListRefreshTrigger, setMapListRefreshTrigger] = useState(0);

  // Actions
  const selectTool = useCallback((tool: string) => {
    setSelectedTool(tool);
  }, []);

  const toggleFogOfWar = useCallback(() => {
    setShowFogOfWar(prev => !prev);
  }, []);

  const toggleGrid = useCallback(() => {
    setShowGrid(prev => !prev);
  }, []);

  const toggleLeftSidebar = useCallback(() => {
    setShowLeftSidebar(prev => !prev);
  }, []);

  const toggleRightSidebar = useCallback(() => {
    setShowRightSidebar(prev => !prev);
  }, []);

  const refreshMapList = useCallback(() => {
    setMapListRefreshTrigger(prev => prev + 1);
  }, []);

  // Memoized context value
  const value = useMemo<CampaignContextValue>(
    () => ({
      // State
      campaignId,
      isDM,
      userId,
      currentMapUrl,
      selectedMap,
      selectedModule,
      moduleMaps,
      mapImageScale,
      gridUnitLength,
      selectedTool,
      fogMode,
      rulerMode,
      drawTool,
      drawColor,
      drawStrokeWidth,
      showFogOfWar,
      showGrid,
      showLeftSidebar,
      showRightSidebar,
      showGridUnitDialog,
      rightSidebarWidth,
      isResizing,
      mapListRefreshTrigger,

      // Actions
      setCurrentMapUrl,
      setSelectedMap,
      setSelectedModule,
      setModuleMaps,
      setMapImageScale,
      setGridUnitLength,
      selectTool,
      setFogMode,
      setRulerMode,
      setDrawTool,
      setDrawColor,
      setDrawStrokeWidth,
      toggleFogOfWar,
      toggleGrid,
      toggleLeftSidebar,
      toggleRightSidebar,
      setShowGridUnitDialog,
      setRightSidebarWidth,
      setIsResizing,
      refreshMapList,
    }),
    [
      campaignId,
      isDM,
      userId,
      currentMapUrl,
      selectedMap,
      selectedModule,
      moduleMaps,
      mapImageScale,
      gridUnitLength,
      selectedTool,
      fogMode,
      rulerMode,
      drawTool,
      drawColor,
      drawStrokeWidth,
      showFogOfWar,
      showGrid,
      showLeftSidebar,
      showRightSidebar,
      showGridUnitDialog,
      rightSidebarWidth,
      isResizing,
      mapListRefreshTrigger,
      selectTool,
      toggleFogOfWar,
      toggleGrid,
      toggleLeftSidebar,
      toggleRightSidebar,
      refreshMapList,
    ]
  );

  return (
    <CampaignContext.Provider value={value}>
      {children}
    </CampaignContext.Provider>
  );
}

// ===== Hook =====

/**
 * Hook to access campaign context
 * @throws Error if used outside CampaignProvider
 */
export function useCampaign(): CampaignContextValue {
  const context = useContext(CampaignContext);

  if (!context) {
    throw new Error('useCampaign must be used within a CampaignProvider');
  }

  return context;
}
