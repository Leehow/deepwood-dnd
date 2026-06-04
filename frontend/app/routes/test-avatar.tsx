import { useState } from "react";
import { Button, Flex, Text, Card, Box } from "@radix-ui/themes";
import { apiFetch } from "~/utils/api-client";
import { getCurrentUserId } from "~/utils/user";
import { createLogger } from '~/utils/logger';
const logger = createLogger('test-avatar');


export default function TestAvatar() {
  const [loading, setLoading] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generateAvatar = async () => {
    setLoading(true);
    setError(null);
    setAvatarUrl(null);

    try {
      const response = await apiFetch("/api/ai-settings/generate-avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: getCurrentUserId(),
          race: "人类",
          character_class: "战士",
          gender: "男性",
          name: "格雷戈",
          appearance_description: "强壮的体格，短发，坚毅的眼神，身穿重甲",
          personality_traits: ["勇敢", "忠诚", "正直"],
          background: "士兵"
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || "头像生成失败");
      }

      const data = await response.json();
      logger.debug("Avatar generated:", data);
      
      if (data.success && data.image) {
        setAvatarUrl(data.image);
      } else {
        throw new Error("未返回图像数据");
      }
    } catch (err) {
      logger.error("Avatar generation error:", err);
      setError(err instanceof Error ? err.message : "头像生成失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Flex direction="column" gap="4" p="6" style={{ maxWidth: "800px", margin: "0 auto" }}>
      <Text size="8" weight="bold">AI头像生成测试</Text>
      
      <Card>
        <Flex direction="column" gap="4">
          <Text size="4" weight="medium">测试角色信息：</Text>
          <Box>
            <Text size="2" color="gray">
              • 姓名：格雷戈<br />
              • 种族：人类<br />
              • 职业：战士<br />
              • 性别：男性<br />
              • 外貌：强壮的体格，短发，坚毅的眼神，身穿重甲<br />
              • 性格：勇敢、忠诚、正直<br />
              • 背景：士兵
            </Text>
          </Box>
          
          <Button 
            onClick={generateAvatar} 
            disabled={loading}
            size="3"
          >
            {loading ? "生成中..." : "生成AI头像"}
          </Button>
          
          {error && (
            <Card style={{ backgroundColor: "var(--red-3)", borderColor: "var(--red-7)" }}>
              <Text color="red" size="2">错误：{error}</Text>
            </Card>
          )}
          
          {avatarUrl && (
            <Flex direction="column" gap="2">
              <Text size="4" weight="medium">生成的头像：</Text>
              <Box style={{ 
                width: "512px", 
                height: "512px", 
                border: "2px solid var(--gray-6)",
                borderRadius: "8px",
                overflow: "hidden"
              }}>
                <img 
                  src={avatarUrl} 
                  alt="Generated Avatar" 
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              </Box>
              <Text size="2" color="gray">
                图像大小：{Math.round(avatarUrl.length / 1024)} KB
              </Text>
            </Flex>
          )}
        </Flex>
      </Card>
    </Flex>
  );
}
