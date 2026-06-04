import { useState, useEffect, useCallback } from "react";
import { Link, useNavigate } from "react-router";
import type { MetaFunction } from "react-router";
import { useTranslation } from "react-i18next";
import { getAssetUrl } from "~/utils/asset-url";
import { CreateCampaignDialog } from "~/components/campaign/CreateCampaignDialog";
import { TemplatePreviewModal } from "~/components/campaign/TemplatePreviewModal";
import { ProfileSettingsModal } from "~/components/ui/ProfileSettingsModal";
import { LanguageSwitcher } from "~/i18n/LanguageSwitcher";
import { getI18n } from "~/i18n";

// Base path for static assets (set by VITE_BASE_PATH during build)
const BASE_PATH = typeof import.meta.env?.BASE_URL === 'string' ? import.meta.env.BASE_URL.replace(/\/$/, '') : '';

import {
  Box,
  Button,
  Card,
  Container,
  Flex,
  Grid,
  Heading,
  Text,
  Badge,
  Avatar,
  IconButton,
  DropdownMenu,
} from "@radix-ui/themes";
import {
  PlusIcon,
  TrashIcon,
  EnterIcon,
  PersonIcon,
  GearIcon,
  ExitIcon,
  ReaderIcon,
  MagicWandIcon,
  UploadIcon,
  ChevronRightIcon,
  MixerHorizontalIcon,
  ImageIcon,
  EyeOpenIcon,
} from "@radix-ui/react-icons";
import { getAuthUser, isAuthenticated, logout, setAuthUser as saveAuthUser } from "~/utils/auth";
import { apiFetch } from "~/utils/api-client";
import { createLogger } from '~/utils/logger';

const logger = createLogger('_index');

export const meta: MetaFunction = () => {
  const i18n = getI18n();
  return [
    { title: i18n.t("home:meta.title") },
    { name: "description", content: i18n.t("home:meta.description") },
  ];
};

interface Campaign {
  id: number;
  name: string;
  dm_user_id: string;
  dm_display_name?: string;
  current_players: number;
  max_players: number;
  level_range?: string;
  status: string;
  description?: string;
  cover_image?: string;
  created_at: string;
  is_member?: boolean;
}

interface SharedTemplate {
  id: number;
  name: string;
  description?: string;
  cover_image?: string;
  shared_by_name?: string;
  dm_user_id: string;
  created_at: string;
  updated_at?: string;
}

