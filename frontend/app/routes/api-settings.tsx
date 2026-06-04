import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { getApiEndpoint } from "~/config/api";
import { apiFetch } from "~/utils/api-client";
import type { MetaFunction } from "react-router";
import {
  Box,
  Button,
  Card,
  Container,
  Flex,
  Heading,
  Text,
  TextField,
  Select,
  Callout,
  Separator,
  Grid,
  Badge,
  Table,
} from "@radix-ui/themes";
import { isCurrentUserAdmin } from "~/utils/permissions";
import { createLogger } from '~/utils/logger';
const logger = createLogger('api-settings');


export const meta: MetaFunction = () => {
  return [{ title: "API Settings - DND 5E Platform" }];
};

interface Model {
  id: string;
  object: string;
  created?: number;
  owned_by?: string;
}

interface TestModelResult {
  response: string;
  ttft: number;           // ms
  tokens: number;
  tokens_per_second: number;
  total_time: number;     // ms
  error?: string;
  // Image model test fields
  image_url?: string;
}

interface ModelTypeSettings {
  api_url: string;
  api_key: string;
  model: string;
  available_models: Model[];
  testing: boolean;
  testingModel: boolean;
  testModelResult: TestModelResult | null;
}

interface AllSettings {
  chat: ModelTypeSettings;
  fast: ModelTypeSettings;
  medium: ModelTypeSettings;
  advanced: ModelTypeSettings;
  super_advanced: ModelTypeSettings;
  vision: ModelTypeSettings;
  fast_image: ModelTypeSettings;
  medium_image: ModelTypeSettings;
  advanced_image: ModelTypeSettings;
  translation: ModelTypeSettings;
  music: ModelTypeSettings;
  embedding: ModelTypeSettings;
  rerank: ModelTypeSettings;
  stt: ModelTypeSettings;
  tts: ModelTypeSettings;
}

const defaultModelSettings = (): ModelTypeSettings => ({
  api_url: "",
  api_key: "",
  model: "",
  available_models: [],
  testing: false,
  testingModel: false,
  testModelResult: null,
});

