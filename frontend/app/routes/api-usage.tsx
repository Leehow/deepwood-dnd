import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { getApiEndpoint } from "~/config/api";
import { apiFetch } from "~/utils/api-client";
import type { MetaFunction } from "react-router";
import {
  Box,
  Button,
  Card,
  Checkbox,
  Container,
  Flex,
  Heading,
  Text,
  Select,
  Callout,
  Slider,
  TextField,
} from "@radix-ui/themes";
import { isCurrentUserAdmin } from "~/utils/permissions";

const MODEL_TYPE_LABELS: Record<string, string> = {
  FAST_IMAGE: "FAST_IMAGE (Fast Image)",
  MEDIUM_IMAGE: "MEDIUM_IMAGE (Medium Image)",
  ADVANCED_IMAGE: "ADVANCED_IMAGE (Advanced Image)",
};

export const meta: MetaFunction = () => {
  return [{ title: "API 使用配置 - DND 5E Platform" }];
};

interface UsageConfigItem {
  key: string;
  label: string;
  desc?: string | string[];  // Description of what this feature does (can be multi-line)
}

interface UsageConfigCategory {
  label: string;
  items: UsageConfigItem[];
}

// Config can be for text generation or image generation
interface TextConfig {
  model: string;
  temperature: number;
  max_tokens: number;
  use_temperature?: boolean;  // Whether to use temperature parameter
}

interface ImageConfig {
  model: string;
  image_size: string;
}

type UsageConfig = TextConfig | ImageConfig;

interface UsageConfigsResponse {
  configs: Record<string, UsageConfig>;
  categories: Record<string, UsageConfigCategory>;
  available_model_types: string[];
  all_model_types: string[];
  default_params: Record<string, { temperature?: number; max_tokens?: number; image_size?: string; use_temperature?: boolean }>;
  image_generation_keys: string[];
}


