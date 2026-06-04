import { useState, useEffect, useMemo, useCallback } from "react";
import { Box, Container, Heading, Flex, Button, Text, Card, Grid, Badge, IconButton, DropdownMenu, Avatar, Dialog, Separator } from "@radix-ui/themes";
import { Link, useNavigate } from "react-router";
import { CharacterCreationWizardV2 } from "~/components/character/CharacterCreationWizardV2";
import racesData from "~/data/rules/races.json";
import classesData from "~/data/rules/classes_with_structured_subclass_features.json";
import backgroundsData from "~/data/rules/backgrounds.json";
import equipmentData from "~/data/rules/equipment.json";
import { getCurrentUserId } from "~/utils/user";
import { apiFetch } from "~/utils/api-client";
import { createLogger } from '~/utils/logger';
import { extractSingleValue, extractValues } from "~/utils/levelTrackingHelpers";
import { PlusIcon, TrashIcon, DotsHorizontalIcon, PersonIcon, Cross2Icon, UploadIcon } from "@radix-ui/react-icons";
import { formatAlignment, formatFightingStyle, formatFavoredEnemy, formatFavoredTerrain, formatEldritchInvocation } from "~/components/character/CharacterDisplay/utils/formatting";
import { useCharacterDraft, type CharacterDraftData } from "~/hooks/useCharacterDraft";
import { CharacterImportDialog } from "~/components/character/CharacterImportDialog";

const logger = createLogger('character');

interface TokenLocation {
  campaign_id: number;
  campaign_name: string;
  map_url: string;
  token_id: number;
}