export default function Index() {
  const navigate = useNavigate();
  const { t } = useTranslation(["home", "common"]);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [sharedTemplates, setSharedTemplates] = useState<SharedTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authUser, setAuthUser] = useState<ReturnType<typeof getAuthUser> | undefined>(undefined);
  // Hero background URL - only set on client to avoid SSR/CSR mismatch
  const [heroBgUrl, setHeroBgUrl] = useState("");
  // Guide role toggle - DM or Player
  const [guideRole, setGuideRole] = useState<'dm' | 'player'>('dm');
  // Profile settings modal
  const [showProfileModal, setShowProfileModal] = useState(false);
  // Template preview
  const [previewTemplateId, setPreviewTemplateId] = useState<number | null>(null);
  const [previewTemplateName, setPreviewTemplateName] = useState<string>("");
  const [previewTemplateIsOwn, setPreviewTemplateIsOwn] = useState(false);

  const userId = authUser?.id || "";
  const displayName = authUser?.display_name || authUser?.email || t("home:userMenu.fallbackName");
  const isAdmin = authUser?.role === "admin";

  useEffect(() => {
    // PWA route restoration: only on cold start (OS killed PWA in background).
    // sessionStorage survives in-session navigation but clears on tab/PWA death,
    // so we use it to distinguish cold start from user intentionally going home.
    const lastRoute = localStorage.getItem("dnd_last_route");
    const isColdStart = !sessionStorage.getItem("dnd_app_loaded");
    sessionStorage.setItem("dnd_app_loaded", "1");
    if (lastRoute && isColdStart && isAuthenticated()) {
      localStorage.removeItem("dnd_last_route");
      navigate(lastRoute, { replace: true });
      return;
    }

    const user = getAuthUser();
    setAuthUser(user);
    // Set asset URL on client only to avoid SSR/CSR mismatch
    setHeroBgUrl(getAssetUrl('bg-dragon.jpg'));
    if (!user) {
      setLoading(false);
    } else {
      // Auto-popup profile modal for new users with default names
      const dn = user.display_name || "";
      if (dn.startsWith("User ") || dn === user.email) {
        setShowProfileModal(true);
      }
    }
  }, []);

  useEffect(() => {
    if (userId) {
      loadCampaigns(userId);
      loadSharedTemplates();
    }
  }, [userId]);

  const loadCampaigns = useCallback(async (_currentUserId: string) => {
    try {
      setLoading(true);
      const response = await apiFetch("/api/campaigns");
      if (response.ok) {
        const data = await response.json();
        const campaignsWithMembership = await Promise.all(
          data.map(async (campaign: Campaign) => {
            try {
              const memberResponse = await apiFetch(`/api/campaigns/${campaign.id}/members/me/check`);
              if (memberResponse.ok) {
                const checkData = await memberResponse.json();
                return { ...campaign, is_member: checkData.is_member };
              }
              return { ...campaign, is_member: false };
            } catch {
              return { ...campaign, is_member: false };
            }
          })
        );
        setCampaigns(campaignsWithMembership);
      } else {
        setError(t("home:campaigns.loadFailed"));
      }
    } catch (err) {
      setError(t("home:campaigns.connectFailed"));
      logger.error("Failed to connect to server", err);
    } finally {
      setLoading(false);
    }
  }, [t]);

  const handleJoinCampaign = async (campaignId: number) => {
    try {
      const response = await apiFetch(`/api/campaigns/${campaignId}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "player" }),
      });
      if (response.ok) {
        navigate(`/campaign/${campaignId}/player`);
      } else {
        const errorData = await response.json();
        setError(errorData.detail || t("home:campaigns.joinFailed"));
      }
    } catch (err) {
      setError(t("home:campaigns.joinFailed"));
      logger.error("Failed to join campaign", err);
    }
  };

  const handleLogout = () => logout();

  const handleDeleteCampaign = async (campaignId: number, campaignName: string) => {
    if (!confirm(t("home:campaigns.deleteConfirm", { name: campaignName }))) return;
    try {
      const response = await apiFetch(`/api/campaigns/${campaignId}`, { method: "DELETE" });
      if (response.ok) {
        await loadCampaigns(userId);
      } else {
        const errorData = await response.json();
        setError(errorData.detail || t("home:campaigns.deleteFailed"));
      }
    } catch (err) {
      setError(t("home:campaigns.deleteFailed"));
      logger.error("Failed to delete campaign", err);
    }
  };

  const loadSharedTemplates = async () => {
    try {
      const res = await apiFetch("/api/campaign-templates/shared");
      if (res.ok) {
        setSharedTemplates(await res.json());
      }
    } catch (err) {
      logger.error("Failed to load shared templates", err);
    }
  };

  const handleCloneTemplate = async (templateId: number) => {
    try {
      const res = await apiFetch(
        `/api/campaign-templates/${templateId}/clone`,
        { method: "POST" }
      );
      if (res.ok) {
        alert(t("home:sharedTemplates.cloneSuccess"));
      } else {
        const data = await res.json();
        if (data.detail?.includes("your own")) {
          alert(t("home:sharedTemplates.cloneOwnError"));
        } else {
          setError(data.detail || t("home:sharedTemplates.cloneFailed"));
        }
      }
    } catch (err) {
      setError(t("home:sharedTemplates.cloneFailed"));
      logger.error("Failed to clone template", err);
    }
  };

  const handleDeleteSharedTemplate = async (templateId: number, name: string) => {
    if (!confirm(t("home:sharedTemplates.deleteConfirm", { name }))) return;
    try {
      const res = await apiFetch(
        `/api/campaign-templates/${templateId}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        setSharedTemplates((prev) => prev.filter((tpl) => tpl.id !== templateId));
      } else {
        const data = await res.json();
        setError(data.detail || t("home:sharedTemplates.deleteFailed"));
      }
    } catch (err) {
      setError(t("home:sharedTemplates.deleteFailed"));
      logger.error("Failed to delete shared template", err);
    }
  };

  return (
    <Box className="min-h-screen bg-[#0d0f12]" style={{ paddingTop: 'var(--sat, 0px)' }}>
      {/* 导航栏 */}
      <Box className="fixed left-0 right-0 z-50 bg-[#0d0f12]/95 backdrop-blur-sm border-b border-amber-900/20" style={{ top: 'var(--sat, 0px)' }}>
        <Container size="4" className="px-4 sm:px-6">
          <Flex justify="between" align="center" height="56px">
            <Link to="/" className="no-underline flex items-center gap-2">
              <img src={`${BASE_PATH}/logo.png`} alt="DW" className="h-7 w-auto" />
              <span className="text-amber-100 font-semibold tracking-wide text-lg">
                Deepwood <span className="text-amber-500">{t("home:brand.tagline")}</span>
              </span>
            </Link>

            <Flex align="center" gap="3">
              <LanguageSwitcher />
              <DropdownMenu.Root>
              <DropdownMenu.Trigger>
                <Button variant="ghost" className="gap-2 text-gray-300 hover:text-amber-200 hover:bg-transparent">
                  <Avatar size="1" fallback={displayName[0]?.toUpperCase() || "U"} radius="full" color="amber" />
                  <Text size="2" className="hidden sm:block">{displayName}</Text>
                </Button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content className="bg-[#1a1d24] border-gray-800">
                <DropdownMenu.Item onClick={() => setShowProfileModal(true)}>
                  <GearIcon /> {t("home:userMenu.profile")}
                </DropdownMenu.Item>
                <DropdownMenu.Separator />
                <DropdownMenu.Item onClick={() => navigate('/character')}>
                  <PersonIcon /> {t("home:userMenu.myCharacters")}
                </DropdownMenu.Item>
                <DropdownMenu.Item onClick={() => navigate('/spells')}>
                  <MagicWandIcon /> {t("home:userMenu.spellbook")}
                </DropdownMenu.Item>
                <DropdownMenu.Item onClick={() => navigate('/map-library')}>
                  <ImageIcon /> {t("home:userMenu.mapLibrary")}
                </DropdownMenu.Item>
                <DropdownMenu.Item onClick={() => navigate('/modules')}>
                  <ReaderIcon /> {t("home:userMenu.modules")}
                </DropdownMenu.Item>
                {isAdmin && (
                  <>
                    <DropdownMenu.Separator />
                    <DropdownMenu.Item onClick={() => navigate('/api-settings')}>
                      <GearIcon /> {t("home:userMenu.apiSettings")}
                    </DropdownMenu.Item>
                    <DropdownMenu.Item onClick={() => navigate('/api-usage')}>
                      <MixerHorizontalIcon /> {t("home:userMenu.apiUsage")}
                    </DropdownMenu.Item>
                  </>
                )}
                <DropdownMenu.Separator />
                <DropdownMenu.Item color="red" onClick={handleLogout}>
                  <ExitIcon /> {t("home:userMenu.logout")}
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Root>
            </Flex>
          </Flex>
        </Container>
      </Box>

      {/* Hero - 紧凑设计 */}
      <Box
        className="relative pt-14"
        style={heroBgUrl ? {
          backgroundImage: `url(${heroBgUrl})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center top'
        } : {
          backgroundColor: '#0d0f12'
        }}
      >
        <Box className="bg-gradient-to-b from-[#0d0f12]/60 via-[#0d0f12]/80 to-[#0d0f12] py-10 sm:py-14">
          <Container size="4" className="px-4 sm:px-6 text-center">
            <h1 className="text-3xl sm:text-4xl font-bold text-amber-50 mb-2 tracking-tight" style={{textShadow: '0 2px 20px rgba(0,0,0,0.5)'}}>
              {t("home:hero.title")}
            </h1>
            <p className="text-gray-400 text-sm mb-6">
              {t("home:hero.subtitle")}
            </p>

            {/* 角色选择标签 */}
            <Flex justify="center" gap="1" className="mb-4">
              <button
                onClick={() => setGuideRole('dm')}
                className={`px-4 py-2 text-sm font-medium rounded-l-lg transition-all duration-300 ${
                  guideRole === 'dm'
                    ? 'bg-gradient-to-r from-amber-600 to-amber-700 text-amber-50 shadow-lg shadow-amber-900/30'
                    : 'bg-gray-800/60 text-gray-400 hover:text-amber-200 hover:bg-gray-800/80'
                }`}
              >
                {t("home:hero.roleDm")}
              </button>
              <button
                onClick={() => setGuideRole('player')}
                className={`px-4 py-2 text-sm font-medium rounded-r-lg transition-all duration-300 ${
                  guideRole === 'player'
                    ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-blue-50 shadow-lg shadow-blue-900/30'
                    : 'bg-gray-800/60 text-gray-400 hover:text-blue-200 hover:bg-gray-800/80'
                }`}
              >
                {t("home:hero.rolePlayer")}
              </button>
            </Flex>

            {/* DM 流程 */}
            {guideRole === 'dm' && (
              <Box className="mb-6">
                <Flex align="center" justify="center" gap="1" className="text-xs sm:text-sm flex-wrap">
                  <Flex align="center" gap="1" className="text-amber-400">
                    <span className="w-5 h-5 rounded-full bg-amber-500/20 text-[10px] flex items-center justify-center font-bold border border-amber-500/40">1</span>
                    <span>{t("home:hero.dmSteps.upload")}</span>
                  </Flex>
                  <ChevronRightIcon className="text-gray-600 w-4 h-4" />
                  <Flex align="center" gap="1" className="text-amber-400/90">
                    <span className="w-5 h-5 rounded-full bg-amber-500/15 text-[10px] flex items-center justify-center font-bold border border-amber-500/30">2</span>
                    <span>{t("home:hero.dmSteps.ai")}</span>
                  </Flex>
                  <ChevronRightIcon className="text-gray-600 w-4 h-4" />
                  <Flex align="center" gap="1" className="text-amber-400/80">
                    <span className="w-5 h-5 rounded-full bg-amber-500/10 text-[10px] flex items-center justify-center font-bold border border-amber-500/25">3</span>
                    <span>{t("home:hero.dmSteps.create")}</span>
                  </Flex>
                  <ChevronRightIcon className="text-gray-600 w-4 h-4" />
                  <Flex align="center" gap="1" className="text-amber-400/70">
                    <span className="w-5 h-5 rounded-full bg-amber-500/10 text-[10px] flex items-center justify-center font-bold border border-amber-500/20">4</span>
                    <span>{t("home:hero.dmSteps.pick")}</span>
                  </Flex>
                  <ChevronRightIcon className="text-gray-600 w-4 h-4" />
                  <Flex align="center" gap="1" className="text-amber-400/60">
                    <span className="w-5 h-5 rounded-full bg-amber-500/10 text-[10px] flex items-center justify-center font-bold border border-amber-500/15">5</span>
                    <span>{t("home:hero.dmSteps.import")}</span>
                  </Flex>
                </Flex>
                <Text size="1" className="text-gray-500 mt-2 block">
                  {t("home:hero.dmStepsLabel")}
                </Text>
              </Box>
            )}

            {/* 玩家流程 */}
            {guideRole === 'player' && (
              <Box className="mb-6">
                <Flex align="center" justify="center" gap="1" className="text-xs sm:text-sm flex-wrap">
                  <Flex align="center" gap="1" className="text-blue-400">
                    <span className="w-5 h-5 rounded-full bg-blue-500/20 text-[10px] flex items-center justify-center font-bold border border-blue-500/40">1</span>
                    <span>{t("home:hero.playerSteps.join")}</span>
                  </Flex>
                  <ChevronRightIcon className="text-gray-600 w-4 h-4" />
                  <Flex align="center" gap="1" className="text-blue-400/80">
                    <span className="w-5 h-5 rounded-full bg-blue-500/15 text-[10px] flex items-center justify-center font-bold border border-blue-500/30">2</span>
                    <span>{t("home:hero.playerSteps.createCharacter")}</span>
                  </Flex>
                  <ChevronRightIcon className="text-gray-600 w-4 h-4" />
                  <Flex align="center" gap="1" className="text-blue-400/70">
                    <span className="w-5 h-5 rounded-full bg-blue-500/10 text-[10px] flex items-center justify-center font-bold border border-blue-500/25">3</span>
                    <span>{t("home:hero.playerSteps.begin")}</span>
                  </Flex>
                </Flex>
                <Text size="1" className="text-gray-500 mt-2 block">
                  {t("home:hero.playerStepsLabel")}
                </Text>
              </Box>
            )}

            {/* 操作按钮 */}
            <Flex justify="center" gap="3">
              {guideRole === 'dm' ? (
                <>
                  <Button
                    size="2"
                    variant="outline"
                    className="cursor-pointer border-amber-700/50 text-amber-200 hover:bg-amber-900/20"
                    onClick={() => navigate('/modules')}
                  >
                    <UploadIcon width="14" height="14" /> {t("home:hero.actions.uploadModule")}
                  </Button>

                  <Button size="2" className="cursor-pointer bg-amber-600 hover:bg-amber-500 text-black font-medium" onClick={() => setShowCreateDialog(true)}>
                    <PlusIcon width="14" height="14" /> {t("home:hero.actions.createCampaign")}
                  </Button>
                  <CreateCampaignDialog
                    open={showCreateDialog}
                    onOpenChange={setShowCreateDialog}
                    userId={userId}
                    onSuccess={(id) => navigate(`/campaign/${id}/dm`)}
                  />
                </>
              ) : (
                <Text size="2" className="text-gray-500 py-2">
                  {t("home:hero.actions.playerHint")}
                </Text>
              )}
            </Flex>
          </Container>
        </Box>
      </Box>

      {/* 战役列表 */}
      <Box className="py-8 px-4 sm:px-6">
        <Container size="4">
          <Heading size="4" className="text-gray-300 mb-5 flex items-center gap-2">
            <span className="w-1 h-5 bg-amber-500 rounded-full"></span>
            {t("home:campaigns.sectionTitle")}
          </Heading>

          {error && (
            <Card className="bg-red-900/10 border-red-900/30 mb-4 p-3">
              <Text size="2" className="text-red-400">⚠️ {error}</Text>
            </Card>
          )}

          {loading ? (
            <Grid columns={{ initial: "1", sm: "2", lg: "3" }} gap="4">
              {[1,2,3].map(i => (
                <Box key={i} className="h-32 animate-pulse bg-gray-800/50 rounded-lg" />
              ))}
            </Grid>
          ) : campaigns.length === 0 ? (
            <Flex direction="column" align="center" className="py-16 border border-dashed border-gray-800 rounded-lg">
              <ReaderIcon width="32" height="32" className="text-gray-700 mb-3" />
              <Text className="text-gray-500 mb-4">{t("home:campaigns.empty")}</Text>
              <Button variant="soft" color="gray" size="2" onClick={() => setShowCreateDialog(true)}>
                {t("home:campaigns.emptyCta")}
              </Button>
            </Flex>
          ) : (
            <Grid columns={{ initial: "1", sm: "2", lg: "3" }} gap="5">
              {campaigns.map((campaign) => {
                const isOwner = campaign.dm_user_id === userId;
                const isFull = campaign.current_players >= campaign.max_players;

                return (
                  <Box
                    key={campaign.id}
                    className="group relative h-60 cursor-pointer transition-all duration-500 hover:scale-[1.02]"
                    onClick={() => {
                      if (isOwner) navigate(`/campaign/${campaign.id}/dm`);
                      else if (campaign.is_member) navigate(`/campaign/${campaign.id}/player`);
                    }}
                  >
                    {/* D&D Fantasy Frame - Outer Glow */}
                    <Box
                      className="absolute -inset-1 rounded-xl pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                      style={{
                        background: 'radial-gradient(ellipse at center, rgba(212,175,105,0.15) 0%, transparent 70%)',
                        filter: 'blur(8px)',
                      }}
                    />

                    {/* Main Frame Border */}
                    <Box
                      className="absolute -inset-[2px] rounded-xl pointer-events-none"
                      style={{
                        background: `linear-gradient(
                          135deg,
                          #8b6914 0%,
                          #d4af69 15%,
                          #f5d998 25%,
                          #d4af69 35%,
                          #8b6914 50%,
                          #d4af69 65%,
                          #f5d998 75%,
                          #d4af69 85%,
                          #8b6914 100%
                        )`,
                        boxShadow: `
                          0 0 0 1px rgba(0,0,0,0.8),
                          inset 0 0 0 1px rgba(255,255,255,0.1),
                          0 4px 20px rgba(0,0,0,0.5),
                          0 0 40px rgba(139,105,20,0.2)
                        `,
                      }}
                    />

                    {/* Inner Dark Border */}
                    <Box
                      className="absolute inset-0 rounded-[10px] pointer-events-none"
                      style={{
                        boxShadow: `
                          inset 0 0 0 2px rgba(20,15,10,0.9),
                          inset 0 0 0 3px rgba(139,105,20,0.4)
                        `,
                      }}
                    />

                    {/* 主内容区域 */}
                    <Box
                      className="relative h-full rounded-xl overflow-hidden"
                      style={{
                        boxShadow: 'inset 0 0 60px rgba(0,0,0,0.5)'
                      }}
                    >
                      {/* Ornate Corner - Top Left */}
                      <svg className="absolute -top-[2px] -left-[2px] w-12 h-12 z-20 pointer-events-none drop-shadow-lg" viewBox="0 0 48 48">
                        <defs>
                          <linearGradient id={`corner-gold-tl-${campaign.id}`} x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stopColor="#f5d998" />
                            <stop offset="30%" stopColor="#d4af69" />
                            <stop offset="70%" stopColor="#a08030" />
                            <stop offset="100%" stopColor="#8b6914" />
                          </linearGradient>
                        </defs>
                        {/* Main corner piece */}
                        <path d="M4 4 L4 20 L7 20 L7 7 L20 7 L20 4 Z" fill={`url(#corner-gold-tl-${campaign.id})`} />
                        {/* Inner decorative line */}
                        <path d="M8 8 L8 16 L10 16 L10 10 L16 10 L16 8 Z" fill={`url(#corner-gold-tl-${campaign.id})`} opacity="0.6" />
                        {/* Diamond accent */}
                        <path d="M12 4 L14 7 L12 10 L10 7 Z" fill={`url(#corner-gold-tl-${campaign.id})`} className="group-hover:animate-pulse" />
                        <path d="M4 12 L7 14 L10 12 L7 10 Z" fill={`url(#corner-gold-tl-${campaign.id})`} className="group-hover:animate-pulse" />
                        {/* Flourish curl */}
                        <path d="M20 4 Q24 4 24 8 L22 8 Q22 6 20 6 Z" fill={`url(#corner-gold-tl-${campaign.id})`} opacity="0.8" />
                        <path d="M4 20 Q4 24 8 24 L8 22 Q6 22 6 20 Z" fill={`url(#corner-gold-tl-${campaign.id})`} opacity="0.8" />
                      </svg>

                      {/* Ornate Corner - Top Right */}
                      <svg className="absolute -top-[2px] -right-[2px] w-12 h-12 z-20 pointer-events-none drop-shadow-lg" viewBox="0 0 48 48">
                        <defs>
                          <linearGradient id={`corner-gold-tr-${campaign.id}`} x1="100%" y1="0%" x2="0%" y2="100%">
                            <stop offset="0%" stopColor="#f5d998" />
                            <stop offset="30%" stopColor="#d4af69" />
                            <stop offset="70%" stopColor="#a08030" />
                            <stop offset="100%" stopColor="#8b6914" />
                          </linearGradient>
                        </defs>
                        <path d="M44 4 L28 4 L28 7 L41 7 L41 20 L44 20 Z" fill={`url(#corner-gold-tr-${campaign.id})`} />
                        <path d="M40 8 L32 8 L32 10 L38 10 L38 16 L40 16 Z" fill={`url(#corner-gold-tr-${campaign.id})`} opacity="0.6" />
                        <path d="M36 4 L34 7 L36 10 L38 7 Z" fill={`url(#corner-gold-tr-${campaign.id})`} className="group-hover:animate-pulse" />
                        <path d="M44 12 L41 14 L38 12 L41 10 Z" fill={`url(#corner-gold-tr-${campaign.id})`} className="group-hover:animate-pulse" />
                        <path d="M28 4 Q24 4 24 8 L26 8 Q26 6 28 6 Z" fill={`url(#corner-gold-tr-${campaign.id})`} opacity="0.8" />
                        <path d="M44 20 Q44 24 40 24 L40 22 Q42 22 42 20 Z" fill={`url(#corner-gold-tr-${campaign.id})`} opacity="0.8" />
                      </svg>

                      {/* Ornate Corner - Bottom Left */}
                      <svg className="absolute -bottom-[2px] -left-[2px] w-12 h-12 z-20 pointer-events-none drop-shadow-lg" viewBox="0 0 48 48">
                        <defs>
                          <linearGradient id={`corner-gold-bl-${campaign.id}`} x1="0%" y1="100%" x2="100%" y2="0%">
                            <stop offset="0%" stopColor="#f5d998" />
                            <stop offset="30%" stopColor="#d4af69" />
                            <stop offset="70%" stopColor="#a08030" />
                            <stop offset="100%" stopColor="#8b6914" />
                          </linearGradient>
                        </defs>
                        <path d="M4 44 L4 28 L7 28 L7 41 L20 41 L20 44 Z" fill={`url(#corner-gold-bl-${campaign.id})`} />
                        <path d="M8 40 L8 32 L10 32 L10 38 L16 38 L16 40 Z" fill={`url(#corner-gold-bl-${campaign.id})`} opacity="0.6" />
                        <path d="M12 44 L14 41 L12 38 L10 41 Z" fill={`url(#corner-gold-bl-${campaign.id})`} className="group-hover:animate-pulse" />
                        <path d="M4 36 L7 34 L10 36 L7 38 Z" fill={`url(#corner-gold-bl-${campaign.id})`} className="group-hover:animate-pulse" />
                        <path d="M20 44 Q24 44 24 40 L22 40 Q22 42 20 42 Z" fill={`url(#corner-gold-bl-${campaign.id})`} opacity="0.8" />
                        <path d="M4 28 Q4 24 8 24 L8 26 Q6 26 6 28 Z" fill={`url(#corner-gold-bl-${campaign.id})`} opacity="0.8" />
                      </svg>

                      {/* Ornate Corner - Bottom Right */}
                      <svg className="absolute -bottom-[2px] -right-[2px] w-12 h-12 z-20 pointer-events-none drop-shadow-lg" viewBox="0 0 48 48">
                        <defs>
                          <linearGradient id={`corner-gold-br-${campaign.id}`} x1="100%" y1="100%" x2="0%" y2="0%">
                            <stop offset="0%" stopColor="#f5d998" />
                            <stop offset="30%" stopColor="#d4af69" />
                            <stop offset="70%" stopColor="#a08030" />
                            <stop offset="100%" stopColor="#8b6914" />
                          </linearGradient>
                        </defs>
                        <path d="M44 44 L28 44 L28 41 L41 41 L41 28 L44 28 Z" fill={`url(#corner-gold-br-${campaign.id})`} />
                        <path d="M40 40 L32 40 L32 38 L38 38 L38 32 L40 32 Z" fill={`url(#corner-gold-br-${campaign.id})`} opacity="0.6" />
                        <path d="M36 44 L34 41 L36 38 L38 41 Z" fill={`url(#corner-gold-br-${campaign.id})`} className="group-hover:animate-pulse" />
                        <path d="M44 36 L41 34 L38 36 L41 38 Z" fill={`url(#corner-gold-br-${campaign.id})`} className="group-hover:animate-pulse" />
                        <path d="M28 44 Q24 44 24 40 L26 40 Q26 42 28 42 Z" fill={`url(#corner-gold-br-${campaign.id})`} opacity="0.8" />
                        <path d="M44 28 Q44 24 40 24 L40 26 Q42 26 42 28 Z" fill={`url(#corner-gold-br-${campaign.id})`} opacity="0.8" />
                      </svg>

                      {/* Edge Center Ornaments - Top */}
                      <svg className="absolute top-0 left-1/2 -translate-x-1/2 w-16 h-4 z-20 pointer-events-none" viewBox="0 0 64 16">
                        <defs>
                          <linearGradient id={`edge-gold-t-${campaign.id}`} x1="0%" y1="0%" x2="0%" y2="100%">
                            <stop offset="0%" stopColor="#f5d998" />
                            <stop offset="50%" stopColor="#d4af69" />
                            <stop offset="100%" stopColor="#8b6914" />
                          </linearGradient>
                        </defs>
                        <path d="M24 0 L32 6 L40 0 L38 0 L32 4 L26 0 Z" fill={`url(#edge-gold-t-${campaign.id})`} />
                        <circle cx="32" cy="8" r="2" fill={`url(#edge-gold-t-${campaign.id})`} className="group-hover:animate-pulse" />
                        <path d="M20 0 L22 3 L24 0" fill="none" stroke={`url(#edge-gold-t-${campaign.id})`} strokeWidth="1" opacity="0.6" />
                        <path d="M40 0 L42 3 L44 0" fill="none" stroke={`url(#edge-gold-t-${campaign.id})`} strokeWidth="1" opacity="0.6" />
                      </svg>

                      {/* Edge Center Ornaments - Bottom */}
                      <svg className="absolute bottom-0 left-1/2 -translate-x-1/2 w-16 h-4 z-20 pointer-events-none" viewBox="0 0 64 16">
                        <defs>
                          <linearGradient id={`edge-gold-b-${campaign.id}`} x1="0%" y1="100%" x2="0%" y2="0%">
                            <stop offset="0%" stopColor="#f5d998" />
                            <stop offset="50%" stopColor="#d4af69" />
                            <stop offset="100%" stopColor="#8b6914" />
                          </linearGradient>
                        </defs>
                        <path d="M24 16 L32 10 L40 16 L38 16 L32 12 L26 16 Z" fill={`url(#edge-gold-b-${campaign.id})`} />
                        <circle cx="32" cy="8" r="2" fill={`url(#edge-gold-b-${campaign.id})`} className="group-hover:animate-pulse" />
                      </svg>

                      {/* 背景图片 / 默认渐变 */}
                      <Box className="absolute inset-0">
                        {campaign.cover_image ? (
                          <img
                            src={campaign.cover_image}
                            alt={campaign.name}
                            className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                            style={{ filter: 'brightness(0.85)' }}
                          />
                        ) : (
                          <Box
                            className="w-full h-full"
                            style={{
                              background: `
                                radial-gradient(ellipse at 20% 0%, rgba(120,53,15,0.4) 0%, transparent 50%),
                                radial-gradient(ellipse at 80% 100%, rgba(180,83,9,0.3) 0%, transparent 50%),
                                radial-gradient(ellipse at 50% 50%, rgba(30,27,45,1) 0%, rgba(15,15,25,1) 100%)
                              `
                            }}
                          />
                        )}
                      </Box>

                      {/* 渐变遮罩 */}
                      <Box
                        className="absolute inset-0 pointer-events-none"
                        style={{
                          background: `
                            radial-gradient(ellipse 120% 80% at 50% 50%, transparent 30%, rgba(10,10,15,0.5) 100%),
                            linear-gradient(to top,
                              rgba(10,10,15,0.95) 0%,
                              rgba(10,10,15,0.85) 25%,
                              rgba(10,10,15,0.4) 50%,
                              rgba(10,10,15,0.1) 70%,
                              rgba(10,10,15,0.2) 100%
                            )
                          `
                        }}
                      />

                      {/* 边框内发光 */}
                      <Box
                        className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
                        style={{
                          boxShadow: 'inset 0 0 30px rgba(212,175,105,0.15)'
                        }}
                      />

                    {/* 状态标签 */}
                    <Box
                      className="absolute top-3 right-3 px-2.5 py-1 text-xs font-medium tracking-wide uppercase"
                      style={{
                        background: campaign.status === "in_progress"
                          ? 'linear-gradient(135deg, rgba(34,197,94,0.9) 0%, rgba(22,163,74,0.9) 100%)'
                          : 'linear-gradient(135deg, rgba(59,130,246,0.9) 0%, rgba(37,99,235,0.9) 100%)',
                        color: 'white',
                        borderRadius: '4px',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                        border: '1px solid rgba(255,255,255,0.1)'
                      }}
                    >
                      {campaign.status === "in_progress" ? t("home:campaigns.statusInProgress") : t("home:campaigns.statusRecruiting")}
                    </Box>

                    {/* DM标识 - 仅所有者可见 */}
                    {isOwner && (
                      <Box
                        className="absolute top-3 left-3 px-2 py-1 text-xs font-bold tracking-wider"
                        style={{
                          background: 'linear-gradient(135deg, rgba(180,83,9,0.95) 0%, rgba(146,64,14,0.95) 100%)',
                          color: '#fef3c7',
                          borderRadius: '4px',
                          boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
                          border: '1px solid rgba(255,191,0,0.3)'
                        }}
                      >
                        {t("home:campaigns.dmBadge")}
                      </Box>
                    )}

                    {/* 内容区域 */}
                    <Flex direction="column" justify="end" className="absolute inset-0 p-4">
                      {/* 战役名称 */}
                      <Text
                        className="text-xl font-bold tracking-wide mb-1 transition-colors duration-300 group-hover:text-amber-300"
                        style={{
                          color: '#f5f5f5',
                          textShadow: '0 2px 10px rgba(0,0,0,0.8), 0 0 30px rgba(0,0,0,0.5)'
                        }}
                      >
                        {campaign.name}
                      </Text>

                      {/* DM信息 */}
                      <Text
                        size="2"
                        className="mb-3 opacity-80"
                        style={{
                          color: '#a8a8a8',
                          textShadow: '0 1px 4px rgba(0,0,0,0.8)'
                        }}
                      >
                        {t("home:campaigns.hostLabel", { name: campaign.dm_display_name || campaign.dm_user_id.slice(0, 8) })}
                      </Text>

                      {/* 信息条 */}
                      <Flex gap="3" align="center" className="mb-3">
                        <Flex
                          align="center"
                          gap="1"
                          className="px-2 py-1 rounded text-xs"
                          style={{
                            background: 'rgba(255,255,255,0.1)',
                            backdropFilter: 'blur(4px)',
                            border: '1px solid rgba(255,255,255,0.1)'
                          }}
                        >
                          <span style={{ color: '#d4d4d4' }}>🎭</span>
                          <span style={{ color: '#e5e5e5' }}>{campaign.current_players}/{campaign.max_players}</span>
                        </Flex>
                        <Flex
                          align="center"
                          gap="1"
                          className="px-2 py-1 rounded text-xs"
                          style={{
                            background: 'rgba(255,255,255,0.1)',
                            backdropFilter: 'blur(4px)',
                            border: '1px solid rgba(255,255,255,0.1)'
                          }}
                        >
                          <span style={{ color: '#d4d4d4' }}>⚡</span>
                          <span style={{ color: '#e5e5e5' }}>{t("home:campaigns.levelLabel", { range: campaign.level_range || "1-5" })}</span>
                        </Flex>
                      </Flex>

                      {/* 操作按钮 */}
                      <Flex gap="2">
                        <Button
                          size="2"
                          className="flex-1 cursor-pointer transition-all duration-300"
                          style={{
                            background: isOwner
                              ? 'linear-gradient(135deg, rgba(180,83,9,0.9) 0%, rgba(146,64,14,0.9) 100%)'
                              : campaign.is_member
                              ? 'linear-gradient(135deg, rgba(22,101,52,0.9) 0%, rgba(20,83,45,0.9) 100%)'
                              : 'linear-gradient(135deg, rgba(180,83,9,0.9) 0%, rgba(146,64,14,0.9) 100%)',
                            color: isOwner ? '#fef3c7' : campaign.is_member ? '#bbf7d0' : '#fef3c7',
                            border: isOwner ? '1px solid rgba(255,191,0,0.3)' : campaign.is_member ? '1px solid rgba(74,222,128,0.3)' : '1px solid rgba(255,191,0,0.3)',
                            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                            fontWeight: 600
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isOwner) navigate(`/campaign/${campaign.id}/dm`);
                            else handleJoinCampaign(campaign.id);
                          }}
                          disabled={!isOwner && !campaign.is_member && isFull}
                        >
                          {isOwner ? (
                            <><MagicWandIcon width="14" height="14" /> {t("home:campaigns.buttons.enter")}</>
                          ) : campaign.is_member ? (
                            <><EnterIcon width="14" height="14" /> {t("home:campaigns.buttons.continue")}</>
                          ) : isFull ? t("home:campaigns.buttons.full") : t("home:campaigns.buttons.join")}
                        </Button>

                        {isOwner && (
                          <IconButton
                            size="2"
                            variant="ghost"
                            className="transition-all duration-300 hover:bg-red-900/40"
                            style={{
                              color: '#9ca3af',
                              border: '1px solid rgba(255,255,255,0.1)'
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteCampaign(campaign.id, campaign.name);
                            }}
                          >
                            <TrashIcon width="16" height="16" />
                          </IconButton>
                        )}
                      </Flex>
                    </Flex>
                    </Box>
                  </Box>
                );
              })}
            </Grid>
          )}
        </Container>
      </Box>

      {/* Shared Templates */}
      {sharedTemplates.length > 0 && (
        <Box className="pb-8 px-4 sm:px-6">
          <Container size="4">
            <Heading size="4" className="text-gray-300 mb-5 flex items-center gap-2">
              <span className="w-1 h-5 bg-emerald-500 rounded-full"></span>
              {t("home:sharedTemplates.sectionTitle")}
            </Heading>
            <Grid columns={{ initial: "1", sm: "2", lg: "3" }} gap="4">
              {sharedTemplates.map((tpl) => {
                const isOwn = tpl.dm_user_id === userId;
                return (
                  <Box
                    key={tpl.id}
                    className="group relative rounded-xl overflow-hidden border border-gray-700/50 hover:border-emerald-600/50 transition-all duration-300 bg-[#1a1d24]"
                  >
                    {/* Cover */}
                    <Box className="relative h-32 overflow-hidden">
                      {tpl.cover_image ? (
                        <img
                          src={tpl.cover_image}
                          alt={tpl.name}
                          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                          style={{ filter: "brightness(0.7)" }}
                        />
                      ) : (
                        <Box
                          className="w-full h-full"
                          style={{
                            background: "linear-gradient(135deg, rgba(16,185,129,0.2) 0%, rgba(15,15,25,1) 100%)",
                          }}
                        />
                      )}
                      <Box
                        className="absolute inset-0"
                        style={{ background: "linear-gradient(to top, rgba(26,29,36,1) 0%, transparent 60%)" }}
                      />
                      {/* Shared by badge */}
                      <Box className="absolute top-2 right-2 px-2 py-1 bg-emerald-600/90 text-white text-xs rounded font-medium">
                        {t("home:sharedTemplates.sharedByBadge", { name: tpl.shared_by_name || t("home:sharedTemplates.defaultDm") })}
                      </Box>
                    </Box>
                    {/* Info */}
                    <Box className="p-4 -mt-6 relative">
                      <Text className="text-white font-semibold text-base mb-1 truncate block">
                        {tpl.name}
                      </Text>
                      {tpl.description && (
                        <Text size="1" className="text-gray-400 line-clamp-2 block mb-3">
                          {tpl.description}
                        </Text>
                      )}
                      {!tpl.description && <Box className="mb-3" />}
                      <Flex gap="2">
                        <Button
                          size="2"
                          variant="outline"
                          className="flex-1 cursor-pointer"
                          style={{
                            borderColor: "rgba(16,185,129,0.4)",
                            color: "rgba(16,185,129,0.9)",
                          }}
                          onClick={() => {
                            setPreviewTemplateId(tpl.id);
                            setPreviewTemplateName(tpl.name);
                            setPreviewTemplateIsOwn(isOwn);
                          }}
                        >
                          <EyeOpenIcon width="14" height="14" /> {t("home:sharedTemplates.view")}
                        </Button>
                        {isOwn ? (
                          <Button
                            size="2"
                            className="flex-1 cursor-pointer"
                            style={{
                              background: "linear-gradient(135deg, rgba(239,68,68,0.8), rgba(185,28,28,0.8))",
                              color: "white",
                              border: "1px solid rgba(239,68,68,0.3)",
                            }}
                            onClick={() => handleDeleteSharedTemplate(tpl.id, tpl.name)}
                          >
                            <TrashIcon width="14" height="14" /> {t("home:sharedTemplates.delete")}
                          </Button>
                        ) : (
                          <Button
                            size="2"
                            className="flex-1 cursor-pointer"
                            style={{
                              background: "linear-gradient(135deg, rgba(16,185,129,0.9), rgba(5,150,105,0.9))",
                              color: "white",
                              border: "1px solid rgba(16,185,129,0.3)",
                            }}
                            onClick={() => handleCloneTemplate(tpl.id)}
                          >
                            {t("home:sharedTemplates.addToLibrary")}
                          </Button>
                        )}
                      </Flex>
                    </Box>
                  </Box>
                );
              })}
            </Grid>
          </Container>
        </Box>
      )}

      {/* Fan Content Policy Footer */}
      <Box
        className="text-center py-4 px-6 border-t border-gray-800"
        style={{ background: 'rgba(0,0,0,0.6)' }}
      >
        <Text size="1" style={{ color: '#6b7280', lineHeight: 1.5 }}>
          <a href="https://company.wizards.com/en/legal/fancontentpolicy" target="_blank" rel="noopener noreferrer" className="text-amber-600 hover:text-amber-500 underline">{t("home:footer.fanContentPolicy")}</a>
          <br />
          {t("home:footer.disclaimer")}
        </Text>
      </Box>

      {/* Profile Settings Modal */}
      <ProfileSettingsModal
        open={showProfileModal}
        onOpenChange={setShowProfileModal}
        currentName={displayName}
        userId={userId}
        onSave={(newName) => {
          if (authUser) {
            const updated = { ...authUser, display_name: newName };
            saveAuthUser(updated);
            setAuthUser(updated);
          }
        }}
      />

      {/* Template Preview Modal */}
      <TemplatePreviewModal
        templateId={previewTemplateId}
        templateName={previewTemplateName}
        open={!!previewTemplateId}
        onOpenChange={(open) => { if (!open) setPreviewTemplateId(null); }}
        onClone={(id) => {
          handleCloneTemplate(id);
          setPreviewTemplateId(null);
        }}
        isOwn={previewTemplateIsOwn}
      />
    </Box>
  );
}