export default function APIUsage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [configs, setConfigs] = useState<Record<string, UsageConfig>>({});
  const [categories, setCategories] = useState<Record<string, UsageConfigCategory>>({});
  const [availableModelTypes, setAvailableModelTypes] = useState<string[]>([]);
  const [allModelTypes, setAllModelTypes] = useState<string[]>([]);
  const [defaultParams, setDefaultParams] = useState<Record<string, { temperature?: number; max_tokens?: number; image_size?: string; use_temperature?: boolean }>>({});
  const [imageGenerationKeys, setImageGenerationKeys] = useState<Set<string>>(new Set());

  const userIsAdmin = isCurrentUserAdmin();

  // Redirect non-admin users
  useEffect(() => {
    if (!userIsAdmin) {
      navigate("/", { replace: true });
    }
  }, [userIsAdmin, navigate]);

  // Load usage configs on mount
  useEffect(() => {
    if (userIsAdmin) {
      loadUsageConfigs();
    }
  }, [userIsAdmin]);

  const loadUsageConfigs = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await apiFetch("/api/ai-settings/usage-configs", {
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error("Failed to load usage configs");
      }

      const data: UsageConfigsResponse = await response.json();
      setConfigs(data.configs);
      setCategories(data.categories);
      setAvailableModelTypes(data.available_model_types);
      setAllModelTypes(data.all_model_types);
      setDefaultParams(data.default_params || {});
      setImageGenerationKeys(new Set(data.image_generation_keys || []));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load usage configs");
    } finally {
      setLoading(false);
    }
  };

  const isImageGeneration = (key: string) => imageGenerationKeys.has(key);

  const handleModelChange = (key: string, value: string) => {
    setConfigs((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        model: value,
      },
    }));
    setSuccess(null);
  };

  const handleTemperatureChange = (key: string, value: number) => {
    setConfigs((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        temperature: value,
      } as TextConfig,
    }));
    setSuccess(null);
  };

  const handleUseTemperatureChange = (key: string, checked: boolean) => {
    setConfigs((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        use_temperature: checked,
      } as TextConfig,
    }));
    setSuccess(null);
  };

  const handleMaxTokensChange = (key: string, value: string) => {
    const numValue = parseInt(value, 10);
    if (!isNaN(numValue) && numValue > 0) {
      setConfigs((prev) => ({
        ...prev,
        [key]: {
          ...prev[key],
          max_tokens: numValue,
        } as TextConfig,
      }));
      setSuccess(null);
    }
  };

  const handleImageSizeChange = (key: string, value: string) => {
    setConfigs((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        image_size: value,
      } as ImageConfig,
    }));
    setSuccess(null);
  };

  const resetToDefault = (key: string) => {
    const defaultParam = defaultParams[key];
    if (defaultParam) {
      if (isImageGeneration(key)) {
        setConfigs((prev) => ({
          ...prev,
          [key]: {
            ...prev[key],
            image_size: defaultParam.image_size || "512x512",
          } as ImageConfig,
        }));
      } else {
        setConfigs((prev) => ({
          ...prev,
          [key]: {
            ...prev[key],
            temperature: defaultParam.temperature ?? 0.7,
            max_tokens: defaultParam.max_tokens ?? 1000,
            use_temperature: defaultParam.use_temperature ?? false,
          } as TextConfig,
        }));
      }
      setSuccess(null);
    }
  };

  const saveUsageConfigs = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);

      const response = await apiFetch("/api/ai-settings/usage-configs", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(configs),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || "Failed to save usage configs");
      }

      setSuccess("配置保存成功");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save usage configs");
    } finally {
      setSaving(false);
    }
  };

  const isModelConfigured = (modelType: string) => {
    return availableModelTypes.includes(modelType);
  };

  if (!userIsAdmin) {
    return null;
  }

  return (
    <Container size="4" py="6" style={{ paddingTop: "calc(1.5rem + var(--sat, 0px))" }}>
      <Flex direction="column" gap="4">
        <Flex justify="between" align="center">
          <Box>
            <Heading size="6">API 使用配置</Heading>
            <Text color="gray" size="2">
              为每个功能配置 AI 模型和参数
            </Text>
          </Box>
          <Flex gap="2">
            <Button variant="outline" onClick={() => navigate("/")}>
              返回首页
            </Button>
            <Button onClick={saveUsageConfigs} disabled={saving || loading}>
              {saving ? "保存中..." : "保存配置"}
            </Button>
          </Flex>
        </Flex>

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

        {loading ? (
          <Card>
            <Flex justify="center" p="6">
              <Text color="gray">加载中...</Text>
            </Flex>
          </Card>
        ) : (
          <Flex direction="column" gap="4">
            {Object.entries(categories).map(([categoryKey, category]) => (
              <Card key={categoryKey}>
                <Flex direction="column" gap="3" p="2">
                  <Heading size="4">{category.label}</Heading>
                  <Flex direction="column" gap="3">
                    {category.items.map((item) => {
                      const config = configs[item.key];
                      const isImage = isImageGeneration(item.key);
                      const defaultParam = defaultParams[item.key];

                      // Type guards
                      const textConfig = !isImage ? config as TextConfig : null;
                      const imageConfig = isImage ? config as ImageConfig : null;

                      return (
                        <Box
                          key={item.key}
                          py="3"
                          px="2"
                          style={{
                            borderBottom: "1px solid var(--gray-a5)",
                            background: "var(--gray-a2)",
                            borderRadius: "var(--radius-2)",
                          }}
                        >
                          <Flex justify="between" align="start" mb="2">
                            <Box style={{ flex: 1 }}>
                              <Text size="2" weight="medium">{item.label}</Text>
                              {item.desc && (
                                <Box mt="1">
                                  {Array.isArray(item.desc) ? (
                                    item.desc.map((line, idx) => (
                                      <Text key={idx} size="1" color="gray" as="p" style={{ margin: "2px 0" }}>
                                        {line}
                                      </Text>
                                    ))
                                  ) : (
                                    <Text size="1" color="gray" as="p" style={{ margin: 0 }}>
                                      {item.desc}
                                    </Text>
                                  )}
                                </Box>
                              )}
                            </Box>
                            {defaultParam && (
                              <Button
                                size="1"
                                variant="ghost"
                                onClick={() => resetToDefault(item.key)}
                                style={{ flexShrink: 0 }}
                              >
                                重置默认
                              </Button>
                            )}
                          </Flex>
                          <Flex gap="4" wrap="wrap" align="end">
                            {/* Model Select */}
                            <Flex direction="column" gap="1">
                              <Text size="1" color="gray">模型</Text>
                              <Select.Root
                                value={config?.model || "CHAT"}
                                onValueChange={(value) => handleModelChange(item.key, value)}
                              >
                                <Select.Trigger style={{ minWidth: "130px" }} />
                                <Select.Content>
                                  {allModelTypes.map((modelType) => (
                                    <Select.Item
                                      key={modelType}
                                      value={modelType}
                                      disabled={!isModelConfigured(modelType)}
                                    >
                                      {MODEL_TYPE_LABELS[modelType] || modelType}
                                      {!isModelConfigured(modelType) && " (未配置)"}
                                    </Select.Item>
                                  ))}
                                </Select.Content>
                              </Select.Root>
                            </Flex>

                            {isImage ? (
                              /* Image Size Input for image generation */
                              <Flex direction="column" gap="1">
                                <Text size="1" color="gray">图像尺寸 (如 512x512)</Text>
                                <TextField.Root
                                  value={imageConfig?.image_size || "512x512"}
                                  onChange={(e) => handleImageSizeChange(item.key, e.target.value)}
                                  style={{ width: "120px" }}
                                  placeholder="512x512"
                                />
                              </Flex>
                            ) : (
                              <>
                                {/* Temperature Checkbox + Slider for text generation */}
                                <Flex direction="column" gap="1" style={{ minWidth: "200px" }}>
                                  <Flex gap="2" align="center">
                                    <Checkbox
                                      checked={textConfig?.use_temperature ?? false}
                                      onCheckedChange={(checked) => handleUseTemperatureChange(item.key, checked === true)}
                                    />
                                    <Text size="1" color="gray">Temperature</Text>
                                    {textConfig?.use_temperature && (
                                      <Text size="1" color="gray" ml="auto">
                                        {(textConfig?.temperature ?? 0.7).toFixed(1)}
                                      </Text>
                                    )}
                                  </Flex>
                                  {textConfig?.use_temperature && (
                                    <Slider
                                      value={[textConfig?.temperature ?? 0.7]}
                                      onValueChange={(values) => handleTemperatureChange(item.key, values[0])}
                                      min={0}
                                      max={2}
                                      step={0.1}
                                      style={{ width: "100%" }}
                                    />
                                  )}
                                </Flex>

                                {/* Max Tokens Input for text generation */}
                                <Flex direction="column" gap="1">
                                  <Text size="1" color="gray">Max Tokens</Text>
                                  <TextField.Root
                                    type="number"
                                    value={(textConfig?.max_tokens ?? 1000).toString()}
                                    onChange={(e) => handleMaxTokensChange(item.key, e.target.value)}
                                    style={{ width: "100px" }}
                                    min={1}
                                    max={128000}
                                  />
                                </Flex>
                              </>
                            )}
                          </Flex>
                        </Box>
                      );
                    })}
                  </Flex>
                </Flex>
              </Card>
            ))}

            <Card>
              <Flex direction="column" gap="2" p="2">
                <Heading size="4">已配置的模型类型</Heading>
                <Text size="2" color="gray">
                  以下模型类型已在 API Settings 中配置完成，可以使用：
                </Text>
                <Flex gap="2" wrap="wrap" pt="2">
                  {availableModelTypes.length > 0 ? (
                    availableModelTypes.map((modelType) => (
                      <Box
                        key={modelType}
                        px="3"
                        py="1"
                        style={{
                          background: "var(--accent-3)",
                          borderRadius: "var(--radius-2)",
                          fontSize: "var(--font-size-2)",
                        }}
                      >
                        {modelType}
                      </Box>
                    ))
                  ) : (
                    <Text size="2" color="red">
                      暂无配置完成的模型，请先在 API Settings 中配置
                    </Text>
                  )}
                </Flex>
              </Flex>
            </Card>
          </Flex>
        )}
      </Flex>
    </Container>
  );
}
