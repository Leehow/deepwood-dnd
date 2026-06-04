import { useState, useCallback, useRef } from "react";
import { Dialog, Button, Text, Flex, Box, Badge, Separator, IconButton } from "@radix-ui/themes";
import { Cross2Icon, UploadIcon } from "@radix-ui/react-icons";
import { apiFetch } from "~/utils/api-client";

interface CharacterImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCharacterCreated: (character: any) => Promise<boolean>;
}

const ACCEPTED_EXTENSIONS = ".pdf,.md,.txt,.docx,.xlsx";
const MAX_SIZE_MB = 20;

export function CharacterImportDialog({ open, onOpenChange, onCharacterCreated }: CharacterImportDialogProps) {
  const [step, setStep] = useState<"upload" | "preview">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [parsed, setParsed] = useState<any>(null);
  const [editName, setEditName] = useState("");
  const [editLevel, setEditLevel] = useState(1);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setStep("upload");
    setFile(null);
    setParsing(false);
    setImporting(false);
    setError("");
    setParsed(null);
  }, []);

  const handleOpenChange = useCallback((v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  }, [onOpenChange, reset]);

  const handleFileSelect = useCallback((f: File) => {
    if (f.size > MAX_SIZE_MB * 1024 * 1024) {
      setError(`文件过大，最大支持 ${MAX_SIZE_MB}MB`);
      return;
    }
    setFile(f);
    setError("");
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) handleFileSelect(f);
  }, [handleFileSelect]);

  const handleParse = useCallback(async () => {
    if (!file) return;
    setParsing(true);
    setError("");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await apiFetch("/api/characters/import-card", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "解析失败");
      }

      const data = await res.json();
      setParsed(data.parsed_character);
      setEditName(data.parsed_character.name || "");
      setEditLevel(data.parsed_character.level || 1);
      setStep("preview");
    } catch (e: any) {
      setError(e.message || "解析过程出错");
    } finally {
      setParsing(false);
    }
  }, [file]);

  const handleConfirmImport = useCallback(async () => {
    if (!parsed) return;
    setImporting(true);

    // Build character data for POST /api/characters
    const charData: any = {
      name: editName || parsed.name,
      level: editLevel,
      race_id: parsed.raceId,
      subrace_id: parsed.subraceId || undefined,
      class_id: parsed.classId,
      subclass_id: parsed.subclassId || undefined,
      background_id: parsed.backgroundId || undefined,
      alignment: parsed.alignment || "neutral",
      ability_scores: parsed.abilityScores,
      hp: parsed.hp || 0,
      selectedSkills: parsed.selectedSkills || [],
      selectedCantrips: parsed.selectedCantrips || [],
      selectedSpells: parsed.selectedSpells || [],
      equipment: parsed.equipment || [],
      currency: parsed.currency,
      backstory: parsed.backstory || "",
      feats: parsed.feats || [],
    };

    if (parsed.appearance) {
      charData.age = parsed.appearance.age || "";
      charData.height = parsed.appearance.height || "";
      charData.weight = parsed.appearance.weight || "";
      charData.eyes = parsed.appearance.eyes || "";
      charData.skin = parsed.appearance.skin || "";
      charData.hair = parsed.appearance.hair || "";
    }

    if (parsed.personality) {
      charData.personality_traits = parsed.personality.traits || "";
      charData.ideals = parsed.personality.ideals || "";
      charData.bonds = parsed.personality.bonds || "";
      charData.flaws = parsed.personality.flaws || "";
    }

    const success = await onCharacterCreated(charData);
    setImporting(false);
    if (success) {
      handleOpenChange(false);
    }
  }, [parsed, editName, editLevel, onCharacterCreated, handleOpenChange]);

  const abilities = parsed?.abilityScores || {};
  const abilityLabels: Record<string, string> = {
    strength: "力量", dexterity: "敏捷", constitution: "体质",
    intelligence: "智力", wisdom: "感知", charisma: "魅力",
  };

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Content
        aria-describedby={undefined}
        className="bg-gray-900 border border-gray-700 max-w-[640px] w-full"
      >
        <Flex justify="between" align="center" mb="4">
          <Dialog.Title className="text-lg font-bold text-amber-400 m-0">
            {step === "upload" ? "导入角色卡" : "确认导入"}
          </Dialog.Title>
          <IconButton variant="ghost" color="gray" size="1" onClick={() => handleOpenChange(false)}>
            <Cross2Icon />
          </IconButton>
        </Flex>

        {step === "upload" && (
          <Box>
            {/* Drop zone */}
            <Box
              className="border-2 border-dashed border-gray-600 rounded-lg p-8 text-center cursor-pointer hover:border-amber-500/50 transition-colors"
              onClick={() => fileInputRef.current?.click()}
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_EXTENSIONS}
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
              />
              <UploadIcon width="32" height="32" className="mx-auto mb-3 text-gray-500" />
              <Text as="p" size="3" className="text-gray-300 mb-1">
                {file ? file.name : "点击或拖拽文件到此处"}
              </Text>
              <Text as="p" size="1" color="gray">
                支持 PDF, Markdown, TXT, DOCX, XLSX（最大 {MAX_SIZE_MB}MB）
              </Text>
            </Box>

            {file && (
              <Flex align="center" gap="2" mt="3" className="bg-gray-800 rounded px-3 py-2">
                <Badge color="amber">{file.name.split(".").pop()?.toUpperCase()}</Badge>
                <Text size="2" className="text-gray-300 flex-1 truncate">{file.name}</Text>
                <Text size="1" color="gray">{(file.size / 1024).toFixed(0)} KB</Text>
              </Flex>
            )}

            {error && (
              <Text as="p" size="2" color="red" mt="3">{error}</Text>
            )}

            <Flex gap="3" mt="5" justify="end">
              <Button variant="soft" color="gray" onClick={() => handleOpenChange(false)}>取消</Button>
              <Button
                variant="solid"
                color="amber"
                disabled={!file || parsing}
                onClick={handleParse}
              >
                {parsing ? "解析中..." : "开始解析"}
              </Button>
            </Flex>
          </Box>
        )}

        {step === "preview" && parsed && (
          <Box>
            {/* Warnings */}
            {parsed.parseWarnings?.length > 0 && (
              <Box className="bg-amber-900/20 border border-amber-700/50 rounded-lg p-3 mb-4">
                <Text size="2" weight="bold" className="text-amber-400 block mb-1">
                  解析提示
                </Text>
                {parsed.parseWarnings.map((w: string, i: number) => (
                  <Text key={i} as="p" size="1" className="text-amber-300/80">- {w}</Text>
                ))}
              </Box>
            )}

            {/* Basic info */}
            <Box className="space-y-3">
              <Flex gap="3" align="end">
                <Box className="flex-1">
                  <Text as="label" size="1" color="gray" className="block mb-1">角色名</Text>
                  <input
                    className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-white"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                  />
                </Box>
                <Box>
                  <Text as="label" size="1" color="gray" className="block mb-1">等级</Text>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    className="w-20 bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-white"
                    value={editLevel}
                    onChange={(e) => setEditLevel(Math.max(1, Math.min(20, Number(e.target.value))))}
                  />
                </Box>
              </Flex>

              <Flex gap="2" wrap="wrap">
                {parsed.raceId && <Badge color="blue">{parsed.raceId}{parsed.subraceId ? ` (${parsed.subraceId})` : ""}</Badge>}
                {parsed.classId && <Badge color="green">{parsed.classId}{parsed.subclassId ? ` (${parsed.subclassId})` : ""}</Badge>}
                {parsed.backgroundId && <Badge color="purple">{parsed.backgroundId}</Badge>}
                {parsed.alignment && <Badge color="gray">{parsed.alignment}</Badge>}
              </Flex>

              <Separator size="4" />

              {/* Ability scores */}
              <Box>
                <Text size="2" weight="bold" className="text-gray-300 block mb-2">属性值</Text>
                <div className="grid grid-cols-6 gap-2">
                  {Object.entries(abilityLabels).map(([key, label]) => (
                    <Box key={key} className="text-center bg-gray-800 rounded p-2">
                      <Text size="1" color="gray" className="block">{label}</Text>
                      <Text size="4" weight="bold" className="text-white">{abilities[key] ?? "—"}</Text>
                    </Box>
                  ))}
                </div>
              </Box>

              {/* Skills */}
              {parsed.selectedSkills?.length > 0 && (
                <Box>
                  <Text size="2" weight="bold" className="text-gray-300 block mb-1">技能</Text>
                  <Flex gap="1" wrap="wrap">
                    {parsed.selectedSkills.map((s: string) => (
                      <Badge key={s} size="1" variant="soft" color="cyan">{s}</Badge>
                    ))}
                  </Flex>
                </Box>
              )}

              {/* Spells */}
              {(parsed.selectedCantrips?.length > 0 || parsed.selectedSpells?.length > 0) && (
                <Box>
                  <Text size="2" weight="bold" className="text-gray-300 block mb-1">法术</Text>
                  <Flex gap="1" wrap="wrap">
                    {(parsed.selectedCantrips || []).map((s: string) => (
                      <Badge key={s} size="1" variant="soft" color="violet">{s}</Badge>
                    ))}
                    {(parsed.selectedSpells || []).map((s: string) => (
                      <Badge key={s} size="1" variant="soft" color="indigo">{s}</Badge>
                    ))}
                  </Flex>
                </Box>
              )}

              {/* Equipment */}
              {parsed.equipment?.length > 0 && (
                <Box>
                  <Text size="2" weight="bold" className="text-gray-300 block mb-1">装备</Text>
                  <Flex gap="1" wrap="wrap">
                    {parsed.equipment.map((e: any, i: number) => (
                      <Badge key={i} size="1" variant="soft" color="orange">
                        {e.name || e.id}{e.quantity > 1 ? ` x${e.quantity}` : ""}
                      </Badge>
                    ))}
                  </Flex>
                </Box>
              )}

              {/* Backstory */}
              {parsed.backstory && (
                <Box>
                  <Text size="2" weight="bold" className="text-gray-300 block mb-1">背景故事</Text>
                  <Text as="p" size="1" color="gray" className="line-clamp-3">{parsed.backstory}</Text>
                </Box>
              )}
            </Box>

            {error && (
              <Text as="p" size="2" color="red" mt="3">{error}</Text>
            )}

            <Flex gap="3" mt="5" justify="end">
              <Button variant="soft" color="gray" onClick={reset}>重新上传</Button>
              <Button
                variant="solid"
                color="amber"
                disabled={importing || !editName}
                onClick={handleConfirmImport}
              >
                {importing ? "导入中..." : "确认导入"}
              </Button>
            </Flex>
          </Box>
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
}
