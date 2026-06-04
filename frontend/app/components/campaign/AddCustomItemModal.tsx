/**
 * AddCustomItemModal - 通过自然语言描述创建自定义物品（两步流程：预览编辑 → 确认创建）
 */

import React, { useState } from 'react';
import { Dialog, Flex, Text, Button, TextArea, Badge, TextField, ScrollArea } from '@radix-ui/themes';
import { ItemPreviewEditor, type ParsedItemData } from './ItemPreviewEditor';

const API_BASE = import.meta.env.VITE_API_URL || '';

const ITEM_CATEGORIES = [
  { key: 'weapon', label: '武器', icon: '⚔️' },
  { key: 'armor', label: '护甲', icon: '🛡️' },
  { key: 'jewelry', label: '首饰', icon: '💍' },
  { key: 'adventuring', label: '冒险物品', icon: '🎒' },
  { key: 'magical', label: '法术物品', icon: '✨' },
] as const;

type ItemCategory = typeof ITEM_CATEGORIES[number]['key'];

interface AvatarLibraryItem {
  id: number;
  name: string;
  category: string;
  avatar_url: string;
  avatar_url_large: string | null;
}

interface AddCustomItemModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignId: string;
  onItemAdded: () => void;
  onItemCreated?: (item: Record<string, unknown>) => void;
}