export default function CharacterPage() {
  const navigate = useNavigate();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [myCharacters, setMyCharacters] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedCharacter, setSelectedCharacter] = useState<any | null>(null);
  const [tokenLocations, setTokenLocations] = useState<TokenLocation[]>([]);
  const [loadingLocations, setLoadingLocations] = useState(false);
  const [showAllEquipment, setShowAllEquipment] = useState(false);
  const [expandedCampaigns, setExpandedCampaigns] = useState<Record<number, boolean>>({});
  const userId = getCurrentUserId();

  // Draft system
  const { loadDraft, saveDraft, saveDraftNow, deleteDraft } = useCharacterDraft();
  const [draftData, setDraftData] = useState<CharacterDraftData | null>(null);
  const [showDraftRecovery, setShowDraftRecovery] = useState(false);

  const handleCreateClick = useCallback(async () => {
    const draft = await loadDraft();
    if (draft) {
      setDraftData(draft);
      setShowDraftRecovery(true);
    } else {
      setDraftData(null);
      setShowCreateDialog(true);
    }
  }, [loadDraft]);

  const handleRecoverDraft = () => {
    setShowDraftRecovery(false);
    setShowCreateDialog(true);
  };

  const handleDiscardDraft = async () => {
    await deleteDraft();
    setDraftData(null);
    setShowDraftRecovery(false);
    setShowCreateDialog(true);
  };

  useEffect(() => {
    loadCharacters();
  }, []);

  const loadCharacters = async () => {
    try {
      setLoading(true);
      const response = await apiFetch(`/api/characters`);
      if (response.ok) {
        const data = await response.json();
        setMyCharacters(data);
      }
    } catch (error) {
      logger.error("Failed to load characters:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleCharacterCreated = async (character: any): Promise<boolean> => {
    logger.debug("Character created:", character);

    // Deduplicate spell arrays to prevent duplicates from debug mode or multi-subclass
    const dedupArray = (arr: any) => arr ? Array.from(new Set(arr)) : arr;

    try {
      const response = await apiFetch("/api/characters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          ...character,
          selectedCantrips: dedupArray(character.selectedCantrips),
          selectedSpells: dedupArray(character.selectedSpells),
          preparedSpells: dedupArray(character.preparedSpells),
        }),
      });

      if (response.ok) {
        await loadCharacters();
        setShowCreateDialog(false);
        await deleteDraft();
        setDraftData(null);
        return true;
      } else {
        const errorData = await response.json().catch(() => ({}));
        logger.error("Failed to save character:", errorData);
        alert(errorData.detail || "保存角色失败，请重试");
        return false;
      }
    } catch (error) {
      logger.error("Error saving character:", error);
      alert("网络错误，请检查网络连接后重试");
      return false;
    }
  };

  const handleDeleteCharacter = async (characterId: number) => {
    if (!confirm("确定要删除这个角色吗？此操作不可恢复。")) return;

    try {
      const response = await apiFetch(`/api/characters/${characterId}`, {
        method: "DELETE",
      });

      if (response.ok) {
        await loadCharacters();
      } else {
        alert("删除失败");
      }
    } catch (error) {
      logger.error("Error deleting character:", error);
      alert("删除角色时发生错误");
    }
  };

  const handleCardClick = async (char: any) => {
    setSelectedCharacter(char); // 先显示基础数据
    setTokenLocations([]);
    setLoadingLocations(true);
    setShowAllEquipment(false); // 重置装备展开状态

    // 🚀 并行请求：角色详情 和 token 位置
    const [charResult, locationsResult] = await Promise.allSettled([
      apiFetch(`/api/characters/${char.id}`).then(res => res.ok ? res.json() : null),
      apiFetch(`/api/characters/${char.id}/token-locations`).then(res => res.ok ? res.json() : null)
    ]);

    // 处理角色详情结果
    if (charResult.status === 'fulfilled' && charResult.value) {
      setSelectedCharacter(charResult.value);
    } else if (charResult.status === 'rejected') {
      logger.error("Failed to load character details:", charResult.reason);
    }

    // 处理 token 位置结果
    if (locationsResult.status === 'fulfilled' && locationsResult.value) {
      setTokenLocations(locationsResult.value.locations || []);
    } else if (locationsResult.status === 'rejected') {
      logger.error("Failed to load token locations:", locationsResult.reason);
    }

    setLoadingLocations(false);
  };

  const getAbilityModifier = (score: number) => {
    const mod = Math.floor((score - 10) / 2);
    return mod >= 0 ? `+${mod}` : `${mod}`;
  };

  const abilityNames: Record<string, string> = {
    strength: "力量",
    dexterity: "敏捷",
    constitution: "体质",
    intelligence: "智力",
    wisdom: "感知",
    charisma: "魅力"
  };

  const skillNames: Record<string, string> = {
    acrobatics: "特技",
    animal_handling: "驯兽",
    arcana: "奥秘",
    athletics: "运动",
    deception: "欺瞒",
    history: "历史",
    insight: "洞悉",
    intimidation: "威吓",
    investigation: "调查",
    medicine: "医药",
    nature: "自然",
    perception: "察觉",
    performance: "表演",
    persuasion: "游说",
    religion: "宗教",
    sleight_of_hand: "巧手",
    stealth: "隐匿",
    survival: "求生"
  };

  const alignmentNames: Record<string, string> = {
    "lawful-good": "守序善良",
    "neutral-good": "中立善良",
    "chaotic-good": "混乱善良",
    "lawful-neutral": "守序中立",
    "true-neutral": "绝对中立",
    "chaotic-neutral": "混乱中立",
    "lawful-evil": "守序邪恶",
    "neutral-evil": "中立邪恶",
    "chaotic-evil": "混乱邪恶"
  };

  const races = (racesData as any).races;
  const classes = (classesData as any).classes;
  const backgrounds = (backgroundsData as any).backgrounds;

  // 构建装备查找表（遍历所有嵌套分类）- 使用 useMemo 只构建一次
  const equipmentMap = useMemo(() => {
    const map: Record<string, string> = {};
    const data = equipmentData as any;

    const addItems = (items: any[]) => {
      if (!Array.isArray(items)) return;
      items.forEach(item => {
        if (item.id && item.name) {
          map[item.id] = item.name;
        }
      });
    };

    // armor: light, medium, heavy, shield
    if (data.armor) {
      Object.values(data.armor).forEach((cat: any) => addItems(cat));
    }
    // weapons: simple.melee, simple.ranged, martial.melee, martial.ranged
    if (data.weapons) {
      ['simple', 'martial'].forEach(key => {
        if (data.weapons[key]) {
          Object.values(data.weapons[key]).forEach((cat: any) => addItems(cat));
        }
      });
    }
    // adventuringGear: multiple nested categories
    if (data.adventuringGear) {
      Object.values(data.adventuringGear).forEach((cat: any) => {
        if (Array.isArray(cat)) {
          addItems(cat);
        } else if (typeof cat === 'object') {
          // Handle nested objects like containers.items
          Object.values(cat).forEach((subcat: any) => {
            if (Array.isArray(subcat)) addItems(subcat);
          });
        }
      });
    }
    // packs
    if (data.packs) addItems(data.packs);
    // tools: multiple categories
    if (data.tools) {
      Object.values(data.tools).forEach((cat: any) => addItems(cat));
    }
    // backgroundItems
    if (data.backgroundItems) addItems(data.backgroundItems);

    return map;
  }, []);

  const getEquipmentName = (itemId: string) => {
    return equipmentMap[itemId] || itemId;
  };

  return (
    <Box className="min-h-screen bg-gray-900 text-gray-100 relative" style={{ paddingTop: 'var(--sat, 0px)' }}>
       {/* Background Image with Overlay */}
       <div
        className="fixed inset-0 z-0"
        style={{
          backgroundImage: "url('/images/ui/character-bg.jpg')",
          backgroundSize: "cover",
          backgroundPosition: "center",
          opacity: 0.2
        }}
      />
      
      {/* 顶部导航 */}
      <Box className="sticky z-50 border-b border-white/10 bg-gray-900/80 backdrop-blur-md shadow-sm" style={{ top: 'var(--sat, 0px)' }}>
        <Container size="4" className="px-4 sm:px-6 md:px-8">
          <Flex justify="between" align="center" height="64px">
            <Link to="/" style={{ textDecoration: "none" }}>
              <Heading size="5" className="font-fantasy text-amber-50 tracking-wider hover:text-amber-400 transition-colors">
                DND 5E
              </Heading>
            </Link>
            <Flex gap="3">
              <Button variant="ghost" color="gray" onClick={() => navigate('/')}>
                返回大厅
              </Button>
            </Flex>
          </Flex>
        </Container>
      </Box>

      {/* 主内容 */}
      <Box className="relative z-10 py-8 px-4 sm:px-6 md:px-8">
        <Container size="4">
          <Flex justify="between" align="end" mb="6" className="border-b border-white/10 pb-4">
            <Box>
              <Heading size="8" className="font-fantasy text-amber-500 mb-2">
                我的角色
              </Heading>
              <Text color="gray" size="3">
                管理你的冒险者，或者创造一个新的传奇。
              </Text>
            </Box>
            <Flex gap="2">
              <Button size="3" variant="soft" color="gray" onClick={() => setShowImportDialog(true)}>
                <UploadIcon /> 导入角色卡
              </Button>
              <Button size="3" variant="solid" color="amber" onClick={handleCreateClick}>
                <PlusIcon /> 创建新角色
              </Button>
            </Flex>
          </Flex>

          {loading ? (
             <Grid columns={{ initial: "1", sm: "2", md: "3" }} gap="4">
               {[1,2,3].map(i => (
                 <Card key={i} className="h-64 animate-pulse bg-gray-800/50" />
               ))}
             </Grid>
          ) : myCharacters.length === 0 ? (
            <Flex direction="column" align="center" justify="center" className="py-20 border border-dashed border-gray-700 rounded-xl bg-gray-800/30 backdrop-blur-sm">
              <Box className="w-20 h-20 rounded-full bg-gray-800 flex items-center justify-center mb-6 text-amber-600">
                <PersonIcon width="40" height="40" />
              </Box>
              <Heading size="5" color="gray" mb="2">暂无角色</Heading>
              <Text color="gray" className="mb-8 text-center max-w-sm">
                你还没有创建任何角色。开始你的旅程，创建一个独特的冒险者吧！
              </Text>
              <Button size="4" onClick={() => setShowCreateDialog(true)} variant="soft" color="amber">
                创建第一个角色
              </Button>
            </Flex>
          ) : (
            <Grid columns={{ initial: "1", sm: "2", lg: "3" }} gap="6">
              {/* Create Card */}
              <Card 
                className="group flex flex-col items-center justify-center min-h-[280px] cursor-pointer border-dashed border-2 border-gray-700 hover:border-amber-500/50 hover:bg-gray-800/50 transition-all"
                onClick={handleCreateClick}
              >
                <Box className="p-4 rounded-full bg-gray-800 group-hover:bg-amber-900/30 group-hover:text-amber-500 transition-colors mb-4">
                  <PlusIcon width="32" height="32" className="text-gray-500 group-hover:text-amber-500" />
                </Box>
                <Text weight="bold" size="3" className="text-gray-400 group-hover:text-amber-400">创建新角色</Text>
              </Card>

              {myCharacters.map((char) => {
                const race = races.find((r: any) => r.id === char.race_id);
                const charClass = classes.find((c: any) => c.id === char.class_id);
                
                // Deterministic color based on class or ID
                const classColors: Record<string, "red" | "orange" | "amber" | "yellow" | "lime" | "green" | "teal" | "cyan" | "blue" | "indigo" | "violet" | "purple" | "plum" | "pink" | "crimson" | "gray"> = {
                    'barbarian': 'red',
                    'bard': 'pink',
                    'cleric': 'gold' as any, // radix doesn't have gold, map to amber/yellow
                    'druid': 'green',
                    'fighter': 'crimson',
                    'monk': 'cyan',
                    'paladin': 'yellow',
                    'ranger': 'teal',
                    'rogue': 'gray',
                    'sorcerer': 'orange',
                    'warlock': 'purple',
                    'wizard': 'blue'
                };
                // Fallback logic
                const themeColor = classColors[char.class_id] || "amber";

                return (
                  <Card key={char.id} className="group relative overflow-hidden border-gray-700 bg-gray-800/80 backdrop-blur-sm hover:shadow-xl hover:shadow-amber-900/10 hover:-translate-y-1 transition-all duration-300 cursor-pointer" onClick={() => handleCardClick(char)}>
                    <div className={`absolute top-0 left-0 w-full h-1 bg-${themeColor}-500 opacity-70`} />
                    
                    <Flex justify="between" align="start" mb="4">
                      <Flex gap="3" align="center">
                         <Avatar
                           src={char.avatar || undefined}
                           fallback={char.name[0]?.toUpperCase()}
                           size="4"
                           radius="full"
                           color={themeColor as any}
                           variant="soft"
                         />
                         <Box>
                           <Heading size="4" className="font-fantasy truncate max-w-[150px]" title={char.name}>
                             {char.name}
                           </Heading>
                           <Text size="1" color="gray">
                             {race?.name || char.race_id} · {charClass?.name || char.class_id}
                           </Text>
                         </Box>
                      </Flex>
                      
                      <DropdownMenu.Root>
                        <DropdownMenu.Trigger>
                          <IconButton variant="ghost" color="gray" size="1" onClick={(e) => e.stopPropagation()}>
                            <DotsHorizontalIcon />
                          </IconButton>
                        </DropdownMenu.Trigger>
                        <DropdownMenu.Content>
                          <DropdownMenu.Item color="red" onClick={(e) => { e.stopPropagation(); handleDeleteCharacter(char.id); }}>
                            <TrashIcon /> 删除角色
                          </DropdownMenu.Item>
                        </DropdownMenu.Content>
                      </DropdownMenu.Root>
                    </Flex>

                    <Flex direction="column" gap="3">
                       <Flex justify="between" className="bg-gray-900/50 p-2 rounded border border-gray-700/50">
                          <Box className="text-center flex-1 border-r border-gray-700">
                             <Text size="1" color="gray" className="uppercase text-[10px]">等级</Text>
                             <Text size="5" weight="bold" className="block leading-none mt-1">{char.level}</Text>
                          </Box>
                          <Box className="text-center flex-1 border-r border-gray-700">
                             <Text size="1" color="gray" className="uppercase text-[10px]">HP</Text>
                             <Text size="5" weight="bold" className="block leading-none mt-1 text-green-500">{char.hp || 10}</Text>
                          </Box>
                          <Box className="text-center flex-1">
                             <Text size="1" color="gray" className="uppercase text-[10px]">AC</Text>
                             <Text size="5" weight="bold" className="block leading-none mt-1 text-blue-400">{char.ac || 10}</Text>
                          </Box>
                       </Flex>

                       {char.backstory && (
                        <Text size="1" color="gray" className="line-clamp-2 italic">
                          "{char.backstory}"
                        </Text>
                       )}

                       {/* 属性值 */}
                       {char.ability_scores && (
                         <Grid columns="6" gap="1" className="bg-gray-900/50 p-2 rounded border border-gray-700/50">
                           {(['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'] as const).map((key) => {
                             const value = char.ability_scores[key] || 10;
                             const mod = Math.floor((value - 10) / 2);
                             const modStr = mod >= 0 ? `+${mod}` : `${mod}`;
                             const shortNames: Record<string, string> = {
                               strength: '力',
                               dexterity: '敏',
                               constitution: '体',
                               intelligence: '智',
                               wisdom: '感',
                               charisma: '魅'
                             };
                             return (
                               <Box key={key} className="text-center">
                                 <Text size="1" color="gray" className="text-[9px] block">{shortNames[key]}</Text>
                                 <Text size="2" weight="bold" className="block leading-tight">{value}</Text>
                                 <Text size="1" className="text-amber-500 text-[10px]">{modStr}</Text>
                               </Box>
                             );
                           })}
                         </Grid>
                       )}

                       {/* 地图位置 */}
                       {char.token_locations && char.token_locations.length > 0 && (
                         <Box className="bg-gray-900/50 p-2 rounded border border-gray-700/50">
                           <Text size="1" color="gray" className="block mb-1">所在战役</Text>
                           <Flex wrap="wrap" gap="1">
                             {(expandedCampaigns[char.id] ? char.token_locations : char.token_locations.slice(0, 2)).map((loc: any, i: number) => (
                               <Badge
                                 key={i}
                                 size="1"
                                 variant="surface"
                                 color="amber"
                                 className="cursor-pointer hover:bg-amber-900/50 transition-colors"
                                 onClick={(e) => {
                                   e.stopPropagation();
                                   navigate(`/campaign/${loc.campaign_id}/player`);
                                 }}
                               >
                                 {loc.campaign_name}
                               </Badge>
                             ))}
                             {char.token_locations.length > 2 && !expandedCampaigns[char.id] && (
                               <Badge
                                 size="1"
                                 variant="soft"
                                 color="gray"
                                 className="cursor-pointer hover:bg-gray-700 transition-colors"
                                 onClick={(e) => {
                                   e.stopPropagation();
                                   setExpandedCampaigns(prev => ({ ...prev, [char.id]: true }));
                                 }}
                               >
                                 +{char.token_locations.length - 2}
                               </Badge>
                             )}
                             {char.token_locations.length > 2 && expandedCampaigns[char.id] && (
                               <Badge
                                 size="1"
                                 variant="soft"
                                 color="gray"
                                 className="cursor-pointer hover:bg-gray-700 transition-colors"
                                 onClick={(e) => {
                                   e.stopPropagation();
                                   setExpandedCampaigns(prev => ({ ...prev, [char.id]: false }));
                                 }}
                               >
                                 收起
                               </Badge>
                             )}
                           </Flex>
                         </Box>
                       )}

                       <Button
                         variant="soft"
                         color="amber"
                         size="2"
                         className="w-full"
                         onClick={(e) => { e.stopPropagation(); handleCardClick(char); }}
                       >
                         查看详情
                       </Button>
                    </Flex>
                  </Card>
                );
              })}
            </Grid>
          )}
        </Container>
      </Box>

      {/* 创建角色对话框 */}
      <CharacterCreationWizardV2
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onCharacterCreated={handleCharacterCreated}
        initialDraft={draftData}
        onDraftChange={saveDraft}
        onDraftStepChange={saveDraftNow}
      />

      {/* 导入角色卡对话框 */}
      <CharacterImportDialog
        open={showImportDialog}
        onOpenChange={setShowImportDialog}
        onCharacterCreated={handleCharacterCreated}
      />

      {/* 草稿恢复对话框 */}
      <Dialog.Root open={showDraftRecovery} onOpenChange={setShowDraftRecovery}>
        <Dialog.Content aria-describedby={undefined} className="bg-gray-900 border border-gray-700 max-w-md">
          <Dialog.Title className="text-lg font-bold text-amber-400">发现未完成的角色</Dialog.Title>
          <Text as="p" size="2" color="gray" className="mt-2">
            你有一个未完成的角色创建草稿（步骤 {draftData?.current_step}/7）。是否要继续编辑？
          </Text>
          <Flex gap="3" mt="4" justify="end">
            <Button variant="soft" color="gray" onClick={handleDiscardDraft}>
              重新开始
            </Button>
            <Button variant="solid" color="amber" onClick={handleRecoverDraft}>
              继续编辑
            </Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>

      {/* 角色详情模态框 */}
      <Dialog.Root open={!!selectedCharacter} onOpenChange={(open) => !open && setSelectedCharacter(null)}>
        <Dialog.Content aria-describedby={undefined} className="bg-gray-900 border border-gray-700 max-w-[900px] max-h-[85dvh] overflow-y-auto">
          <Dialog.Title className="sr-only">{selectedCharacter?.name || '角色'} 详情</Dialog.Title>
          {selectedCharacter && (() => {
            const race = races.find((r: any) => r.id === selectedCharacter.race_id);
            const subrace = race?.subraces?.find((s: any) => s.id === selectedCharacter.subrace_id);
            const charClass = classes.find((c: any) => c.id === selectedCharacter.class_id);
            const subclass = charClass?.subclasses?.find((s: any) => s.id === selectedCharacter.subclass_id);
            const background = backgrounds?.find((b: any) => b.id === selectedCharacter.background_id);
            const selectedSkills = extractValues<string>(selectedCharacter.selected_skills || selectedCharacter.selectedSkills);
            const expertiseSkills = extractValues<string>(selectedCharacter.expertise_skills || selectedCharacter.expertiseSkills);

            return (
              <Box className="space-y-6">
                {/* 头部信息 */}
                <Flex justify="between" align="start">
                  <Flex gap="4" align="center">
                    <Avatar
                      src={selectedCharacter.avatar || undefined}
                      fallback={selectedCharacter.name[0]?.toUpperCase()}
                      size="7"
                      radius="full"
                      className="border-2 border-amber-500/50"
                    />
                    <Box>
                      <Heading size="6" className="font-fantasy text-amber-400">{selectedCharacter.name}</Heading>
                      <Text size="2" color="gray" className="block">
                        {race?.name || selectedCharacter.race_id}
                        {subrace && ` (${subrace.name})`}
                        {' · '}
                        {charClass?.name || selectedCharacter.class_id}
                        {subclass && ` - ${subclass.name}`}
                        {' · '}{selectedCharacter.level}级
                      </Text>
                      {background && (
                        <Text size="1" color="gray">背景: {background.name}</Text>
                      )}
                    </Box>
                  </Flex>
                  <Dialog.Close>
                    <IconButton variant="ghost" color="gray" size="2">
                      <Cross2Icon width="18" height="18" />
                    </IconButton>
                  </Dialog.Close>
                </Flex>

                <Separator size="4" />

                {/* 两栏布局 */}
                <Grid columns="2" gap="6">
                  {/* 左栏 */}
                  <Box className="space-y-5">
                    {/* 基础属性 */}
                    <Box>
                      <Text size="2" weight="bold" className="text-amber-500 uppercase mb-3 block flex items-center gap-2">
                        <span className="w-1 h-4 bg-amber-500 rounded"></span>
                        属性值
                      </Text>
                      <Grid columns="3" gap="2">
                        {selectedCharacter.ability_scores && Object.entries(selectedCharacter.ability_scores).map(([key, value]) => (
                          <Box key={key} className="text-center p-3 bg-gradient-to-b from-gray-800/80 to-gray-800/40 rounded-lg border border-gray-700/50">
                            <Text size="1" className="text-gray-400 uppercase block">{abilityNames[key] || key}</Text>
                            <Text size="5" weight="bold" className="block my-1">{value as number}</Text>
                            <Badge size="1" color="amber" variant="soft">{getAbilityModifier(value as number)}</Badge>
                          </Box>
                        ))}
                      </Grid>
                    </Box>

                    {/* 技能熟练 */}
                    {selectedSkills.length > 0 && (
                      <Box>
                        <Text size="2" weight="bold" className="text-amber-500 uppercase mb-3 block flex items-center gap-2">
                          <span className="w-1 h-4 bg-amber-500 rounded"></span>
                          技能熟练
                        </Text>
                        <Flex wrap="wrap" gap="2">
                          {selectedSkills.map((skill, index) => (
                            <Badge key={`${skill}-${index}`} size="2" variant="surface" color="gray" className="px-3 py-1">
                              {skillNames[skill] || skill}
                            </Badge>
                          ))}
                        </Flex>
                        {expertiseSkills.length > 0 && (
                          <Box mt="2">
                            <Text size="1" color="gray" className="block mb-1">专精:</Text>
                            <Flex wrap="wrap" gap="2">
                              {expertiseSkills.map((skill, index) => (
                                <Badge key={`${skill}-${index}`} size="2" variant="solid" color="amber" className="px-3 py-1">
                                  {skillNames[skill] || skill}
                                </Badge>
                              ))}
                            </Flex>
                          </Box>
                        )}
                      </Box>
                    )}

                    {/* 外貌 */}
                    {selectedCharacter.appearance && Object.values(selectedCharacter.appearance).some(v => v) && (
                      <Box>
                        <Text size="2" weight="bold" className="text-amber-500 uppercase mb-3 block flex items-center gap-2">
                          <span className="w-1 h-4 bg-amber-500 rounded"></span>
                          外貌
                        </Text>
                        <Grid columns="2" gap="2">
                          {selectedCharacter.age && (
                            <Box className="p-2 bg-gray-800/50 rounded border-l-2 border-gray-600">
                              <Text size="1" color="gray">年龄</Text>
                              <Text size="2" className="block">{selectedCharacter.age}岁</Text>
                            </Box>
                          )}
                          {selectedCharacter.gender && (
                            <Box className="p-2 bg-gray-800/50 rounded border-l-2 border-gray-600">
                              <Text size="1" color="gray">性别</Text>
                              <Text size="2" className="block">{selectedCharacter.gender}</Text>
                            </Box>
                          )}
                          {selectedCharacter.appearance.height && (
                            <Box className="p-2 bg-gray-800/50 rounded border-l-2 border-gray-600">
                              <Text size="1" color="gray">身高</Text>
                              <Text size="2" className="block">{selectedCharacter.appearance.height}</Text>
                            </Box>
                          )}
                          {selectedCharacter.appearance.weight && (
                            <Box className="p-2 bg-gray-800/50 rounded border-l-2 border-gray-600">
                              <Text size="1" color="gray">体重</Text>
                              <Text size="2" className="block">{selectedCharacter.appearance.weight}</Text>
                            </Box>
                          )}
                          {selectedCharacter.appearance.eyes && (
                            <Box className="p-2 bg-gray-800/50 rounded border-l-2 border-gray-600">
                              <Text size="1" color="gray">眼睛</Text>
                              <Text size="2" className="block">{selectedCharacter.appearance.eyes}</Text>
                            </Box>
                          )}
                          {selectedCharacter.appearance.hair && (
                            <Box className="p-2 bg-gray-800/50 rounded border-l-2 border-gray-600">
                              <Text size="1" color="gray">头发</Text>
                              <Text size="2" className="block">{selectedCharacter.appearance.hair}</Text>
                            </Box>
                          )}
                          {selectedCharacter.appearance.skin && (
                            <Box className="p-2 bg-gray-800/50 rounded border-l-2 border-gray-600">
                              <Text size="1" color="gray">肤色</Text>
                              <Text size="2" className="block">{selectedCharacter.appearance.skin}</Text>
                            </Box>
                          )}
                          {selectedCharacter.alignment && (
                            <Box className="p-2 bg-gray-800/50 rounded border-l-2 border-gray-600">
                              <Text size="1" color="gray">阵营</Text>
                              <Text size="2" className="block">{formatAlignment(selectedCharacter.alignment)}</Text>
                            </Box>
                          )}
                        </Grid>
                        {selectedCharacter.appearance.distinguishingMarks && (
                          <Box className="mt-2 p-2 bg-gray-800/50 rounded border-l-2 border-gray-600">
                            <Text size="1" color="gray">特征</Text>
                            <Text size="2" className="block">{selectedCharacter.appearance.distinguishingMarks}</Text>
                          </Box>
                        )}
                      </Box>
                    )}

                    {/* 职业特性 */}
                    {(() => {
                      const fightingStyle = extractSingleValue<string>(selectedCharacter.fighting_style);
                      const favoredEnemy = extractSingleValue<string>(selectedCharacter.favored_enemy);
                      const favoredTerrain = extractSingleValue<string>(selectedCharacter.favored_terrain);
                      const invocations = extractValues<string>(selectedCharacter.eldritch_invocations);

                      if (!fightingStyle && !favoredEnemy && !favoredTerrain && invocations.length === 0) return null;

                      return (
                        <Box>
                          <Text size="2" weight="bold" className="text-amber-500 uppercase mb-3 block flex items-center gap-2">
                            <span className="w-1 h-4 bg-amber-500 rounded"></span>
                            职业特性
                          </Text>
                          <Box className="space-y-2">
                            {fightingStyle && (
                              <Box className="p-2 bg-gray-800/50 rounded border-l-2 border-red-600">
                                <Text size="1" color="gray">战斗风格</Text>
                                <Text size="2" className="block">{formatFightingStyle(fightingStyle)}</Text>
                              </Box>
                            )}
                            {favoredEnemy && (
                              <Box className="p-2 bg-gray-800/50 rounded border-l-2 border-green-600">
                                <Text size="1" color="gray">宿敌</Text>
                                <Text size="2" className="block">{formatFavoredEnemy(favoredEnemy)}</Text>
                              </Box>
                            )}
                            {favoredTerrain && (
                              <Box className="p-2 bg-gray-800/50 rounded border-l-2 border-green-600">
                                <Text size="1" color="gray">擅长地形</Text>
                                <Text size="2" className="block">{formatFavoredTerrain(favoredTerrain)}</Text>
                              </Box>
                            )}
                            {invocations.length > 0 && (
                              <Box className="p-2 bg-gray-800/50 rounded border-l-2 border-purple-600">
                                <Text size="1" color="gray">魔能祈唤</Text>
                                <Flex wrap="wrap" gap="1" mt="1">
                                  {invocations.map((inv: string) => (
                                    <Badge key={inv} size="1" color="purple" variant="soft">{formatEldritchInvocation(inv)}</Badge>
                                  ))}
                                </Flex>
                              </Box>
                            )}
                          </Box>
                        </Box>
                      );
                    })()}
                  </Box>

                  {/* 右栏 */}
                  <Box className="space-y-5">
                    {/* 战斗数据 */}
                    <Box>
                      <Text size="2" weight="bold" className="text-amber-500 uppercase mb-3 block flex items-center gap-2">
                        <span className="w-1 h-4 bg-amber-500 rounded"></span>
                        战斗数据
                      </Text>
                      <Grid columns="3" gap="2">
                        <Box className="text-center p-3 bg-gradient-to-b from-green-900/30 to-gray-800/40 rounded-lg border border-green-700/30">
                          <Text size="1" className="text-gray-400 block">HP</Text>
                          <Text size="5" weight="bold" className="text-green-400">{selectedCharacter.current_hp || '满'}</Text>
                        </Box>
                        <Box className="text-center p-3 bg-gradient-to-b from-blue-900/30 to-gray-800/40 rounded-lg border border-blue-700/30">
                          <Text size="1" className="text-gray-400 block">经验</Text>
                          <Text size="4" weight="bold" className="text-blue-400">{selectedCharacter.experience_points || 0}</Text>
                        </Box>
                        <Box className="text-center p-3 bg-gradient-to-b from-amber-900/30 to-gray-800/40 rounded-lg border border-amber-700/30">
                          <Text size="1" className="text-gray-400 block">等级</Text>
                          <Text size="5" weight="bold" className="text-amber-400">{selectedCharacter.level}</Text>
                        </Box>
                      </Grid>
                    </Box>

                    {/* 性格 */}
                    {selectedCharacter.personality && (
                      <Box>
                        <Text size="2" weight="bold" className="text-amber-500 uppercase mb-3 block flex items-center gap-2">
                          <span className="w-1 h-4 bg-amber-500 rounded"></span>
                          性格特质
                        </Text>
                        <Box className="space-y-2">
                          {selectedCharacter.personality.traits?.length > 0 && (
                            <Box className="p-3 bg-gray-800/50 rounded-lg border-l-2 border-cyan-500">
                              <Text size="1" className="text-cyan-400 font-medium">特点</Text>
                              <Text size="2" className="block mt-1 italic text-gray-300">{selectedCharacter.personality.traits.join('; ')}</Text>
                            </Box>
                          )}
                          {selectedCharacter.personality.ideals && (
                            <Box className="p-3 bg-gray-800/50 rounded-lg border-l-2 border-yellow-500">
                              <Text size="1" className="text-yellow-400 font-medium">理想</Text>
                              <Text size="2" className="block mt-1 italic text-gray-300">{selectedCharacter.personality.ideals}</Text>
                            </Box>
                          )}
                          {selectedCharacter.personality.bonds && (
                            <Box className="p-3 bg-gray-800/50 rounded-lg border-l-2 border-pink-500">
                              <Text size="1" className="text-pink-400 font-medium">羁绊</Text>
                              <Text size="2" className="block mt-1 italic text-gray-300">{selectedCharacter.personality.bonds}</Text>
                            </Box>
                          )}
                          {selectedCharacter.personality.flaws && (
                            <Box className="p-3 bg-gray-800/50 rounded-lg border-l-2 border-red-500">
                              <Text size="1" className="text-red-400 font-medium">缺点</Text>
                              <Text size="2" className="block mt-1 italic text-gray-300">{selectedCharacter.personality.flaws}</Text>
                            </Box>
                          )}
                        </Box>
                      </Box>
                    )}

                    {/* 法术 */}
                    {(selectedCharacter.selected_cantrips?.length > 0 || selectedCharacter.selected_spells?.length > 0) && (
                      <Box>
                        <Text size="2" weight="bold" className="text-amber-500 uppercase mb-3 block flex items-center gap-2">
                          <span className="w-1 h-4 bg-amber-500 rounded"></span>
                          法术
                        </Text>
                        {selectedCharacter.selected_cantrips?.length > 0 && (
                          <Box mb="2">
                            <Text size="1" color="gray" className="block mb-1">戏法 ({selectedCharacter.selected_cantrips.length})</Text>
                            <Flex wrap="wrap" gap="1">
                              {selectedCharacter.selected_cantrips.map((spell: any, i: number) => (
                                <Badge key={i} size="1" color="cyan" variant="soft">
                                  {typeof spell === 'string' ? spell : spell.id}
                                </Badge>
                              ))}
                            </Flex>
                          </Box>
                        )}
                        {selectedCharacter.selected_spells?.length > 0 && (
                          <Box>
                            <Text size="1" color="gray" className="block mb-1">已知法术 ({selectedCharacter.selected_spells.length})</Text>
                            <Flex wrap="wrap" gap="1">
                              {selectedCharacter.selected_spells.map((spell: any, i: number) => (
                                <Badge key={i} size="1" color="violet" variant="soft">
                                  {typeof spell === 'string' ? spell : spell.id}
                                </Badge>
                              ))}
                            </Flex>
                          </Box>
                        )}
                      </Box>
                    )}

                    {/* 货币 */}
                    {selectedCharacter.currency && (
                      <Box>
                        <Text size="2" weight="bold" className="text-amber-500 uppercase mb-3 block flex items-center gap-2">
                          <span className="w-1 h-4 bg-amber-500 rounded"></span>
                          货币
                        </Text>
                        <Flex gap="3" wrap="wrap">
                          {selectedCharacter.currency.pp > 0 && <Badge size="2" color="gray" variant="surface">铂金 {selectedCharacter.currency.pp}</Badge>}
                          {selectedCharacter.currency.gp > 0 && <Badge size="2" color="amber" variant="surface">金币 {selectedCharacter.currency.gp}</Badge>}
                          {selectedCharacter.currency.ep > 0 && <Badge size="2" color="blue" variant="surface">银币 {selectedCharacter.currency.ep}</Badge>}
                          {selectedCharacter.currency.sp > 0 && <Badge size="2" color="gray" variant="surface">银币 {selectedCharacter.currency.sp}</Badge>}
                          {selectedCharacter.currency.cp > 0 && <Badge size="2" color="orange" variant="surface">铜币 {selectedCharacter.currency.cp}</Badge>}
                          {Object.values(selectedCharacter.currency).every(v => !v || v === 0) && (
                            <Text size="2" color="gray" className="italic">身无分文</Text>
                          )}
                        </Flex>
                      </Box>
                    )}

                    {/* 装备 */}
                    {selectedCharacter.equipment?.length > 0 && (
                      <Box>
                        <Text size="2" weight="bold" className="text-amber-500 uppercase mb-3 block flex items-center gap-2">
                          <span className="w-1 h-4 bg-amber-500 rounded"></span>
                          装备 ({selectedCharacter.equipment.length})
                        </Text>
                        <Flex wrap="wrap" gap="1">
                          {(showAllEquipment ? selectedCharacter.equipment : selectedCharacter.equipment.slice(0, 12)).map((item: any, i: number) => {
                            const itemId = typeof item === 'string' ? item : item.id;
                            const itemName = getEquipmentName(itemId);
                            const quantity = item.quantity || 1;
                            return (
                              <Badge key={i} size="1" variant="outline" color="gray">
                                {itemName}{quantity > 1 && ` x${quantity}`}
                              </Badge>
                            );
                          })}
                        </Flex>
                        {selectedCharacter.equipment.length > 12 && (
                          <Button
                            size="1"
                            variant="ghost"
                            color="gray"
                            mt="2"
                            onClick={() => setShowAllEquipment(!showAllEquipment)}
                          >
                            {showAllEquipment ? '收起' : `展开全部 (+${selectedCharacter.equipment.length - 12})`}
                          </Button>
                        )}
                      </Box>
                    )}

                    {/* 地图位置 */}
                    <Box>
                      <Text size="2" weight="bold" className="text-amber-500 uppercase mb-3 block flex items-center gap-2">
                        <span className="w-1 h-4 bg-amber-500 rounded"></span>
                        地图位置
                      </Text>
                      {loadingLocations ? (
                        <Text size="2" color="gray">加载中...</Text>
                      ) : tokenLocations.length > 0 ? (
                        <Box className="space-y-2">
                          {tokenLocations.map((loc) => (
                            <Link
                              key={loc.token_id}
                              to={`/campaign/${loc.campaign_id}/player`}
                              className="flex items-center gap-3 p-2 bg-gray-800/50 rounded-lg hover:bg-gray-700/50 transition-colors no-underline border border-gray-700/50"
                              onClick={() => setSelectedCharacter(null)}
                            >
                              <Box className="w-8 h-8 rounded bg-amber-900/50 flex items-center justify-center">
                                <PersonIcon className="text-amber-400" />
                              </Box>
                              <Box>
                                <Text size="2" className="text-amber-400 font-medium block">{loc.campaign_name}</Text>
                                <Text size="1" color="gray" className="truncate block">{decodeURIComponent(loc.map_url.split('/').pop() || '')}</Text>
                              </Box>
                            </Link>
                          ))}
                        </Box>
                      ) : (
                        <Text size="2" color="gray" className="italic">未放置在任何地图上</Text>
                      )}
                    </Box>
                  </Box>
                </Grid>

                {/* 背景故事 - 全宽 */}
                {selectedCharacter.backstory && (
                  <Box>
                    <Text size="2" weight="bold" className="text-amber-500 uppercase mb-3 block flex items-center gap-2">
                      <span className="w-1 h-4 bg-amber-500 rounded"></span>
                      背景故事
                    </Text>
                    <Box className="p-4 bg-gray-800/30 rounded-lg border border-gray-700/50 italic text-gray-300">
                      <Text size="2" style={{ whiteSpace: 'pre-wrap' }}>{selectedCharacter.backstory}</Text>
                    </Box>
                  </Box>
                )}

                {/* 其他特性 */}
                {selectedCharacter.other_traits && (
                  <Box>
                    <Text size="2" weight="bold" className="text-amber-500 uppercase mb-3 block flex items-center gap-2">
                      <span className="w-1 h-4 bg-amber-500 rounded"></span>
                      其他特性
                    </Text>
                    <Box className="p-4 bg-gray-800/30 rounded-lg border border-gray-700/50">
                      <Text size="2" style={{ whiteSpace: 'pre-wrap' }}>{selectedCharacter.other_traits}</Text>
                    </Box>
                  </Box>
                )}
              </Box>
            );
          })()}
        </Dialog.Content>
      </Dialog.Root>
    </Box>
  );
}
