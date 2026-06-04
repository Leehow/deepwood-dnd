import React, { useState, useEffect } from 'react';
import { Select, Card, Text, Flex, Box, Badge, ScrollArea, Button, Dialog, TextField, Grid } from '@radix-ui/themes';
import { Plus, Trash2, Pencil } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { getCurrentUserId } from '~/utils/user';
import { apiFetch } from '~/utils/api-client';
import { createLogger } from '~/utils/logger';
const logger = createLogger('ModuleSelector');

// Base path for static assets
const BASE_PATH = typeof import.meta.env?.BASE_URL === 'string' ? import.meta.env.BASE_URL.replace(/\/$/, '') : '';

// Known static-only modules (exist only in frontend public/rules/modules/)
const STATIC_ONLY_MODULES = new Set(['lost_mine_of_phandelver']);

// 模板类型定义
interface ModuleTemplate {
  id: string;
  name: string;
  name_en?: string;
  default_title?: string;
  description: string;
  icon: string;
  type: string;
  recommended_level: { min: number; max: number };
  estimated_sessions: string;
  default_goals: string[];
  ai_prompts: Record<string, string>;
}


// 定义数据类型
interface Module {
  id: string;
  title: string;
  title_en: string;
  description: string;
  version: string;
  author: string;
  level_range: string;
  player_count: string;
  estimated_time: string;
}

interface Chapter {
  id: string;
  number: number;
  title: string;
  title_en: string;
  description: string;
  key_locations: string[];
  key_npcs: string[];
  encounters: string[];
  level_range: string;
}

interface NPC {
  id: string;
  name: string;
  name_en: string;
  race: string;
  occupation: string;
  faction?: string;
  location: string;
  description: string;
  personality: Record<string, any>;
  knowledge: string[];
  secrets: string[];
  stats?: Record<string, any>;
  quest_giver: boolean;
  quests: string[];
  dialogue_samples?: string[];
  relationships?: Record<string, string>;
  personality_traits?: string;
  alignment?: string;
  hp?: number;
  ac?: number;
}

interface Location {
  id: string;
  name: string;
  name_en: string;
  type: string;
  description: string;
  atmosphere?: string;
  lighting?: string;
  sounds?: string;
  smells?: string;
  connections?: string[];
  room_features?: string[];
}

interface ModuleData {
  module: Module;
  chapters: Chapter[];
  npcs: NPC[];
  locations: Location[];
  quests: any[];
  factions: any[];
  encounters: any[];
  items: any[];
  maps: any[];
  npcs_detailed?: NPC[];
  locations_detailed?: Location[];
  traps?: any[];
  treasures?: any[];
  dialogues?: any[];
}

