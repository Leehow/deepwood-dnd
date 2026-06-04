import { useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AIMapGenerationModal } from './AIMapGenerationModal';

interface MapData {
  id: string;
  name: string;
  url: string;
  chapter?: string;
  metadata?: {
    width: number;
    height: number;
    aspect_ratio: string;
  };
}

interface MapTransform {
  rotation: number;      // 0, 90, 180, 270
  flipH: boolean;        // 水平翻转
  flipV: boolean;        // 垂直翻转
}

interface MapManagementPanelProps {
  moduleMaps: MapData[];
  selectedMap: MapData | null;
  mapImageScale: number;
  mapTransform?: MapTransform;
  onSelectMap: (map: MapData) => void;
  onMapUse: (map: MapData) => void;
  onMapScaleChange: (scale: number) => void;
  onMapTransformChange?: (transform: MapTransform) => void;
  onMapDelete: (mapId: string) => void;
  onAddToLibrary: (map: MapData) => void;
  onOpenLibrary: () => void;
  campaignId?: string;
  onMapAdded?: () => void;
}

export function MapManagementPanel({
  moduleMaps,
  selectedMap,
  mapImageScale,
  mapTransform = { rotation: 0, flipH: false, flipV: false },
  onSelectMap,
  onMapUse,
  onMapScaleChange,
  onMapTransformChange,
  onMapDelete,
  onAddToLibrary,
  onOpenLibrary,
  campaignId,
  onMapAdded,
}: MapManagementPanelProps) {
  const [hoveredMapId, setHoveredMapId] = useState<string | null>(null);
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [lightboxMap, setLightboxMap] = useState<MapData | null>(null);
  const [lightboxZoom, setLightboxZoom] = useState(1);
  const [lightboxPan, setLightboxPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [isEditingScale, setIsEditingScale] = useState(false);
  const [scaleInputValue, setScaleInputValue] = useState('');
  const [showAIMapModal, setShowAIMapModal] = useState(false);
  const scaleInputRef = useRef<HTMLInputElement>(null);

  const handleZoomIn = useCallback(() => {
    onMapScaleChange(Math.min(5, mapImageScale * 1.1));
  }, [mapImageScale, onMapScaleChange]);

  const handleZoomOut = useCallback(() => {
    onMapScaleChange(Math.max(0.3, mapImageScale / 1.1));
  }, [mapImageScale, onMapScaleChange]);

  const handleZoomReset = useCallback(() => {
    onMapScaleChange(1);
  }, [onMapScaleChange]);

  // 缩放条拖拽
  const zoomTrackRef = useRef<HTMLDivElement>(null);
  const MIN_SCALE = 0.3;
  const MAX_SCALE = 5;

  const scaleFromPosition = useCallback((clientX: number) => {
    const track = zoomTrackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const newScale = MIN_SCALE + ratio * (MAX_SCALE - MIN_SCALE);
    onMapScaleChange(Math.round(newScale * 100) / 100);
  }, [onMapScaleChange]);

  const handleTrackPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const track = zoomTrackRef.current;
    if (!track) return;
    track.setPointerCapture(e.pointerId);
    scaleFromPosition(e.clientX);
  }, [scaleFromPosition]);

  const handleTrackPointerMove = useCallback((e: React.PointerEvent) => {
    const track = zoomTrackRef.current;
    if (!track || !track.hasPointerCapture(e.pointerId)) return;
    scaleFromPosition(e.clientX);
  }, [scaleFromPosition]);

  // 旋转控制
  const handleRotateLeft = useCallback(() => {
    if (!onMapTransformChange) return;
    const newRotation = ((mapTransform.rotation - 90) + 360) % 360;
    onMapTransformChange({ ...mapTransform, rotation: newRotation });
  }, [mapTransform, onMapTransformChange]);

  const handleRotateRight = useCallback(() => {
    if (!onMapTransformChange) return;
    const newRotation = (mapTransform.rotation + 90) % 360;
    onMapTransformChange({ ...mapTransform, rotation: newRotation });
  }, [mapTransform, onMapTransformChange]);

  // 翻转控制
  const handleFlipH = useCallback(() => {
    if (!onMapTransformChange) return;
    onMapTransformChange({ ...mapTransform, flipH: !mapTransform.flipH });
  }, [mapTransform, onMapTransformChange]);

  const handleFlipV = useCallback(() => {
    if (!onMapTransformChange) return;
    onMapTransformChange({ ...mapTransform, flipV: !mapTransform.flipV });
  }, [mapTransform, onMapTransformChange]);

  // 重置变换
  const handleResetTransform = useCallback(() => {
    if (!onMapTransformChange) return;
    onMapTransformChange({ rotation: 0, flipH: false, flipV: false });
    onMapScaleChange(1);
  }, [onMapTransformChange, onMapScaleChange]);

  // 计算预览图的 transform 样式
  const getPreviewTransform = () => {
    const transforms: string[] = [];
    if (mapTransform.rotation !== 0) {
      transforms.push(`rotate(${mapTransform.rotation}deg)`);
    }
    if (mapTransform.flipH) {
      transforms.push('scaleX(-1)');
    }
    if (mapTransform.flipV) {
      transforms.push('scaleY(-1)');
    }
    return transforms.length > 0 ? transforms.join(' ') : undefined;
  };

  // 检查是否有变换
  const hasTransform = mapTransform.rotation !== 0 || mapTransform.flipH || mapTransform.flipV || mapImageScale !== 1;

  // Lightbox 控制函数
  const openLightbox = useCallback((map: MapData) => {
    setLightboxMap(map);
    setLightboxZoom(1);
    setLightboxPan({ x: 0, y: 0 });
  }, []);

  const closeLightbox = useCallback(() => {
    setLightboxMap(null);
    setLightboxZoom(1);
    setLightboxPan({ x: 0, y: 0 });
  }, []);

  const handleLightboxZoomIn = useCallback(() => {
    setLightboxZoom(z => Math.min(5, z * 1.3));
  }, []);

  const handleLightboxZoomOut = useCallback(() => {
    setLightboxZoom(z => Math.max(0.5, z / 1.3));
  }, []);

  const handleLightboxReset = useCallback(() => {
    setLightboxZoom(1);
    setLightboxPan({ x: 0, y: 0 });
  }, []);

  const handleLightboxWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setLightboxZoom(z => Math.min(5, Math.max(0.5, z * delta)));
  }, []);

  const handleLightboxMouseDown = useCallback((e: React.MouseEvent) => {
    if (lightboxZoom > 1) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - lightboxPan.x, y: e.clientY - lightboxPan.y });
    }
  }, [lightboxZoom, lightboxPan]);

  const handleLightboxMouseMove = useCallback((e: React.MouseEvent) => {
    if (isDragging) {
      setLightboxPan({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      });
    }
  }, [isDragging, dragStart]);

  const handleLightboxMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Esc 键关闭 lightbox
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && lightboxMap) {
        closeLightbox();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lightboxMap, closeLightbox]);

  return (
    <div className="map-mgmt-container">
      {/* Header */}
      <div className="map-mgmt-header">
        <div className="map-mgmt-title-group">
          <div className="map-mgmt-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l5.447 2.724A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
            </svg>
          </div>
          <h3 className="map-mgmt-title">地图管理</h3>
        </div>
        <div className="map-mgmt-actions">
          <button className="map-mgmt-btn map-mgmt-btn-library" onClick={onOpenLibrary}>
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
            </svg>
            <span>地图库</span>
          </button>
          {campaignId && (
            <button className="map-mgmt-btn" onClick={() => setShowAIMapModal(true)}>
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path d="M15.98 1.804a1 1 0 00-1.96 0l-.24 1.192a1 1 0 01-.784.785l-1.192.238a1 1 0 000 1.962l1.192.238a1 1 0 01.785.785l.238 1.192a1 1 0 001.962 0l.238-1.192a1 1 0 01.785-.785l1.192-.238a1 1 0 000-1.962l-1.192-.238a1 1 0 01-.785-.785l-.238-1.192zM6.949 5.684a1 1 0 00-1.898 0l-.683 2.051a1 1 0 01-.633.633l-2.051.683a1 1 0 000 1.898l2.051.684a1 1 0 01.633.632l.683 2.051a1 1 0 001.898 0l.683-2.051a1 1 0 01.633-.633l2.051-.683a1 1 0 000-1.898l-2.051-.683a1 1 0 01-.633-.633L6.95 5.684z" />
              </svg>
              <span>AI生成</span>
            </button>
          )}
          <button className="map-mgmt-btn">
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
            </svg>
            <span>上传</span>
          </button>
        </div>
      </div>

      {/* Current Map Preview */}
      <div className="map-preview-card">
        <div className="map-preview-card-inner">
          <div className="map-preview-header">
            <div className="map-preview-badge">当前地图</div>
            <div className="map-preview-name">
              {selectedMap ? selectedMap.name : '未选择地图'}
            </div>
          </div>

          <div className="map-preview-viewport">
            <div className="map-preview-frame">
              {selectedMap ? (
                <>
                  <img
                    src={selectedMap.url}
                    alt={selectedMap.name}
                    className={`map-preview-image ${previewLoaded ? 'loaded' : ''}`}
                    style={{ transform: getPreviewTransform() }}
                    onLoad={() => setPreviewLoaded(true)}
                  />
                  <div className="map-preview-overlay" />
                </>
              ) : (
                <div className="map-preview-empty">
                  <div className="map-preview-empty-icon">
                    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1">
                      <circle cx="24" cy="24" r="20" strokeDasharray="4 2" opacity="0.3" />
                      <path d="M24 14v20M14 24h20" opacity="0.2" strokeWidth="2" />
                      <path d="M15 15l6 6M33 15l-6 6M15 33l6-6M33 33l-6-6" opacity="0.15" />
                    </svg>
                  </div>
                  <span className="map-preview-empty-text">选择地图开始冒险</span>
                </div>
              )}
            </div>
            {/* Corner decorations */}
            <div className="map-preview-corner map-preview-corner-tl" />
            <div className="map-preview-corner map-preview-corner-tr" />
            <div className="map-preview-corner map-preview-corner-bl" />
            <div className="map-preview-corner map-preview-corner-br" />
          </div>

          {/* Map Controls */}
          {selectedMap && (
            <div className="map-controls-section">
              {/* Zoom Controls */}
              <div className="map-zoom-controls">
                <div className="map-zoom-track">
                  <button
                    className="map-zoom-btn"
                    onClick={handleZoomOut}
                    disabled={mapImageScale <= 0.3}
                    title="缩小"
                  >
                    <svg viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
                    </svg>
                  </button>
                  <div
                    className="map-zoom-indicator"
                    ref={zoomTrackRef}
                    onPointerDown={handleTrackPointerDown}
                    onPointerMove={handleTrackPointerMove}
                  >
                    <div
                      className="map-zoom-bar"
                      style={{ width: `${((mapImageScale - 0.3) / 4.7) * 100}%` }}
                    />
                    <div
                      className="map-zoom-thumb"
                      style={{ left: `${((mapImageScale - 0.3) / 4.7) * 100}%` }}
                    />
                  </div>
                  <button
                    className="map-zoom-btn"
                    onClick={handleZoomIn}
                    disabled={mapImageScale >= 5}
                    title="放大"
                  >
                    <svg viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                    </svg>
                  </button>
                </div>
                {isEditingScale ? (
                  <input
                    ref={scaleInputRef}
                    type="text"
                    value={scaleInputValue}
                    onChange={(e) => setScaleInputValue(e.target.value.replace(/[^0-9]/g, ''))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const val = parseInt(scaleInputValue, 10);
                        if (val >= 30 && val <= 500) onMapScaleChange(val / 100);
                        setIsEditingScale(false);
                      } else if (e.key === 'Escape') {
                        setIsEditingScale(false);
                      }
                    }}
                    onBlur={() => {
                      const val = parseInt(scaleInputValue, 10);
                      if (val >= 30 && val <= 500) onMapScaleChange(val / 100);
                      setIsEditingScale(false);
                    }}
                    className="map-zoom-reset"
                    style={{ width: '52px', textAlign: 'center', cursor: 'text' }}
                    maxLength={3}
                  />
                ) : (
                <button
                  className="map-zoom-reset"
                  onClick={() => {
                    setScaleInputValue(String(Math.round(mapImageScale * 100)));
                    setIsEditingScale(true);
                    setTimeout(() => scaleInputRef.current?.select(), 0);
                  }}
                  title="点击输入缩放百分比"
                >
                  {Math.round(mapImageScale * 100)}%
                </button>
                )}
              </div>

              {/* Transform Controls */}
              <div className="map-transform-controls">
                {/* Rotation */}
                <div className="map-transform-group">
                  <span className="map-transform-label">旋转</span>
                  <div className="map-transform-buttons">
                    <button
                      className="map-transform-btn"
                      onClick={handleRotateLeft}
                      title="逆时针旋转90°"
                    >
                      <svg viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M7.707 3.293a1 1 0 010 1.414L5.414 7H11a7 7 0 017 7v2a1 1 0 11-2 0v-2a5 5 0 00-5-5H5.414l2.293 2.293a1 1 0 11-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    </button>
                    <span className={`map-transform-value ${mapTransform.rotation !== 0 ? 'active' : ''}`}>
                      {mapTransform.rotation}°
                    </span>
                    <button
                      className="map-transform-btn"
                      onClick={handleRotateRight}
                      title="顺时针旋转90°"
                    >
                      <svg viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M12.293 3.293a1 1 0 011.414 0l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414-1.414L14.586 9H9a5 5 0 00-5 5v2a1 1 0 11-2 0v-2a7 7 0 017-7h5.586l-2.293-2.293a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Flip */}
                <div className="map-transform-group">
                  <span className="map-transform-label">翻转</span>
                  <div className="map-transform-buttons">
                    <button
                      className={`map-transform-btn ${mapTransform.flipH ? 'active' : ''}`}
                      onClick={handleFlipH}
                      title="水平翻转"
                    >
                      <svg viewBox="0 0 20 20" fill="currentColor">
                        <path d="M8 5a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1zM8 15a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
                        <path fillRule="evenodd" d="M4 10a1 1 0 011-1h1V6.5a.5.5 0 01.854-.354l3 3a.5.5 0 010 .708l-3 3A.5.5 0 016 12.5V10H5a1 1 0 01-1-1zm11 0a1 1 0 00-1-1h-1V6.5a.5.5 0 00-.854-.354l-3 3a.5.5 0 000 .708l3 3a.5.5 0 00.854-.354V10h1a1 1 0 001-1z" clipRule="evenodd" />
                      </svg>
                      <span>水平</span>
                    </button>
                    <button
                      className={`map-transform-btn ${mapTransform.flipV ? 'active' : ''}`}
                      onClick={handleFlipV}
                      title="垂直翻转"
                    >
                      <svg viewBox="0 0 20 20" fill="currentColor">
                        <path d="M5 8a1 1 0 00-1 1v2a1 1 0 102 0V9a1 1 0 00-1-1zM15 8a1 1 0 00-1 1v2a1 1 0 102 0V9a1 1 0 00-1-1z" />
                        <path fillRule="evenodd" d="M10 4a1 1 0 00-1 1v1H6.5a.5.5 0 00-.354.854l3 3a.5.5 0 00.708 0l3-3A.5.5 0 0012.5 6H10V5a1 1 0 00-1-1zm0 11a1 1 0 001-1v-1h2.5a.5.5 0 00.354-.854l-3-3a.5.5 0 00-.708 0l-3 3A.5.5 0 007.5 13H10v1a1 1 0 001 1z" clipRule="evenodd" />
                      </svg>
                      <span>垂直</span>
                    </button>
                  </div>
                </div>

                {/* Reset */}
                {hasTransform && (
                  <button
                    className="map-transform-reset"
                    onClick={handleResetTransform}
                    title="重置所有变换"
                  >
                    <svg viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
                    </svg>
                    <span>重置</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Map List */}
      <div className="map-list-section">
        <div className="map-list-header">
          <div className="map-list-header-line" />
          <span className="map-list-header-text">
            可用地图
            <span className="map-list-count">{moduleMaps.length}</span>
          </span>
          <div className="map-list-header-line" />
        </div>

        <div className="map-list-grid">
          {moduleMaps.length === 0 ? (
            <div className="map-list-empty">
              <div className="map-list-empty-icon">
                <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="6" y="10" width="28" height="20" rx="2" strokeDasharray="3 2" />
                  <path d="M6 20h28M20 10v20" opacity="0.3" />
                </svg>
              </div>
              <p>暂无可用地图</p>
              <span>从模组导入或上传新地图</span>
            </div>
          ) : (
            moduleMaps.map((map, index) => {
              const isSelected = selectedMap?.id === map.id;
              const isHovered = hoveredMapId === map.id;

              return (
                <div
                  key={map.id || index}
                  className={`map-card ${isSelected ? 'map-card-selected' : ''}`}
                  onMouseEnter={() => setHoveredMapId(map.id)}
                  onMouseLeave={() => setHoveredMapId(null)}
                  style={{ animationDelay: `${index * 50}ms` }}
                >
                  <div
                    className="map-card-thumbnail"
                    onClick={() => openLightbox(map)}
                    title="点击查看大图"
                  >
                    <img src={map.url} alt={map.name} loading="lazy" />
                    <div className="map-card-thumbnail-overlay">
                      <svg className="map-card-zoom-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="11" cy="11" r="8" />
                        <path d="M21 21l-4.35-4.35M11 8v6M8 11h6" />
                      </svg>
                    </div>
                    {isSelected && (
                      <div className="map-card-active-badge">
                        <svg viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                      </div>
                    )}
                  </div>

                  <div className="map-card-content" onClick={() => onSelectMap(map)}>
                    <div className="map-card-info">
                      <h4 className={`map-card-name ${isSelected ? 'text-amber-300' : ''}`}>
                        {map.name}
                      </h4>
                      {map.chapter && (
                        <p className="map-card-chapter">{map.chapter}</p>
                      )}
                      {map.metadata && (
                        <p className="map-card-meta">
                          {map.metadata.width}×{map.metadata.height}
                        </p>
                      )}
                    </div>

                    <div className={`map-card-actions ${isHovered || isSelected ? 'visible' : ''}`}>
                      <button
                        className="map-action-btn map-action-use"
                        onClick={(e) => { e.stopPropagation(); onMapUse(map); }}
                        title="使用此地图"
                      >
                        <svg viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                        </svg>
                      </button>
                      <button
                        className="map-action-btn map-action-save"
                        onClick={(e) => { e.stopPropagation(); onAddToLibrary(map); }}
                        title="保存到地图库"
                      >
                        <svg viewBox="0 0 20 20" fill="currentColor">
                          <path d="M5 4a2 2 0 012-2h6a2 2 0 012 2v14l-5-2.5L5 18V4z" />
                        </svg>
                      </button>
                      <button
                        className="map-action-btn map-action-delete"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`确定要删除地图 "${map.name}" 吗？`)) {
                            onMapDelete(map.id);
                          }
                        }}
                        title="删除地图"
                      >
                        <svg viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Lightbox Modal - portal to body for global positioning */}
      {lightboxMap && createPortal(
        <div
          className="map-lightbox-overlay"
          onClick={closeLightbox}
          onMouseUp={handleLightboxMouseUp}
          onMouseMove={handleLightboxMouseMove}
        >
          <div className="map-lightbox-container" onClick={(e) => e.stopPropagation()}>
            {/* Header with title and close */}
            <div className="map-lightbox-header">
              <div className="map-lightbox-title-area">
                <h3 className="map-lightbox-title">{lightboxMap.name}</h3>
                {lightboxMap.chapter && (
                  <p className="map-lightbox-chapter">{lightboxMap.chapter}</p>
                )}
              </div>
              <button
                className="map-lightbox-close"
                onClick={closeLightbox}
                title="关闭 (Esc)"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Map Image with zoom/pan */}
            <div
              className="map-lightbox-viewport"
              onWheel={handleLightboxWheel}
              onMouseDown={handleLightboxMouseDown}
              style={{ cursor: lightboxZoom > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default' }}
            >
              <img
                src={lightboxMap.url}
                alt={lightboxMap.name}
                className="map-lightbox-image"
                style={{
                  transform: `scale(${lightboxZoom}) translate(${lightboxPan.x / lightboxZoom}px, ${lightboxPan.y / lightboxZoom}px)`,
                }}
                draggable={false}
              />
            </div>

            {/* Zoom Controls */}
            <div className="map-lightbox-zoom-bar">
              <button
                className="map-lightbox-zoom-btn"
                onClick={handleLightboxZoomOut}
                disabled={lightboxZoom <= 0.5}
                title="缩小"
              >
                <svg viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
                </svg>
              </button>
              <div className="map-lightbox-zoom-track">
                <div
                  className="map-lightbox-zoom-fill"
                  style={{ width: `${((lightboxZoom - 0.5) / 4.5) * 100}%` }}
                />
              </div>
              <button
                className="map-lightbox-zoom-btn"
                onClick={handleLightboxZoomIn}
                disabled={lightboxZoom >= 5}
                title="放大"
              >
                <svg viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                </svg>
              </button>
              <button
                className="map-lightbox-zoom-reset"
                onClick={handleLightboxReset}
                title="重置缩放"
              >
                {Math.round(lightboxZoom * 100)}%
              </button>
            </div>

            {/* Action Buttons */}
            <div className="map-lightbox-actions">
              <button
                className="map-lightbox-btn map-lightbox-btn-use"
                onClick={() => { onMapUse(lightboxMap); closeLightbox(); }}
              >
                <svg viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                </svg>
                使用地图
              </button>
              <button
                className="map-lightbox-btn map-lightbox-btn-save"
                onClick={() => onAddToLibrary(lightboxMap)}
              >
                <svg viewBox="0 0 20 20" fill="currentColor">
                  <path d="M5 4a2 2 0 012-2h6a2 2 0 012 2v14l-5-2.5L5 18V4z" />
                </svg>
                加入图库
              </button>
              <button
                className="map-lightbox-btn map-lightbox-btn-delete"
                onClick={() => {
                  if (confirm(`确定要删除地图 "${lightboxMap.name}" 吗？`)) {
                    onMapDelete(lightboxMap.id);
                    closeLightbox();
                  }
                }}
              >
                <svg viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                删除
              </button>
            </div>

            {/* Keyboard hint */}
            <p className="map-lightbox-hint">滚轮缩放 · 拖动平移 · Esc 关闭</p>
          </div>
        </div>,
        document.body
      )}

      {/* AI Map Generation Modal - portal to body for global positioning */}
      {campaignId && createPortal(
        <AIMapGenerationModal
          open={showAIMapModal}
          onClose={() => setShowAIMapModal(false)}
          campaignId={campaignId}
          onMapGenerated={() => onMapAdded?.()}
        />,
        document.body
      )}
    </div>
  );
}