export default function APISettings() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isClient, setIsClient] = useState(false);
  const [userIsAdmin, setUserIsAdmin] = useState(false);

  const [settings, setSettings] = useState<AllSettings>({
    chat: defaultModelSettings(),
    fast: defaultModelSettings(),
    medium: defaultModelSettings(),
    advanced: defaultModelSettings(),
    super_advanced: defaultModelSettings(),
    vision: defaultModelSettings(),
    fast_image: defaultModelSettings(),
    medium_image: defaultModelSettings(),
    advanced_image: defaultModelSettings(),
    translation: defaultModelSettings(),
    music: defaultModelSettings(),
    embedding: defaultModelSettings(),
    rerank: defaultModelSettings(),
    stt: defaultModelSettings(),
    tts: defaultModelSettings(),
  });

  // TTS voice browser state
  const [ttsVoices, setTtsVoices] = useState<{ id: string; name: string; gender: string; desc: string }[]>([]);
  const [ttsVoicesNote, setTtsVoicesNote] = useState("");
  const [ttsVoicesType, setTtsVoicesType] = useState("");
  const [ttsVoicesLoading, setTtsVoicesLoading] = useState(false);
  const [ttsVoicesOpen, setTtsVoicesOpen] = useState(false);
  const [ttsPreviewLoading, setTtsPreviewLoading] = useState<string | null>(null);
  const [ttsPreviewAudio, setTtsPreviewAudio] = useState<HTMLAudioElement | null>(null);

  const handleFetchTTSVoices = async () => {
    const ttsSettings = settings.tts;
    setTtsVoicesLoading(true);
    setTtsVoicesOpen(true);
    try {
      const params = new URLSearchParams();
      if (ttsSettings.model) params.set("model_name", ttsSettings.model);
      const resp = await fetch(getApiEndpoint(`/api/voice/available-voices?${params}`));
      if (resp.ok) {
        const data = await resp.json();
        setTtsVoices(data.voices || []);
        setTtsVoicesNote(data.note || "");
        setTtsVoicesType(data.type || "");
      } else {
        setTtsVoices([]);
        setTtsVoicesNote("获取音色列表失败");
      }
    } catch {
      setTtsVoices([]);
      setTtsVoicesNote("获取音色列表失败");
    } finally {
      setTtsVoicesLoading(false);
    }
  };

  const handlePreviewVoice = async (voiceId: string) => {
    // Stop any playing audio
    if (ttsPreviewAudio) {
      ttsPreviewAudio.pause();
      ttsPreviewAudio.src = "";
      setTtsPreviewAudio(null);
    }
    setTtsPreviewLoading(voiceId);
    try {
      const resp = await fetch(getApiEndpoint("/api/voice/synthesize"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: "欢迎来到深渊小屋，勇敢的冒险者。前方的旅途充满了未知与危险，愿你的骰子永远幸运。",
          voice: voiceId,
        }),
      });
      if (!resp.ok) throw new Error("合成失败");
      const data = await resp.json();
      const audioSrc = data.audio_url || (data.audio_base64 ? `data:audio/${data.format || "wav"};base64,${data.audio_base64}` : "");
      if (audioSrc) {
        const audio = new Audio(audioSrc);
        setTtsPreviewAudio(audio);
        audio.play();
      }
    } catch (e: any) {
      setError(`音色试听失败: ${e.message}`);
    } finally {
      setTtsPreviewLoading(null);
    }
  };

  // Check admin status on client side only
  useEffect(() => {
    setIsClient(true);
    const isAdmin = isCurrentUserAdmin();
    setUserIsAdmin(isAdmin);
    if (!isAdmin) {
      navigate("/", { replace: true });
    }
  }, [navigate]);

  // Load existing settings on mount
  useEffect(() => {
    if (userIsAdmin) {
      loadSettings();
    }
  }, [userIsAdmin]);

  const loadSettings = async () => {
    try {
      const response = await apiFetch("/api/ai-settings");
      if (response.ok) {
        const data = await response.json();

        // Convert array of model_configs to object structure
        const configsMap: any = {};
        if (data.model_configs && Array.isArray(data.model_configs)) {
          for (const config of data.model_configs) {
            // Convert uppercase model_type to lowercase for frontend keys
            const typeKey = config.model_type.toLowerCase();
            configsMap[typeKey] = {
              api_url: config.api_url || "",
              api_key: config.api_key || "",
              model: config.model_name || "",
              available_models: [],
              testing: false,
              testingModel: false,
              testModelResult: null,
            };
          }
        }

        // Ensure all model types have entries
        const allTypes: (keyof AllSettings)[] = ['chat', 'fast', 'medium', 'advanced', 'super_advanced', 'vision', 'fast_image', 'medium_image', 'advanced_image', 'translation', 'music', 'embedding', 'rerank', 'stt', 'tts'];
        for (const type of allTypes) {
          if (!configsMap[type]) {
            configsMap[type] = defaultModelSettings();
          }
        }

        setSettings(configsMap);
      }
    } catch (err) {
      logger.debug("No existing settings found");
    }
  };

  const handleTestConnection = async (type: keyof AllSettings) => {
    const typeSettings = settings[type];

    if (!typeSettings.api_url || !typeSettings.api_key) {
      setError(`Please enter both API URL and API Key for ${type} model`);
      return;
    }

    setSettings({
      ...settings,
      [type]: { ...typeSettings, testing: true },
    });
    setError(null);

    try {
      const tcUrl = getApiEndpoint(`/api/ai-settings/test-connection`) +
        `?api_url=${encodeURIComponent(typeSettings.api_url)}&api_key=${encodeURIComponent(typeSettings.api_key)}`;
      const response = await fetch(tcUrl, { method: "POST" });

      if (response.ok) {
        const data = await response.json();
        setSettings({
          ...settings,
          [type]: {
            ...typeSettings,
            available_models: data.models,
            testing: false,
          },
        });
        setSuccess(`Successfully fetched ${data.models_count} models for ${type}`);
        setTimeout(() => setSuccess(null), 3000);
      } else {
        const errorData = await response.json();
        setError(errorData.detail || `Failed to connect to ${type} API`);
        setSettings({
          ...settings,
          [type]: { ...typeSettings, testing: false },
        });
      }
    } catch (err) {
      setError(`Failed to connect to ${type} API. Please check your URL and key.`);
      setSettings({
        ...settings,
        [type]: { ...typeSettings, testing: false },
      });
    }
  };

  const IMAGE_MODEL_TYPES: Set<keyof AllSettings> = new Set(['fast_image', 'medium_image', 'advanced_image']);

  const handleTestModel = async (type: keyof AllSettings) => {
    const typeSettings = settings[type];
    if (!typeSettings.api_url || !typeSettings.api_key || !typeSettings.model) {
      setError(`Please fill in API URL, API Key and Model for ${type}`);
      return;
    }

    setSettings(prev => ({
      ...prev,
      [type]: { ...prev[type], testingModel: true, testModelResult: null },
    }));
    setError(null);

    // Use different endpoint for image models
    const isImage = IMAGE_MODEL_TYPES.has(type);
    const endpoint = isImage ? '/api/ai-settings/test-image-model' : '/api/ai-settings/test-model';

    try {
      const params = new URLSearchParams({
        api_url: typeSettings.api_url,
        api_key: typeSettings.api_key,
        model: typeSettings.model,
      });
      const response = await fetch(
        getApiEndpoint(`${endpoint}?${params}`),
        { method: "POST" }
      );

      if (response.ok) {
        const data = await response.json();
        setSettings(prev => ({
          ...prev,
          [type]: { ...prev[type], testingModel: false, testModelResult: data },
        }));
      } else {
        const errorData = await response.json();
        setSettings(prev => ({
          ...prev,
          [type]: { ...prev[type], testingModel: false, testModelResult: { error: errorData.detail } as TestModelResult },
        }));
      }
    } catch (err) {
      setSettings(prev => ({
        ...prev,
        [type]: { ...prev[type], testingModel: false, testModelResult: { error: "Failed to connect" } as TestModelResult },
      }));
    }
  };

  const handleSave = async () => {
    if (!userIsAdmin) {
      setError("Admin permission required");
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    // Convert object to array of model_configs
    const model_configs = Object.entries(settings).map(([type, config]) => ({
      model_type: type.toUpperCase(), // Convert to uppercase for backend enum
      api_url: config.api_url,
      api_key: config.api_key,
      model_name: config.model,
    }));

    const payload = { model_configs };

    try {
      // Try to update first
      let response = await apiFetch("/api/ai-settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      // If not found, create new
      if (response.status === 404) {
        response = await apiFetch("/api/ai-settings", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });
      }

      if (response.ok) {
        setSuccess("Global settings saved successfully!");
      } else {
        const errorData = await response.json();
        setError(errorData.detail || "Failed to save settings");
      }
    } catch (err) {
      setError("Failed to save settings. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const renderModelSection = (
    type: keyof AllSettings,
    title: string,
    description: string,
    extraContent?: React.ReactNode,
  ) => {
    const typeSettings = settings[type];

    return (
      <Card key={type}>
        <Flex direction="column" gap="4">
          <Box>
            <Heading size="4" mb="2">
              {title}
            </Heading>
            <Text size="2" color="gray">
              {description}
            </Text>
          </Box>

          {/* API URL */}
          <Box>
            <Text as="label" size="2" weight="medium" mb="2">
              API URL
            </Text>
            <TextField.Root
              placeholder="https://api.openai.com/v1"
              value={typeSettings.api_url}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  [type]: { ...typeSettings, api_url: e.target.value },
                })
              }
              disabled={!userIsAdmin}
              mt="2"
            />
          </Box>

          {/* API Key */}
          <Box>
            <Text as="label" size="2" weight="medium" mb="2">
              API Key
            </Text>
            <TextField.Root
              type="password"
              placeholder="sk-..."
              value={typeSettings.api_key}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  [type]: { ...typeSettings, api_key: e.target.value },
                })
              }
              disabled={!userIsAdmin}
              mt="2"
            />
          </Box>

          {/* Test Connection Button */}
          <Button
            variant="soft"
            onClick={() => handleTestConnection(type)}
            disabled={!userIsAdmin || typeSettings.testing || !typeSettings.api_url || !typeSettings.api_key}
          >
            {typeSettings.testing ? "Testing..." : "Test Connection & Fetch Models"}
          </Button>

          {/* Model Selection */}
          {typeSettings.available_models.length > 0 && (
            <Box>
              <Text as="label" size="2" weight="medium" mb="2">
                Select Model
              </Text>
              <Select.Root
                value={typeSettings.model || ""}
                onValueChange={(value) =>
                  setSettings({
                    ...settings,
                    [type]: { ...typeSettings, model: value },
                  })
                }
              >
                <Select.Trigger style={{ width: "100%", marginTop: "8px" }} />
                <Select.Content>
                  {typeSettings.available_models.map((model) => (
                    <Select.Item key={model.id} value={model.id}>
                      {model.id}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </Box>
          )}

          {/* Custom Model Name Input */}
          <Box>
            <Text as="label" size="2" weight="medium" mb="2">
              Or Enter Custom Model Name
            </Text>
            <TextField.Root
              placeholder="e.g., gpt-4, claude-3-opus-20240229"
              value={typeSettings.model}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  [type]: { ...typeSettings, model: e.target.value },
                })
              }
              mt="2"
            />
            <Text size="1" color="gray" mt="1">
              You can manually enter a model name if it's not in the list above
            </Text>
          </Box>

          {/* Test Model Button */}
          {typeSettings.model && (
            <Box>
              <Button
                variant="outline"
                size="2"
                onClick={() => handleTestModel(type)}
                disabled={!userIsAdmin || typeSettings.testingModel || !typeSettings.api_url || !typeSettings.api_key || !typeSettings.model}
              >
                {typeSettings.testingModel
                  ? (IMAGE_MODEL_TYPES.has(type) ? "Generating Image..." : "Testing Model...")
                  : (IMAGE_MODEL_TYPES.has(type) ? "Test Image Generation" : "Test Model")}
              </Button>
              {typeSettings.testModelResult && (
                (() => {
                  const r = typeSettings.testModelResult;
                  const isError = !!r.error;
                  const isImage = IMAGE_MODEL_TYPES.has(type);
                  return (
                    <Callout.Root color={isError ? "red" : "green"} mt="2">
                      <Callout.Text style={{ whiteSpace: "pre-wrap" }}>
                        {isError ? r.error : isImage ? (
                          <>
                            <Text size="2" weight="bold" mb="2" as="p">
                              Generation Time: {(r.total_time / 1000).toFixed(1)}s
                            </Text>
                            {r.image_url && (
                              <img
                                src={r.image_url}
                                alt="Test generated image"
                                style={{
                                  maxWidth: 256,
                                  maxHeight: 256,
                                  borderRadius: 8,
                                  marginTop: 8,
                                }}
                              />
                            )}
                          </>
                        ) : (
                          <>
                            <Flex gap="4" mb="2" wrap="wrap">
                              <Text size="2" weight="bold">TTFT: {r.ttft}ms</Text>
                              <Text size="2" weight="bold">Speed: {r.tokens_per_second} tokens/s</Text>
                              <Text size="2" color="gray">({r.tokens} tokens in {(r.total_time / 1000).toFixed(1)}s)</Text>
                            </Flex>
                            <Separator size="4" mb="2" />
                            {r.response}
                          </>
                        )}
                      </Callout.Text>
                    </Callout.Root>
                  );
                })()
              )}
            </Box>
          )}

              {/* Capability note for GPT-5 */}
              {typeSettings.model && typeSettings.model.toLowerCase().includes("gpt-5") && (
                <Callout.Root color="blue">
                  <Callout.Text>
                    Note: GPT-5 does not support temperature, top-p or max_tokens. The app will omit these parameters when calling the API.
                  </Callout.Text>
                </Callout.Root>
              )}

          {extraContent}

        </Flex>
      </Card>
    );


  };

  // Show loading state during SSR and initial client render
  if (!isClient) {
    return (
      <Box minHeight="100vh" style={{ backgroundColor: "var(--gray-1)" }}>
        <Container size="4" py="8">
          <Flex justify="center" align="center" minHeight="50vh">
            <Text color="gray">Loading...</Text>
          </Flex>
        </Container>
      </Box>
    );
  }

  return (
    <Box minHeight="100vh" style={{ backgroundColor: "var(--gray-1)", paddingTop: "var(--sat, 0px)" }}>
      {/* Header */}
      <Box
        style={{
          borderBottom: "1px solid var(--gray-6)",
          backgroundColor: "var(--color-panel)",
        }}
      >
        <Container size="4">
          <Flex justify="between" align="center" height="64px">
            <Heading size="6" style={{ fontFamily: "Cinzel" }}>
              API Settings
            </Heading>
            <Button variant="soft" color="gray" onClick={() => navigate("/")}>
              Back to Home
            </Button>
          </Flex>
        </Container>
      </Box>

      {/* Main Content */}
      <Container size="4" py="8">
        <Flex direction="column" gap="6">
          <Box>
            <Heading size="6" mb="2">
              Global AI Model Configuration (Admin Only)
            </Heading>
            <Text size="2" color="gray">
              Configure global API settings for all users. Each model type can use different API providers.
            </Text>
          </Box>

          {!userIsAdmin && (
            <Callout.Root color="red">
              <Callout.Text>
                ⚠️ Admin permission required. Only user_0 can access this page.
              </Callout.Text>
            </Callout.Root>
          )}

          {error && (
            <Callout.Root color="red">
              <Callout.Text>{error}</Callout.Text>
            </Callout.Root>
          )}

          {success && (
            <Callout.Root color="green">
              <Callout.Text>{success}</Callout.Text>
            </Callout.Root>
          )}

          {/* Model Sections */}
          <Grid columns={{ initial: "1", md: "2" }} gap="6">
            {renderModelSection(
              "chat",
              "Chat Model",
              "Interactive conversations and real-time chat responses"
            )}

            {renderModelSection(
              "fast",
              "Fast Language Model",
              "Quick responses for simple tasks and real-time interactions"
            )}

            {renderModelSection(
              "medium",
              "Medium Language Model",
              "Balanced performance for moderate complexity tasks"
            )}

            {renderModelSection(
              "advanced",
              "Advanced Language Model",
              "Complex reasoning, world-building, and detailed narrative generation"
            )}

            {renderModelSection(
              "super_advanced",
              "Super Advanced Language Model",
              "Ultra-powerful reasoning for the most demanding tasks like deep analysis and agent workflows"
            )}

            {renderModelSection(
              "vision",
              "Vision Recognition Model",
              "Image understanding and description for maps and character portraits"
            )}

            {renderModelSection(
              "fast_image",
              "Fast Image Generation Model",
              "Character portrait and avatar image generation"
            )}

            {renderModelSection(
              "medium_image",
              "Medium Image Generation Model",
              "High-quality player character avatar generation with better detail"
            )}

            {renderModelSection(
              "advanced_image",
              "Advanced Image Generation Model",
              "General purpose image generation for scenes and illustrations"
            )}

            {renderModelSection(
              "translation",
              "Advanced Translation Model",
              "High-quality translation for D&D modules and game content"
            )}

            {renderModelSection(
              "music",
              "Music Generation Model",
              "Background music and ambient sound generation for campaigns"
            )}

            {renderModelSection(
              "embedding",
              "Embedding Model",
              "Vector embeddings for semantic search and content similarity"
            )}

            {renderModelSection(
              "rerank",
              "Rerank Model",
              "Reranking model for improving search result relevance"
            )}

            {renderModelSection(
              "stt",
              "Speech-to-Text Model (STT)",
              "Whisper API for voice transcription (e.g., OpenAI Whisper, Groq Whisper)"
            )}

            {renderModelSection(
              "tts",
              "Text-to-Speech Model (TTS)",
              "Voice synthesis for AI narration (e.g., DashScope CosyVoice)",
              <>
                <Separator size="4" />
                <Box>
                  <Flex align="center" gap="3" mb="3">
                    <Button
                      variant="soft"
                      color="cyan"
                      onClick={handleFetchTTSVoices}
                      disabled={ttsVoicesLoading}
                    >
                      {ttsVoicesLoading ? "Loading..." : ttsVoicesOpen ? "Refresh Voices" : "Browse Available Voices"}
                    </Button>
                    {ttsVoicesOpen && (
                      <Button variant="ghost" color="gray" size="1" onClick={() => setTtsVoicesOpen(false)}>
                        Hide
                      </Button>
                    )}
                  </Flex>

                  {ttsVoicesOpen && (
                    <Box>
                      {ttsVoicesNote && (
                        <Callout.Root color="blue" mb="3" size="1">
                          <Callout.Text>{ttsVoicesNote}</Callout.Text>
                        </Callout.Root>
                      )}

                      {ttsVoices.length > 0 ? (
                        <Table.Root variant="surface" size="1">
                          <Table.Header>
                            <Table.Row>
                              <Table.ColumnHeaderCell>Voice ID</Table.ColumnHeaderCell>
                              <Table.ColumnHeaderCell>Name</Table.ColumnHeaderCell>
                              <Table.ColumnHeaderCell>Gender</Table.ColumnHeaderCell>
                              <Table.ColumnHeaderCell>Description</Table.ColumnHeaderCell>
                              <Table.ColumnHeaderCell>Actions</Table.ColumnHeaderCell>
                            </Table.Row>
                          </Table.Header>
                          <Table.Body>
                            {ttsVoices.map((v) => (
                              <Table.Row key={v.id}>
                                <Table.Cell>
                                  <Text size="1" style={{ fontFamily: "monospace" }}>{v.id.length > 20 ? v.id.slice(0, 20) + "..." : v.id}</Text>
                                </Table.Cell>
                                <Table.Cell>
                                  <Text size="2" weight="medium">{v.name}</Text>
                                </Table.Cell>
                                <Table.Cell>
                                  <Badge color={v.gender === "female" ? "pink" : "blue"} variant="soft" size="1">
                                    {v.gender === "female" ? "F" : "M"}
                                  </Badge>
                                </Table.Cell>
                                <Table.Cell>
                                  <Text size="1" color="gray">{v.desc}</Text>
                                </Table.Cell>
                                <Table.Cell>
                                  <Flex gap="2">
                                    {ttsVoicesType === "system" && (
                                      <Button
                                        variant="ghost"
                                        size="1"
                                        color="cyan"
                                        disabled={ttsPreviewLoading === v.id}
                                        onClick={() => handlePreviewVoice(v.id)}
                                      >
                                        {ttsPreviewLoading === v.id ? "..." : "Preview"}
                                      </Button>
                                    )}
                                  </Flex>
                                </Table.Cell>
                              </Table.Row>
                            ))}
                          </Table.Body>
                        </Table.Root>
                      ) : (
                        !ttsVoicesLoading && (
                          <Text size="2" color="gray">No voices found for this model.</Text>
                        )
                      )}
                    </Box>
                  )}
                </Box>
              </>
            )}
</Grid>

          {/* Save Button */}
          <Box>
            <Flex gap="3">
              <Button
                style={{ flex: 1 }}
                onClick={handleSave}
                disabled={loading || !userIsAdmin}
              >
                {loading ? "Saving..." : "Save All Settings"}
              </Button>
              <Button
                variant="soft"
                color="gray"
                style={{ flex: 1 }}
                onClick={() => navigate("/")}
              >
                Back to Home
              </Button>
            </Flex>

            {/* Status messages below buttons */}
            {(error || success) && (
              <Box mt="3">
                {error && (
                  <Callout.Root color="red">
                    <Callout.Text>{error}</Callout.Text>
                  </Callout.Root>
                )}
                {success && (
                  <Callout.Root color="green">
                    <Callout.Text>{success}</Callout.Text>
                  </Callout.Root>
                )}
              </Box>
            )}
          </Box>
        </Flex>
      </Container>
    </Box>
  );
}