export function AddCustomItemModal({
  open,
  onOpenChange,
  campaignId,
  onItemAdded,
  onItemCreated,
}: AddCustomItemModalProps) {
  // 输入表单状态
  const [description, setDescription] = useState('');
  const [itemName, setItemName] = useState('');
  const [appearance, setAppearance] = useState('');
  const [previewAvatarUrl, setPreviewAvatarUrl] = useState<string | null>(null);
  const [isGeneratingAvatar, setIsGeneratingAvatar] = useState(false);
  const [selectedCategories, setSelectedCategories] = useState<Set<ItemCategory>>(new Set());
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 图库相关
  const [showAvatarLibrary, setShowAvatarLibrary] = useState(false);
  const [avatarLibrary, setAvatarLibrary] = useState<AvatarLibraryItem[]>([]);
  const [loadingLibrary, setLoadingLibrary] = useState(false);

  // 预览编辑状态（非空表示已进入预览模式）
  const [parsedItem, setParsedItem] = useState<ParsedItemData | null>(null);
  const [parsedAvatarUrl, setParsedAvatarUrl] = useState<string | null>(null);
  const [parsedAvatarUrlLarge, setParsedAvatarUrlLarge] = useState<string | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [previewStep, setPreviewStep] = useState(0); // 0=idle, 1/2/3=进度步骤
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRegeneratingAvatar, setIsRegeneratingAvatar] = useState(false);

  const inPreviewMode = parsedItem !== null;

  const toggleCategory = (key: ItemCategory) => {
    setSelectedCategories(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const loadAvatarLibrary = async () => {
    setLoadingLibrary(true);
    try {
      const resp = await fetch(`${API_BASE}/api/items/avatar-library?campaign_id=${campaignId}`);
      if (resp.ok) setAvatarLibrary(await resp.json());
    } catch { /* ignore */ } finally { setLoadingLibrary(false); }
  };

  const handleToggleLibrary = () => {
    if (!showAvatarLibrary) loadAvatarLibrary();
    setShowAvatarLibrary(!showAvatarLibrary);
  };

  const handleSelectFromLibrary = (item: AvatarLibraryItem) => {
    setPreviewAvatarUrl(item.avatar_url);
    setShowAvatarLibrary(false);
  };

  const handleGenerate = async (random: boolean) => {
    if (!random && (!description.trim() || description.trim().length < 2)) {
      setError('请先输入简短描述');
      return;
    }
    setIsGenerating(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/ai-settings/expand-prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: description.trim(),
          entity_type: 'item',
          random,
          categories: [...selectedCategories],
        }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || '生成失败');
      }
      const data = await response.json();
      if (data.expanded_description) setDescription(data.expanded_description);
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成失败');
    } finally { setIsGenerating(false); }
  };

  const handleGenerateAvatar = async () => {
    if (!appearance.trim() && !itemName.trim() && !description.trim()) {
      setError('请先填写外貌描述、名称或物品描述');
      return;
    }
    setIsGeneratingAvatar(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/items/generate-avatar-preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appearance: appearance.trim() || undefined,
          name: itemName.trim() || undefined,
          description: description.trim() || undefined,
          categories: [...selectedCategories],
        }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || '生成图标失败');
      }
      const data = await response.json();
      if (data.avatar_url) setPreviewAvatarUrl(data.avatar_url);
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成图标失败');
    } finally { setIsGeneratingAvatar(false); }
  };

  // 生成预览：调用 preview 端点
  const handlePreview = async () => {
    if (!description.trim() || description.trim().length < 5) {
      setError('请输入至少5个字符的物品描述');
      return;
    }
    setIsPreviewing(true);
    setPreviewStep(1);
    setError(null);
    // 模拟进度推进（实际只有一次 API 调用）
    const t1 = setTimeout(() => setPreviewStep(2), 2500);
    const t2 = setTimeout(() => setPreviewStep(3), 6000);
    try {
      const response = await fetch(`${API_BASE}/api/items/parse-custom/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: description.trim(),
          categories: [...selectedCategories],
          name: itemName.trim() || undefined,
          appearance: appearance.trim() || undefined,
          avatar_url: previewAvatarUrl || undefined,
        }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        const detail = errorData.detail;
        throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
      }
      const data = await response.json();
      setParsedItem(data.parsed);
      setParsedAvatarUrl(data.avatar_url || null);
      setParsedAvatarUrlLarge(data.avatar_url_large || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI解析失败');
    } finally {
      clearTimeout(t1);
      clearTimeout(t2);
      setIsPreviewing(false);
      setPreviewStep(0);
    }
  };

  // 确认创建：带 parsed_data 调用 parse-custom
  const handleConfirmCreate = async () => {
    if (!parsedItem) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/items/parse-custom`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaign_id: parseInt(campaignId),
          description: description.trim(),
          categories: [...selectedCategories],
          name: parsedItem.name,
          appearance: appearance.trim() || undefined,
          avatar_url: parsedAvatarUrl || undefined,
          parsed_data: parsedItem,
        }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        const detail = errorData.detail;
        throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
      }
      const createdItem = await response.json();
      resetForm();
      onOpenChange(false);
      onItemAdded();
      onItemCreated?.(createdItem);
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建物品失败');
    } finally { setIsSubmitting(false); }
  };

  // 重新生成立绘（预览模式下）
  const handleRegenerateAvatar = async () => {
    if (!parsedItem) return;
    setIsRegeneratingAvatar(true);
    try {
      const response = await fetch(`${API_BASE}/api/items/generate-avatar-preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: parsedItem.name,
          description: parsedItem.description?.slice(0, 200) || undefined,
          appearance: appearance.trim() || undefined,
          categories: [...selectedCategories],
        }),
      });
      if (response.ok) {
        const data = await response.json();
        if (data.avatar_url) {
          setParsedAvatarUrl(data.avatar_url);
          setParsedAvatarUrlLarge(data.avatar_url_large || data.avatar_url);
        }
      }
    } catch { /* ignore */ } finally { setIsRegeneratingAvatar(false); }
  };

  const handleBackToEdit = () => {
    setParsedItem(null);
    setParsedAvatarUrl(null);
    setParsedAvatarUrlLarge(null);
    setError(null);
  };

  const resetForm = () => {
    setDescription('');
    setItemName('');
    setAppearance('');
    setPreviewAvatarUrl(null);
    setSelectedCategories(new Set());
    setShowAvatarLibrary(false);
    setAvatarLibrary([]);
    setParsedItem(null);
    setParsedAvatarUrl(null);
    setParsedAvatarUrlLarge(null);
    setPreviewStep(0);
    setError(null);
  };

  const handleClose = () => {
    if (!isSubmitting && !isGenerating && !isGeneratingAvatar && !isPreviewing) {
      resetForm();
      onOpenChange(false);
    }
  };

  const isLoading = isSubmitting || isGenerating || isGeneratingAvatar || isPreviewing;

  return (
    <Dialog.Root open={open} onOpenChange={handleClose}>
      <Dialog.Content aria-describedby={undefined} style={{ maxWidth: inPreviewMode ? 620 : 500 }}>
        <Dialog.Title>
          <span>{inPreviewMode ? '预览编辑物品' : '添加自定义物品'}</span>
        </Dialog.Title>
        <Dialog.Description size="2" color="gray" mb="4">
          <span>{inPreviewMode ? '检查AI解析的参数，可手动编辑后确认创建' : '输入物品描述，AI将自动解析并创建结构化物品数据'}</span>
        </Dialog.Description>

        {inPreviewMode ? (
          /* ===== 预览编辑模式 ===== */
          <Flex direction="column" gap="3">
            <ItemPreviewEditor
              item={parsedItem}
              avatarUrl={parsedAvatarUrl}
              avatarUrlLarge={parsedAvatarUrlLarge}
              onChange={setParsedItem}
              onRegenerateAvatar={handleRegenerateAvatar}
              isRegeneratingAvatar={isRegeneratingAvatar}
            />

            {error && <Text size="2" color="red"><span>{error}</span></Text>}

            <Flex gap="3" justify="end" mt="2">
              <Button variant="soft" color="gray" onClick={handleBackToEdit} disabled={isLoading}>
                <span>返回修改</span>
              </Button>
              <Button onClick={handleConfirmCreate} disabled={isLoading}>
                <span>{isSubmitting ? '创建中...' : '确认创建'}</span>
              </Button>
            </Flex>
          </Flex>
        ) : (
          /* ===== 输入表单模式 ===== */
          <Flex direction="column" gap="3">
            {/* 分类标签 */}
            <Flex gap="2" wrap="wrap">
              {ITEM_CATEGORIES.map(cat => (
                <Badge
                  key={cat.key}
                  size="2"
                  variant={selectedCategories.has(cat.key) ? 'solid' : 'outline'}
                  color={selectedCategories.has(cat.key) ? 'amber' : 'gray'}
                  style={{ cursor: isLoading ? 'default' : 'pointer', userSelect: 'none' }}
                  onClick={() => !isLoading && toggleCategory(cat.key)}
                >
                  {cat.icon} {cat.label}
                </Badge>
              ))}
            </Flex>

            {/* 名称输入（可选） */}
            <Flex direction="column" gap="1">
              <Text size="2" weight="medium" color="gray"><span>物品名称（可选）</span></Text>
              <TextField.Root
                placeholder="留空则AI自动生成"
                value={itemName}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setItemName(e.target.value)}
                disabled={isLoading}
              />
            </Flex>

            {/* 外貌描述 + 图标按钮 */}
            <Flex direction="column" gap="1">
              <Flex justify="between" align="center">
                <Text size="2" weight="medium" color="gray"><span>外貌描述（可选）</span></Text>
                <Flex gap="2">
                  <Button size="1" variant="soft" color="gray" onClick={handleToggleLibrary} disabled={isLoading}>
                    <span>{showAvatarLibrary ? '收起图库' : '选择已有'}</span>
                  </Button>
                  <Button
                    size="1" variant="soft" color="violet"
                    onClick={handleGenerateAvatar}
                    disabled={isLoading || (!appearance.trim() && !itemName.trim() && !description.trim())}
                  >
                    <span>{isGeneratingAvatar ? '生成中...' : '生成图标'}</span>
                  </Button>
                </Flex>
              </Flex>
              <TextArea
                placeholder="描述物品外观以生成图标，如：一把散发着冰蓝色光芒的细长长剑，剑身覆盖霜花纹路"
                value={appearance}
                onChange={(e) => setAppearance(e.target.value)}
                disabled={isLoading}
                style={{ minHeight: 60 }}
              />
            </Flex>

            {/* 图库选择面板 */}
            {showAvatarLibrary && (
              <div style={{ border: '1px solid var(--gray-6)', borderRadius: 8, padding: 8, background: 'var(--gray-2)' }}>
                {loadingLibrary ? (
                  <Text size="2" color="gray"><span>加载中...</span></Text>
                ) : avatarLibrary.length === 0 ? (
                  <Text size="2" color="gray"><span>当前战役暂无已有物品图标</span></Text>
                ) : (
                  <ScrollArea style={{ maxHeight: 160 }}>
                    <Flex gap="2" wrap="wrap">
                      {avatarLibrary.map(item => (
                        <div
                          key={item.id}
                          onClick={() => handleSelectFromLibrary(item)}
                          title={item.name}
                          style={{
                            cursor: 'pointer', borderRadius: 6, overflow: 'hidden',
                            border: previewAvatarUrl === item.avatar_url ? '2px solid var(--amber-9)' : '1px solid var(--gray-6)',
                            width: 56, height: 56, flexShrink: 0,
                          }}
                        >
                          <img src={item.avatar_url} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        </div>
                      ))}
                    </Flex>
                  </ScrollArea>
                )}
              </div>
            )}

            {/* 头像预览 */}
            {previewAvatarUrl && (
              <Flex align="center" gap="3">
                <img
                  src={previewAvatarUrl} alt="物品图标预览"
                  style={{ width: 64, height: 64, borderRadius: 8, objectFit: 'cover', border: '1px solid var(--gray-6)' }}
                />
                <Flex direction="column" gap="1">
                  <Text size="1" color="gray"><span>图标预览</span></Text>
                  <Button size="1" variant="ghost" color="red" onClick={() => setPreviewAvatarUrl(null)} disabled={isLoading}>
                    <span>移除</span>
                  </Button>
                </Flex>
              </Flex>
            )}

            {/* 主描述文本框（必填） */}
            <Text size="2" weight="medium"><span>物品描述（必填）</span></Text>
            <TextArea
              placeholder="例如：寒冰长剑，一把稀有的+1长剑，命中时额外造成1d6冷冻伤害。剑身覆盖着永不融化的冰霜，握柄处刻有古老的矮人符文。需要同调。"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isLoading}
              color="amber"
              style={{ minHeight: 150, boxShadow: '0 0 0 1px var(--amber-8)' }}
            />

            <Flex gap="2" align="center">
              <Button size="1" variant="soft" color="orange" onClick={() => handleGenerate(true)} disabled={isLoading}>
                <span>{isGenerating ? '生成中...' : '随机生成'}</span>
              </Button>
              <Button size="1" variant="soft" color="cyan" onClick={() => handleGenerate(false)} disabled={isLoading || !description.trim()}>
                <span>扩展描述</span>
              </Button>
              <Text size="1" color="gray"><span>可多次点击生成不同内容</span></Text>
            </Flex>

            {error && <Text size="2" color="red"><span>{error}</span></Text>}

            {/* 生成进度 */}
            {isPreviewing && previewStep > 0 && (
              <div className="space-y-1.5 p-3 rounded-lg" style={{ background: 'var(--gray-2)', border: '1px solid var(--gray-5)' }}>
                {[
                  { step: 1, label: '分析物品描述...' },
                  { step: 2, label: '生成结构化参数...' },
                  { step: 3, label: '生成物品立绘...' },
                ].map(({ step, label }) => (
                  <div key={step} className="flex items-center gap-2 text-sm" style={{ opacity: previewStep >= step ? 1 : 0.3 }}>
                    {previewStep > step ? (
                      <span style={{ color: 'var(--green-9)' }}>&#10003;</span>
                    ) : previewStep === step ? (
                      <span className="inline-block animate-spin" style={{ width: 14, height: 14, border: '2px solid var(--amber-6)', borderTopColor: 'transparent', borderRadius: '50%' }} />
                    ) : (
                      <span style={{ width: 14, textAlign: 'center', color: 'var(--gray-8)' }}>&#9675;</span>
                    )}
                    <span style={{ color: previewStep >= step ? 'var(--gray-12)' : 'var(--gray-8)' }}>{label}</span>
                  </div>
                ))}
              </div>
            )}

            <Flex gap="3" justify="end" mt="2">
              <Dialog.Close>
                <Button variant="soft" color="gray" disabled={isLoading}><span>取消</span></Button>
              </Dialog.Close>
              <Button onClick={handlePreview} disabled={isLoading || !description.trim()}>
                <span>{isPreviewing ? 'AI解析中...' : '生成预览'}</span>
              </Button>
            </Flex>
          </Flex>
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
}