// 模组选择器组件
export function ModuleSelector({
  selectedModule,
  onModuleChange,
  onModuleLoad
}: {
  selectedModule: string;
  onModuleChange: (moduleId: string) => void;
  onModuleLoad?: (data: ModuleData) => void;
}) {
  const userId = getCurrentUserId();
  const authedFetch = (input: RequestInfo | URL, init?: RequestInit) =>
    apiFetch(input, { ...init, userId });
  const [availableModules, setAvailableModules] = useState<Array<{
    id: string;
    title: string;
    title_en?: string;
    isCustom?: boolean;
  }>>([]);
  const [isLoadingModules, setIsLoadingModules] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  // 模板选择相关状态
  const [templates, setTemplates] = useState<ModuleTemplate[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  // 仅空白模板需要输入标题
  const [showBlankTitleDialog, setShowBlankTitleDialog] = useState(false);
  const [blankTitle, setBlankTitle] = useState('');

  // 删除模组相关状态
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // 重命名模组相关状态
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [renameTitle, setRenameTitle] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);

  // 获取当前选中的模组信息
  const currentModuleInfo = availableModules.find(m => m.id === selectedModule);

  // 删除自定义模组
  const handleDeleteModule = async () => {
    if (!selectedModule || !currentModuleInfo?.isCustom) return;
    setIsDeleting(true);
    try {
      const response = await authedFetch(`/api/custom-modules/${selectedModule}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        const deletedId = selectedModule;
        // 刷新列表
        const updatedModules = await fetchAllModules();
        // 切换到列表中第一个其他模组
        const next = updatedModules.find(m => m.id !== deletedId);
        onModuleChange(next?.id || '');
        setShowDeleteConfirm(false);
      }
    } catch (error) {
      logger.error('Failed to delete module:', error);
    } finally {
      setIsDeleting(false);
    }
  };

  // 重命名自定义模组
  const handleRenameModule = async () => {
    if (!selectedModule || !currentModuleInfo?.isCustom || !renameTitle.trim()) return;
    setIsRenaming(true);
    try {
      const response = await authedFetch(`/api/custom-modules/${selectedModule}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: renameTitle.trim() }),
      });
      if (response.ok) {
        await fetchAllModules();
        setShowRenameDialog(false);
      }
    } catch (error) {
      logger.error('Failed to rename module:', error);
    } finally {
      setIsRenaming(false);
    }
  };

  // 加载模板列表
  useEffect(() => {
    const fetchTemplates = async () => {
      try {
        const response = await authedFetch('/api/custom-modules/templates');
        if (response.ok) {
          const data = await response.json();
          setTemplates(data);
          logger.debug('Loaded templates:', data);
        } else {
          logger.error('Failed to fetch templates:', response.status);
        }
      } catch (error) {
        logger.error('Failed to fetch templates:', error);
      }
    };
    fetchTemplates();
  }, [userId]);

  // 选择模板后直接创建
  const handleSelectTemplate = async (template: ModuleTemplate) => {
    if (template.id === 'blank') {
      // 空白模板需要用户输入标题
      setBlankTitle('');
      setShowBlankTitleDialog(true);
      setShowCreateDialog(false);
      return;
    }
    // 非空白模板直接创建，使用模板的默认标题和描述
    await createModule({
      title: template.default_title || template.name,
      description: template.description,
      template_id: template.id,
      recommended_level_min: template.recommended_level.min,
      recommended_level_max: template.recommended_level.max,
      estimated_sessions: template.estimated_sessions,
    });
  };

  // 创建空白模组
  const handleCreateBlank = async () => {
    if (!blankTitle.trim()) return;
    const blankTemplate = templates.find(t => t.id === 'blank');
    await createModule({
      title: blankTitle.trim(),
      template_id: 'blank',
      recommended_level_min: blankTemplate?.recommended_level.min ?? 1,
      recommended_level_max: blankTemplate?.recommended_level.max ?? 20,
      estimated_sessions: null,
    });
    setShowBlankTitleDialog(false);
    setBlankTitle('');
  };

  // 加载模组列表（解析模组 + 自定义模组）
  const fetchAllModules = async () => {
    setIsLoadingModules(true);
    try {
      // 并行获取两个列表
      const [parsedRes, customRes] = await Promise.all([
        authedFetch('/api/modules/parsed'),
        authedFetch('/api/custom-modules'),
      ]);

      const allModules: Array<{ id: string; title: string; title_en?: string; isCustom?: boolean }> = [];

      if (parsedRes.ok) {
        const parsed = await parsedRes.json();
        allModules.push(...parsed.map((m: any) => ({
          id: m.id,  // /api/modules/parsed 返回的字段名是 id
          title: m.title,
          title_en: m.title_en,
          isCustom: false,
        })));
      }

      if (customRes.ok) {
        const custom = await customRes.json();
        // custom_modules 返回的是 { items: [...] } 格式
        const customItems = custom.items || custom;
        allModules.push(...customItems.map((m: any) => ({
          id: m.module_id,
          title: m.title,
          title_en: null,
          isCustom: true,
        })));
      }

      setAvailableModules(allModules);
      logger.debug('[ModuleSelector] Loaded modules:', allModules);
      return allModules;
    } catch (error) {
      logger.error('[ModuleSelector] Error fetching modules:', error);
      return [];
    } finally {
      setIsLoadingModules(false);
    }
  };

  // 通用创建模组方法
  const createModule = async (params: {
    title: string;
    description?: string | null;
    template_id?: string | null;
    recommended_level_min?: number;
    recommended_level_max?: number;
    estimated_sessions?: string | null;
  }) => {
    setIsCreating(true);
    try {
      const response = await authedFetch('/api/custom-modules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      if (response.ok) {
        const data = await response.json();
        await fetchAllModules();
        onModuleChange(data.module_id);
        setShowCreateDialog(false);
      }
    } catch (error) {
      logger.error('Failed to create module:', error);
    } finally {
      setIsCreating(false);
    }
  };

  // 初始加载模组列表
  useEffect(() => {
    if (!userId) {
      logger.debug('[ModuleSelector] Skipping fetch - userId not available');
      return;
    }
    fetchAllModules();
  }, [userId]);

  // 加载模组数据并调用回调
  useEffect(() => {
    if (!userId) {
      logger.debug('[ModuleSelector] Skipping module load - userId not available');
      return;
    }

    if (selectedModule && onModuleLoad) {
      const loadModuleData = async () => {
        try {
          logger.debug('[ModuleSelector] Loading module data:', selectedModule);

          let data;
          let isCustomModule = false;

          // 1. 先尝试从解析模组API获取
          if (!STATIC_ONLY_MODULES.has(selectedModule)) {
            const response = await authedFetch(`/api/modules/parsed/${selectedModule}`);
            if (response.ok) {
              data = await response.json();
            }
          }

          // 2. 如果解析模组没有，尝试从自定义模组API获取
          if (!data) {
            const customResponse = await authedFetch(`/api/custom-modules/${selectedModule}`);
            if (customResponse.ok) {
              data = await customResponse.json();
              isCustomModule = true;
              logger.debug('[ModuleSelector] Loaded custom module:', data);
            }
          }

          // 3. 最后尝试静态文件
          if (!data) {
            logger.debug('[ModuleSelector] Loading from static files');
            try {
              const staticModule = await import(`~/data/modules/${selectedModule}/complete_module_data.json`);
              data = staticModule.default;
            } catch {
              logger.debug('[ModuleSelector] No module data found');
              return;
            }
          }

          // 将数据转换为ModuleData格式
          let moduleData: ModuleData;

          if (isCustomModule) {
            // 自定义模组的数据格式不同
            moduleData = {
              module: {
                id: selectedModule,
                title: data.title || '未命名模组',
                title_en: '',
                description: data.description || '',
                version: '1.0',
                author: '',
                level_range: `${data.recommended_level_min || 1}-${data.recommended_level_max || 20}`,
                player_count: '',
                estimated_time: data.estimated_sessions || ''
              },
              chapters: data.chapters || [],
              npcs: data.npcs || [],
              locations: data.locations || [],
              quests: [],
              factions: [],
              encounters: data.encounters || [],
              items: data.treasures || [],
              maps: [],
              traps: [],
              treasures: data.treasures || [],
              dialogues: []
            };
          } else {
            moduleData = {
              module: data.module || {
                id: selectedModule,
                title: data.title || '未命名模组',
                title_en: data.title_en || '',
                description: data.description || '',
                version: data.version || '1.0',
                author: data.author || '',
                level_range: data.level_range || '',
                player_count: data.player_count || '',
                estimated_time: data.estimated_time || ''
              },
              chapters: data.chapters || [],
              npcs: data.npcs || [],
              locations: data.locations || [],
              quests: data.quests || [],
              factions: data.factions || [],
              encounters: data.encounters || [],
              items: data.items || [],
              maps: data.maps || [],
              npcs_detailed: data.npcs_detailed || null,
              locations_detailed: data.locations_detailed || null,
              traps: data.traps || [],
              treasures: data.treasures || [],
              dialogues: data.dialogues || []
            };
          }

          // 调用回调函数
          onModuleLoad(moduleData);
          logger.debug('[ModuleSelector] Module data loaded:', moduleData);

        } catch (error) {
          logger.error('[ModuleSelector] Failed to load module data:', error);
        }
      };

      loadModuleData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedModule, userId]); // 依赖 selectedModule 和 userId

  return (
    <Card className="module-selector">
      <Flex direction="column" gap="3">
        <Flex justify="between" align="center" className="module-selector-header">
          <Text size="4" weight="bold">选择冒险模组</Text>
          <Button size="1" variant="soft" onClick={() => setShowCreateDialog(true)}>
            <Plus size={14} /> 创建新模组
          </Button>
        </Flex>

        <Flex gap="2" align="center">
          <Box style={{ flex: 1 }}>
            <Select.Root value={selectedModule} onValueChange={onModuleChange}>
              <Select.Trigger placeholder={isLoadingModules ? "加载中..." : "选择一个模组..."} style={{ width: '100%' }} />
              <Select.Content>
                {availableModules.map(module => (
                  <Select.Item key={module.id} value={module.id}>
                    {module.title} {module.title_en ? `(${module.title_en})` : ''}
                    {module.isCustom && ' ✏️'}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </Box>
          {currentModuleInfo?.isCustom && (
            <>
              <Button
                size="1"
                variant="soft"
                onClick={() => {
                  setRenameTitle(currentModuleInfo.title);
                  setShowRenameDialog(true);
                }}
                title="重命名模组"
              >
                <Pencil size={14} />
              </Button>
              <Button
                size="1"
                variant="soft"
                color="red"
                onClick={() => setShowDeleteConfirm(true)}
                title="删除此自定义模组"
              >
                <Trash2 size={14} />
              </Button>
            </>
          )}
        </Flex>
      </Flex>

      {/* 创建模组对话框 - 选择模板直接创建 */}
      <Dialog.Root open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <Dialog.Content style={{ maxWidth: 700 }}>
          <Dialog.Title>选择冒险模板</Dialog.Title>
          <Dialog.Description size="2" mb="4">
            选择一个预设模板，将自动创建对应的冒险模组
          </Dialog.Description>
          <Grid columns="2" gap="3" mb="4">
            {templates.map((template) => (
              <Card
                key={template.id}
                style={{
                  cursor: isCreating ? 'wait' : 'pointer',
                  border: '1px solid var(--gray-6)',
                  transition: 'all 0.15s ease',
                  opacity: isCreating ? 0.6 : 1,
                }}
                onClick={() => !isCreating && handleSelectTemplate(template)}
                onMouseOver={(e) => {
                  if (!isCreating) e.currentTarget.style.borderColor = 'var(--accent-7)';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.borderColor = 'var(--gray-6)';
                }}
              >
                <Flex gap="3" align="start">
                  <Text size="6">{template.icon}</Text>
                  <Box style={{ flex: 1, minWidth: 0 }}>
                    <Text weight="bold" size="2">{template.name}</Text>
                    <Text size="1" color="gray" style={{ display: 'block', marginTop: 2 }}>
                      {template.description}
                    </Text>
                    {template.id !== 'blank' && (
                      <Flex gap="2" mt="2" wrap="wrap">
                        <Badge size="1" color="blue">
                          Lv {template.recommended_level.min}-{template.recommended_level.max}
                        </Badge>
                        <Badge size="1" color="green">
                          {template.estimated_sessions} 场
                        </Badge>
                      </Flex>
                    )}
                  </Box>
                </Flex>
              </Card>
            ))}
          </Grid>
          <Flex gap="3" justify="end">
            <Dialog.Close>
              <Button variant="soft" color="gray">取消</Button>
            </Dialog.Close>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>

      {/* 空白模板 - 输入标题 */}
      <Dialog.Root open={showBlankTitleDialog} onOpenChange={setShowBlankTitleDialog}>
        <Dialog.Content style={{ maxWidth: 400 }}>
          <Dialog.Title>创建空白模组</Dialog.Title>
          <Dialog.Description size="2" mb="4">
            为你的冒险模组起个名字
          </Dialog.Description>
          <TextField.Root
            placeholder="输入模组标题..."
            value={blankTitle}
            onChange={(e) => setBlankTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreateBlank()}
          />
          <Flex gap="3" justify="end" mt="4">
            <Button variant="soft" color="gray" onClick={() => setShowBlankTitleDialog(false)}>
              取消
            </Button>
            <Button onClick={handleCreateBlank} disabled={isCreating || !blankTitle.trim()}>
              {isCreating ? '创建中...' : '创建'}
            </Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>

      {/* 重命名模组对话框 */}
      <Dialog.Root open={showRenameDialog} onOpenChange={setShowRenameDialog}>
        <Dialog.Content style={{ maxWidth: 400 }}>
          <Dialog.Title>重命名模组</Dialog.Title>
          <Dialog.Description size="2" mb="4">
            修改模组名称
          </Dialog.Description>
          <TextField.Root
            placeholder="输入新名称..."
            value={renameTitle}
            onChange={(e) => setRenameTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleRenameModule()}
          />
          <Flex gap="3" justify="end" mt="4">
            <Button variant="soft" color="gray" onClick={() => setShowRenameDialog(false)}>
              取消
            </Button>
            <Button onClick={handleRenameModule} disabled={isRenaming || !renameTitle.trim()}>
              {isRenaming ? '保存中...' : '保存'}
            </Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>

      {/* 删除确认对话框 */}
      <Dialog.Root open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <Dialog.Content style={{ maxWidth: 400 }}>
          <Dialog.Title>确认删除模组</Dialog.Title>
          <Dialog.Description size="2" mb="4">
            确定要删除「{currentModuleInfo?.title}」吗？此操作无法撤销。
          </Dialog.Description>
          <Flex gap="3" justify="end">
            <Dialog.Close>
              <Button variant="soft" color="gray">取消</Button>
            </Dialog.Close>
            <Button color="red" onClick={handleDeleteModule} disabled={isDeleting}>
              {isDeleting ? '删除中...' : '确认删除'}
            </Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
    </Card>
  );
}

// 模组数据面板 - 供DM使用
export function ModuleDataPanel({ moduleData }: { moduleData: ModuleData | null }) {
  const [activeTab, setActiveTab] = useState('npcs');

  if (!moduleData) {
    return (
      <Card>
        <Text color="gray">请先选择一个模组</Text>
      </Card>
    );
  }

  return (
    <Card className="module-data-panel">
      <Flex direction="column" gap="3">
        <Flex gap="2">
          <Badge
            variant={activeTab === 'npcs' ? 'solid' : 'soft'}
            onClick={() => setActiveTab('npcs')}
            style={{ cursor: 'pointer' }}
          >
            NPC ({moduleData.npcs.length})
          </Badge>
          <Badge
            variant={activeTab === 'locations' ? 'solid' : 'soft'}
            onClick={() => setActiveTab('locations')}
            style={{ cursor: 'pointer' }}
          >
            地点 ({moduleData.locations.length})
          </Badge>
          <Badge
            variant={activeTab === 'quests' ? 'solid' : 'soft'}
            onClick={() => setActiveTab('quests')}
            style={{ cursor: 'pointer' }}
          >
            任务 ({moduleData.quests.length})
          </Badge>
          <Badge
            variant={activeTab === 'factions' ? 'solid' : 'soft'}
            onClick={() => setActiveTab('factions')}
            style={{ cursor: 'pointer' }}
          >
            派系 ({moduleData.factions.length})
          </Badge>
        </Flex>

        <ScrollArea style={{ height: '400px' }}>
          {activeTab === 'npcs' && (
            <Flex direction="column" gap="2">
              {moduleData.npcs.map(npc => (
                <NPCCard key={npc.id} npc={npc} />
              ))}
            </Flex>
          )}

          {activeTab === 'locations' && (
            <Flex direction="column" gap="2">
              {moduleData.locations.map(location => (
                <LocationCard key={location.id} location={location} />
              ))}
            </Flex>
          )}

          {activeTab === 'quests' && (
            <Flex direction="column" gap="2">
              {moduleData.quests.map(quest => (
                <QuestCard key={quest.id} quest={quest} />
              ))}
            </Flex>
          )}

          {activeTab === 'factions' && (
            <Flex direction="column" gap="2">
              {moduleData.factions.map(faction => (
                <FactionCard key={faction.id} faction={faction} />
              ))}
            </Flex>
          )}
        </ScrollArea>
      </Flex>
    </Card>
  );
}

// NPC卡片组件
function NPCCard({ npc }: { npc: NPC }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card variant="surface">
      <Flex direction="column" gap="2">
        <Flex justify="between" align="start">
          <Box>
            <Flex align="center" gap="2">
              <Text size="2" weight="bold">{npc.name}</Text>
              <Text size="1" color="gray">({npc.name_en})</Text>
            </Flex>
            <Flex gap="2" mt="1">
              <Badge size="1" variant="soft">{npc.race}</Badge>
              <Badge size="1" variant="soft">{npc.occupation}</Badge>
              {npc.faction && <Badge size="1" variant="outline">{npc.faction}</Badge>}
              {npc.alignment && <Badge size="1" color="purple">{npc.alignment}</Badge>}
            </Flex>
          </Box>
          <button
            onClick={() => setExpanded(!expanded)}
            style={{ cursor: 'pointer', background: 'none', border: 'none', color: 'inherit' }}
          >
            {expanded ? '▼' : '▶'}
          </button>
        </Flex>

        {expanded && (
          <Box mt="2">
            {npc.description && (
              <Text size="1" color="gray">{npc.description}</Text>
            )}

            {npc.personality_traits && (
              <Box mt="2">
                <Text size="1" weight="bold">性格特征:</Text>
                <Text size="1">{npc.personality_traits}</Text>
              </Box>
            )}

            {npc.hp && npc.ac && (
              <Flex gap="3" mt="2">
                <Badge variant="soft" color="red">HP: {typeof npc.hp === 'object' ? ((npc.hp as any)?.average || (npc.hp as any)?.dice || '') : npc.hp}</Badge>
                <Badge variant="soft" color="blue">AC: {typeof npc.ac === 'object' ? ((npc.ac as any)?.value || (npc.ac as any)?.base || '') : npc.ac}</Badge>
              </Flex>
            )}

            {npc.dialogue_samples && npc.dialogue_samples.length > 0 && (
              <Box mt="2">
                <Text size="1" weight="bold">对话样例:</Text>
                {npc.dialogue_samples.map((dialogue, idx) => (
                  <Text key={idx} size="1" style={{ fontStyle: 'italic', marginTop: '4px' }}>
                    "{dialogue}"
                  </Text>
                ))}
              </Box>
            )}

            {npc.secrets && npc.secrets.length > 0 && (
              <Box mt="2">
                <Text size="1" weight="bold" color="amber">秘密:</Text>
                {npc.secrets.map((secret, idx) => (
                  <Text key={idx} size="1" color="amber">• {secret}</Text>
                ))}
              </Box>
            )}

            {npc.relationships && Object.keys(npc.relationships).length > 0 && (
              <Box mt="2">
                <Text size="1" weight="bold">关系:</Text>
                {Object.entries(npc.relationships).map(([person, relation]) => (
                  <Text key={person} size="1">• {person}: {relation}</Text>
                ))}
              </Box>
            )}
          </Box>
        )}
      </Flex>
    </Card>
  );
}

// 地点卡片组件
function LocationCard({ location }: { location: Location }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card variant="surface">
      <Flex direction="column" gap="2">
        <Flex justify="between" align="start">
          <Box>
            <Flex align="center" gap="2">
              <Text size="2" weight="bold">{location.name}</Text>
              <Text size="1" color="gray">({location.name_en})</Text>
            </Flex>
            <Badge size="1" variant="soft" mt="1">{location.type}</Badge>
          </Box>
          <button
            onClick={() => setExpanded(!expanded)}
            style={{ cursor: 'pointer', background: 'none', border: 'none', color: 'inherit' }}
          >
            {expanded ? '▼' : '▶'}
          </button>
        </Flex>

        {expanded && (
          <Box mt="2">
            {location.description && (
              <Text size="1" color="gray">{location.description}</Text>
            )}

            {location.atmosphere && (
              <Box mt="2">
                <Text size="1" weight="bold">氛围:</Text>
                <Text size="1">{location.atmosphere}</Text>
              </Box>
            )}

            {(location.lighting || location.sounds || location.smells) && (
              <Box mt="2">
                <Text size="1" weight="bold">环境细节:</Text>
                {location.lighting && <Text size="1">• 光线: {location.lighting}</Text>}
                {location.sounds && <Text size="1">• 声音: {location.sounds}</Text>}
                {location.smells && <Text size="1">• 气味: {location.smells}</Text>}
              </Box>
            )}

            {location.room_features && location.room_features.length > 0 && (
              <Box mt="2">
                <Text size="1" weight="bold">房间特征:</Text>
                {location.room_features.map((feature, idx) => (
                  <Text key={idx} size="1">• {feature}</Text>
                ))}
              </Box>
            )}

            {location.connections && location.connections.length > 0 && (
              <Box mt="2">
                <Text size="1" weight="bold">连接:</Text>
                <Flex gap="1" wrap="wrap">
                  {location.connections.map((conn, idx) => (
                    <Badge key={idx} size="1" variant="outline">{conn}</Badge>
                  ))}
                </Flex>
              </Box>
            )}
          </Box>
        )}
      </Flex>
    </Card>
  );
}

// 任务卡片组件
function QuestCard({ quest }: { quest: any }) {
  return (
    <Card variant="surface">
      <Box>
        <Text size="2" weight="bold">{quest.name}</Text>
        <Badge size="1" variant={quest.type === 'main' ? 'solid' : 'soft'} mt="1">
          {quest.type === 'main' ? '主线' : '支线'}
        </Badge>
        {quest.rewards?.gold && (
          <Text size="1" color="amber" mt="1">奖励: {quest.rewards.gold}</Text>
        )}
      </Box>
    </Card>
  );
}

// 派系卡片组件
function FactionCard({ faction }: { faction: any }) {
  return (
    <Card variant="surface">
      <Box>
        <Text size="2" weight="bold">{faction.name}</Text>
        <Text size="1" color="gray">{faction.name_en}</Text>
        <Text size="1" mt="1">{faction.description}</Text>
      </Box>
    </Card>
  );
}

// 导出默认组件
export default ModuleSelector;
