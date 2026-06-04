import { useState, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Box, Flex, Text, Badge, Grid } from "@radix-ui/themes";
import { ChevronDownIcon, ChevronRightIcon } from "@radix-ui/react-icons";

/* ── Markdown components (matches Module_NotesTab style) ── */

const mdComponents = {
  p: ({ children }: { children?: React.ReactNode }) => <p className="my-2 leading-relaxed text-stone-300 break-words">{children}</p>,
  ul: ({ children }: { children?: React.ReactNode }) => <ul className="my-2 space-y-1 ml-1">{children}</ul>,
  ol: ({ children }: { children?: React.ReactNode }) => <ol className="my-2 space-y-1 ml-1 list-decimal list-inside">{children}</ol>,
  li: ({ children }: { children?: React.ReactNode }) => (
    <li className="flex items-start gap-2 text-stone-300 break-words">
      <span className="text-green-500 mt-1.5 text-[6px]">●</span>
      <span className="flex-1 min-w-0">{children}</span>
    </li>
  ),
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="my-3 overflow-x-auto rounded-lg border border-gray-700">
      <table className="w-full text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }: { children?: React.ReactNode }) => <thead className="bg-gray-800 border-b border-gray-700">{children}</thead>,
  tbody: ({ children }: { children?: React.ReactNode }) => <tbody className="divide-y divide-gray-700/50">{children}</tbody>,
  tr: ({ children }: { children?: React.ReactNode }) => <tr className="hover:bg-gray-800/50 transition-colors">{children}</tr>,
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="px-3 py-2 text-left text-xs font-semibold text-green-300 uppercase tracking-wider">{children}</th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => <td className="px-3 py-2 text-stone-300 break-words">{children}</td>,
  code: ({ className, children }: { className?: string; children?: React.ReactNode }) => {
    const isInline = !className;
    return isInline ? (
      <code className="px-1.5 py-0.5 bg-gray-900 border border-gray-700 rounded text-green-300 text-xs font-mono break-all">{children}</code>
    ) : (
      <code className="block bg-gray-900 border border-gray-700 p-3 rounded my-2 text-xs font-mono text-stone-300 overflow-x-auto whitespace-pre-wrap break-words">{children}</code>
    );
  },
  pre: ({ children }: { children?: React.ReactNode }) => <pre className="bg-gray-900 border border-gray-700 rounded my-2 overflow-x-auto">{children}</pre>,
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="border-l-2 border-green-600/50 pl-3 my-3 py-1 bg-green-950/20 rounded-r text-stone-400 italic">{children}</blockquote>
  ),
  hr: () => (
    <div className="my-4 flex items-center gap-2">
      <div className="flex-1 h-px bg-gradient-to-r from-transparent via-gray-600 to-transparent" />
      <span className="text-green-600 text-xs">✦</span>
      <div className="flex-1 h-px bg-gradient-to-r from-transparent via-gray-600 to-transparent" />
    </div>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => <strong className="font-bold text-green-200">{children}</strong>,
  em: ({ children }: { children?: React.ReactNode }) => <em className="italic text-stone-400">{children}</em>,
  a: ({ children, href }: { children?: React.ReactNode; href?: string }) => <a href={href} className="text-green-400 hover:text-green-300 underline decoration-green-600/30">{children}</a>,
  img: ({ src, alt }: { src?: string; alt?: string }) => <img src={src} alt={alt || ""} className="rounded-lg max-w-full my-2" />,
  h1: ({ children }: { children?: React.ReactNode }) => <h1 className="text-base font-bold text-amber-400 mt-4 mb-2 pb-1 border-b border-amber-900/30">{children}</h1>,
  h2: ({ children }: { children?: React.ReactNode }) => <h2 className="text-sm font-bold text-amber-300 mt-3 mb-2">{children}</h2>,
  h3: ({ children }: { children?: React.ReactNode }) => <h3 className="text-sm font-semibold text-amber-200/90 mt-2 mb-1">{children}</h3>,
};

function EmptyState({ text }: { text: string }) {
  return (
    <Flex align="center" justify="center" className="py-16">
      <Text className="text-gray-600">{text}</Text>
    </Flex>
  );
}

const RARITY_COLORS: Record<string, string> = {
  common: "gray", uncommon: "green", rare: "blue",
  "very rare": "purple", legendary: "orange", artifact: "red",
};
function getRarityColor(rarity?: string): string {
  if (!rarity) return "gray";
  return RARITY_COLORS[rarity.toLowerCase()] || "gray";
}

/* ── Monsters ──────────────────────────────────────── */

function AbilityScoreGrid({ monster }: { monster: any }) {
  const md = monster.monster_data || {};
  // Try multiple sources: top-level ability_scores, monster_data.abilityScores, or flat fields in monster_data
  const scores = monster.ability_scores || md.ability_scores;
  const camel = md.abilityScores;
  const keys = ["str", "dex", "con", "int", "wis", "cha"];
  const labels = ["力量", "敏捷", "体质", "智力", "感知", "魅力"];

  // Determine score and mod for each ability
  const resolved = keys.map((key) => {
    let score: number | null = null;
    let mod: number | null = null;
    // Source 1: top-level ability_scores {str: {score, modifier}} or {str: 15}
    if (scores?.[key] != null) {
      const v = scores[key];
      score = typeof v === "object" ? v.score ?? null : v;
      mod = typeof v === "object" ? v.modifier ?? null : null;
    }
    // Source 2: monster_data.abilityScores {str: 15, strMod: 2}
    if (score == null && camel?.[key] != null) {
      score = camel[key];
      mod = camel[`${key}Mod`] ?? null;
    }
    // Source 3: flat fields in monster_data {str: 15, strMod: 2}
    if (score == null && md[key] != null && typeof md[key] === "number") {
      score = md[key];
      mod = md[`${key}Mod`] ?? null;
    }
    if (score != null && mod == null) mod = Math.floor((score - 10) / 2);
    return { score, mod };
  });

  if (resolved.every((r) => r.score == null)) return null;

  return (
    <Grid columns="6" gap="1" className="mt-2">
      {keys.map((key, i) => {
        const { score, mod } = resolved[i];
        if (score == null) return <Box key={key} />;
        return (
          <Box key={key} className="text-center bg-[#12141a] rounded py-1.5">
            <Text size="1" className="text-gray-500 block">{labels[i]}</Text>
            <Text className="text-gray-200 font-bold block">{score}</Text>
            <Text size="1" className="text-gray-400">({mod! >= 0 ? "+" : ""}{mod})</Text>
          </Box>
        );
      })}
    </Grid>
  );
}

function ActionBlock({ title, items, color }: { title: string; items: any[]; color: string }) {
  if (!items?.length) return null;
  return (
    <Box className="mt-2">
      <Text size="1" className={`font-semibold block mb-1 text-${color}-400`}>{title}</Text>
      <Box className="space-y-1">
        {items.map((a: any, i: number) => (
          <Box key={i} className="text-xs text-gray-400">
            <span className="text-gray-200 font-medium">{a.name}. </span>
            {a.description || a.desc}
          </Box>
        ))}
      </Box>
    </Box>
  );
}

export function MonstersTab({ monsters }: { monsters: any[] }) {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  if (!monsters.length) return <EmptyState text="没有怪物数据" />;
  return (
    <Box className="space-y-2">
      {monsters.map((m, i) => {
        const open = expandedId === i;
        const md = m.monster_data || {};
        const abilities = md.specialAbilities || md.special_abilities || [];
        const actions = md.actions || [];
        const legendary = md.legendaryActions || md.legendary_actions || [];
        const reactions = md.reactions || [];
        const speeds = m.speeds || md.speed || md.speeds;
        const sensesText = md.senses_text || (typeof md.senses === "string" ? md.senses : null) || m.senses;
        const languages = md.languages || m.languages;
        const desc = md.description;
        return (
          <Box key={i} className="bg-[#1a1d24] rounded-lg border border-gray-700/30 overflow-hidden">
            <Box className="p-4 flex gap-3 cursor-pointer hover:bg-[#1e2128] transition-colors"
              onClick={() => setExpandedId(open ? null : i)}>
              {m.avatar_url && <img src={m.avatar_url} alt={m.name} className="w-12 h-12 rounded-lg object-cover shrink-0" />}
              <Box className="min-w-0 flex-1">
                <Text className="text-gray-100 font-medium block truncate">{m.name_cn || m.name}</Text>
                {m.name_cn && m.name && <Text size="1" className="text-gray-500 block truncate">{m.name}</Text>}
                <Text size="1" className="text-gray-500 block truncate">
                  {[m.creature_type || md.type, m.size || md.size, m.alignment || md.alignment].filter(Boolean).join(" · ")}
                </Text>
                <Flex gap="2" className="mt-1.5" wrap="wrap">
                  {(m.challenge_rating ?? md.challenge_rating) != null && <Badge size="1" color="red" variant="soft">CR {m.challenge_rating ?? md.challenge_rating}</Badge>}
                  {(m.armor_class ?? md.armor_class) != null && <Badge size="1" color="blue" variant="soft">AC {m.armor_class ?? md.armor_class}</Badge>}
                  {(m.hit_points ?? md.hit_points) != null && <Badge size="1" color="green" variant="soft">HP {m.hit_points ?? md.hit_points}</Badge>}
                  {m.hit_dice && <Badge size="1" color="gray" variant="soft">{m.hit_dice}</Badge>}
                </Flex>
              </Box>
              <Box className="shrink-0 self-center">
                {open ? <ChevronDownIcon className="text-gray-500" /> : <ChevronRightIcon className="text-gray-500" />}
              </Box>
            </Box>
            {open && (
              <Box className="px-4 pb-4 border-t border-gray-700/30 pt-3 space-y-2">
                {/* Description */}
                {desc && (
                  <Text size="1" className="text-gray-400 block mb-1">{desc.length > 300 ? desc.slice(0, 300) + "..." : desc}</Text>
                )}
                {/* Speeds */}
                {speeds && typeof speeds === "object" && (
                  <Flex gap="2" wrap="wrap">
                    {Object.entries(speeds).map(([k, v]) => (
                      v ? <Badge key={k} size="1" variant="outline" color="cyan">{k} {String(v)}ft</Badge> : null
                    ))}
                  </Flex>
                )}
                {speeds && typeof speeds === "string" && <Text size="1" className="text-gray-400">{speeds}</Text>}
                {/* Ability scores */}
                <AbilityScoreGrid monster={m} />
                {/* Immunities / Resistances */}
                {[
                  { label: "伤害免疫", data: md.damageImmunities || md.damage_immunities, color: "red" },
                  { label: "伤害抗性", data: md.damageResistances || md.damage_resistances, color: "amber" },
                  { label: "伤害易伤", data: md.damageVulnerabilities || md.damage_vulnerabilities, color: "orange" },
                  { label: "状态免疫", data: md.conditionImmunities || md.condition_immunities, color: "purple" },
                ].map(({ label, data, color }) => {
                  if (!data || (Array.isArray(data) && !data.length)) return null;
                  const text = Array.isArray(data) ? data.join(", ") : data;
                  if (!text) return null;
                  return (
                    <Box key={label}>
                      <Text size="1" className={`text-${color}-400 font-medium`}>{label}: </Text>
                      <Text size="1" className="text-gray-400">{text}</Text>
                    </Box>
                  );
                })}
                {/* Senses / Languages */}
                {sensesText && (
                  <Box><Text size="1" className="text-gray-500">感知: </Text><Text size="1" className="text-gray-400">{sensesText}</Text></Box>
                )}
                {languages && (Array.isArray(languages) ? languages.length > 0 : true) && (
                  <Box><Text size="1" className="text-gray-500">语言: </Text><Text size="1" className="text-gray-400">{Array.isArray(languages) ? languages.join(", ") : languages}</Text></Box>
                )}
                {/* Special Abilities / Actions / Legendary / Reactions */}
                <ActionBlock title="特殊能力" items={abilities} color="purple" />
                <ActionBlock title="动作" items={actions} color="red" />
                <ActionBlock title="反应" items={reactions} color="cyan" />
                <ActionBlock title="传奇动作" items={legendary} color="amber" />
                {m.notes && (
                  <Box className="mt-2 pt-2 border-t border-gray-700/30">
                    <Text size="1" className="text-gray-500 block mb-1">备注</Text>
                    <Text size="1" className="text-gray-400">{m.notes}</Text>
                  </Box>
                )}
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

/* ── Items ─────────────────────────────────────────── */

export function ItemsTab({ items }: { items: any[] }) {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  if (!items.length) return <EmptyState text="没有物品数据" />;
  return (
    <Box className="space-y-2">
      {items.map((it, i) => {
        const open = expandedId === i;
        return (
          <Box key={i} className="bg-[#1a1d24] rounded-lg border border-gray-700/30 overflow-hidden">
            <Box className="p-4 cursor-pointer hover:bg-[#1e2128] transition-colors"
              onClick={() => setExpandedId(open ? null : i)}>
              <Flex align="center" gap="2">
                {it.avatar_url && <img src={it.avatar_url} alt={it.name} className="w-10 h-10 rounded object-cover shrink-0" />}
                <Box className="flex-1 min-w-0">
                  <Flex align="center" gap="2">
                    <Text className="text-gray-100 font-medium truncate">{it.name_cn || it.name}</Text>
                    {it.rarity && <Badge size="1" color={getRarityColor(it.rarity) as any} variant="soft" className="shrink-0">{it.rarity}</Badge>}
                  </Flex>
                  {it.name_cn && it.name && <Text size="1" className="text-gray-500 block truncate">{it.name}</Text>}
                  <Text size="1" className="text-gray-500 block truncate">
                    {[it.category, it.subcategory, it.item_type].filter(Boolean).join(" · ")}
                  </Text>
                </Box>
                <Box className="shrink-0 self-center">
                  {open ? <ChevronDownIcon className="text-gray-500" /> : <ChevronRightIcon className="text-gray-500" />}
                </Box>
              </Flex>
            </Box>
            {open && (
              <Box className="px-4 pb-4 border-t border-gray-700/30 pt-3 space-y-2">
                {/* Description first - this is the main content for most items */}
                {(it.description_cn || it.description) && (
                  <Box className="text-sm text-stone-300 break-words">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents as any}>
                      {it.description_cn || it.description}
                    </ReactMarkdown>
                  </Box>
                )}
                {/* Badge row: cost, weight, attunement, etc. */}
                <Flex gap="2" wrap="wrap">
                  {it.cost && (
                    <Badge size="1" variant="outline" color="amber">
                      {typeof it.cost === "object" ? `${it.cost.amount} ${it.cost.unit}` : it.cost}
                    </Badge>
                  )}
                  {it.weight != null && <Badge size="1" variant="outline" color="gray">{it.weight} lb</Badge>}
                  {it.magic_bonus != null && <Badge size="1" variant="soft" color="purple">+{it.magic_bonus}</Badge>}
                  {it.requires_attunement && (
                    <Badge size="1" variant="soft" color="violet">需要同调{it.attunement_by ? `（${it.attunement_by}）` : ""}</Badge>
                  )}
                  {it.quantity != null && it.quantity > 1 && <Badge size="1" variant="outline" color="gray">x{it.quantity}</Badge>}
                </Flex>
                {/* Damage */}
                {it.damage && (
                  <Box>
                    <Text size="1" className="text-red-400 font-medium">伤害: </Text>
                    <Text size="1" className="text-gray-300">
                      {typeof it.damage === "object" ? `${it.damage.dice} ${it.damage.type || ""}` : it.damage}
                    </Text>
                    {it.extra_damage && (
                      <Text size="1" className="text-red-300 ml-2">
                        + {typeof it.extra_damage === "object" ? `${it.extra_damage.dice} ${it.extra_damage.type || ""}` : it.extra_damage}
                      </Text>
                    )}
                  </Box>
                )}
                {/* Armor */}
                {it.armor_class && (
                  <Box>
                    <Text size="1" className="text-blue-400 font-medium">AC: </Text>
                    <Text size="1" className="text-gray-300">
                      {typeof it.armor_class === "object"
                        ? `${it.armor_class.base}${it.armor_class.dex_bonus ? " + DEX" : ""}${it.armor_class.max_dex_bonus != null ? `(最大 ${it.armor_class.max_dex_bonus})` : ""}`
                        : it.armor_class}
                    </Text>
                    {it.strength_requirement && <Text size="1" className="text-gray-500 ml-2">力量需求: {it.strength_requirement}</Text>}
                    {it.stealth_disadvantage && <Badge size="1" variant="soft" color="orange" className="ml-2">隐匿劣势</Badge>}
                  </Box>
                )}
                {/* Range */}
                {it.range && (
                  <Box>
                    <Text size="1" className="text-gray-500">{it.properties?.some((p: string) => p === 'thrown' || p.includes('投掷')) ? '投掷射程' : '射程'}: </Text>
                    <Text size="1" className="text-gray-300">
                      {typeof it.range === "object" ? `${it.range.normal}/${it.range.long} ft` : it.range}
                    </Text>
                  </Box>
                )}
                {/* Properties */}
                {it.properties?.length > 0 && (
                  <Flex gap="1" wrap="wrap">
                    {it.properties.map((p: any, j: number) => (
                      <Badge key={j} size="1" variant="soft" color="gray">{typeof p === "string" ? p : p.name || p}</Badge>
                    ))}
                  </Flex>
                )}
                {/* Charges */}
                {it.charges && typeof it.charges === "object" && it.charges.max && (
                  <Box>
                    <Text size="1" className="text-purple-400 font-medium">充能: </Text>
                    <Text size="1" className="text-gray-300">{it.charges.max} 次</Text>
                    {it.charges.recharge && <Text size="1" className="text-gray-500 ml-1">({typeof it.charges.recharge === "object" ? `${it.charges.recharge.time} 恢复 ${it.charges.recharge.amount}` : it.charges.recharge})</Text>}
                  </Box>
                )}
                {/* Abilities */}
                {it.abilities?.length > 0 && (
                  <Box className="mt-1">
                    <Text size="1" className="text-purple-400 font-semibold block mb-1">能力</Text>
                    {it.abilities.map((ab: any, j: number) => (
                      <Box key={j} className="text-xs text-gray-400 mb-1">
                        <span className="text-gray-200 font-medium">{ab.name}{ab.name_en ? ` (${ab.name_en})` : ""}. </span>
                        {ab.description}
                      </Box>
                    ))}
                  </Box>
                )}
                {/* Spells */}
                {it.item_spells?.length > 0 && (
                  <Box className="mt-1">
                    <Text size="1" className="text-indigo-400 font-semibold block mb-1">法术</Text>
                    <Flex gap="1" wrap="wrap">
                      {it.item_spells.map((sp: any, j: number) => (
                        <Badge key={j} size="1" variant="soft" color="indigo">{sp.name}{sp.charges ? ` (${sp.charges}次)` : ""}</Badge>
                      ))}
                    </Flex>
                  </Box>
                )}
                {/* Notes */}
                {it.notes && (
                  <Box className="mt-1 pt-1 border-t border-gray-700/30">
                    <Text size="1" className="text-gray-500 block mb-1">备注</Text>
                    <Text size="1" className="text-gray-400">{it.notes}</Text>
                  </Box>
                )}
                {/* Fallback: if nothing rendered */}
                {!it.description_cn && !it.description && !it.damage && !it.armor_class && !it.abilities?.length && !it.charges && (
                  <Text size="1" className="text-gray-600">暂无详细信息</Text>
                )}
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

/* ── Module ────────────────────────────────────────── */

function ChapterNode({ ch, index, depth = 0 }: { ch: any; index: number; depth?: number }) {
  const [expanded, setExpanded] = useState(false);
  const hasContent = !!(ch.content?.trim());
  const hasChildren = ch.children?.length > 0;
  const expandable = hasContent || hasChildren;
  return (
    <Box>
      <Box
        className={`bg-[#1a1d24] rounded-lg border border-gray-700/30 px-4 py-2.5 ${expandable ? "cursor-pointer hover:border-emerald-600/40 transition-colors" : ""}`}
        style={{ marginLeft: depth * 16 }}
        onClick={() => expandable && setExpanded(!expanded)}
      >
        <Flex align="center" gap="2">
          {expandable ? (
            expanded ? <ChevronDownIcon className="text-emerald-500 shrink-0" width={14} height={14} />
              : <ChevronRightIcon className="text-gray-500 shrink-0" width={14} height={14} />
          ) : (
            <Text size="1" className="text-emerald-500 font-mono shrink-0 w-3.5 text-center">·</Text>
          )}
          <Text size="1" className="text-emerald-500 font-mono shrink-0">{String(index + 1).padStart(2, "0")}</Text>
          <Text className="text-gray-200 truncate">{ch.title || ch.name || `第 ${index + 1} 章`}</Text>
        </Flex>
      </Box>
      {expanded && (
        <Box style={{ marginLeft: depth * 16 }}>
          {hasContent && (
            <Box className="ml-6 mr-2 my-1.5 px-4 py-3 bg-[#12141a] rounded-lg border border-gray-800/50 text-sm max-h-[32rem] overflow-y-auto leading-relaxed">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents as any}>{ch.content}</ReactMarkdown>
            </Box>
          )}
          {hasChildren && (
            <Box className="space-y-1.5 mt-1.5">
              {ch.children.map((child: any, ci: number) => (
                <ChapterNode key={ci} ch={child} index={ci} depth={depth + 1} />
              ))}
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}

export function ModuleTab({ module }: { module: { title?: string; title_en?: string; description?: string; toc?: any[]; chapters?: any[]; monsters?: any[]; items?: any[] } }) {
  const chapters = module.chapters || [];
  const toc = module.toc || [];
  return (
    <Box>
      <Box className="bg-[#1a1d24] rounded-lg border border-gray-700/30 p-4 mb-4">
        <Text className="text-gray-100 font-medium text-lg block">{module.title}</Text>
        {module.title_en && <Text size="1" className="text-gray-500 block mt-0.5">{module.title_en}</Text>}
        {module.description && <Text size="2" className="text-gray-400 block mt-2">{module.description}</Text>}
        <Flex gap="3" className="mt-3">
          <Badge size="1" color="blue" variant="soft">{chapters.length} 章节</Badge>
          <Badge size="1" color="red" variant="soft">{module.monsters?.length || 0} 怪物</Badge>
          <Badge size="1" color="amber" variant="soft">{module.items?.length || 0} 物品</Badge>
        </Flex>
      </Box>
      {chapters.length > 0 ? (
        <Box>
          <Text className="text-gray-300 font-medium block mb-3">章节列表</Text>
          <Box className="space-y-1.5">
            {chapters.map((ch: any, i: number) => <ChapterNode key={i} ch={ch} index={i} />)}
          </Box>
        </Box>
      ) : toc.length > 0 ? (
        <Box>
          <Text className="text-gray-300 font-medium block mb-3">目录</Text>
          <Box className="space-y-1.5">
            {toc.map((item: any, i: number) => (
              <Box key={i} className="bg-[#1a1d24] rounded-lg border border-gray-700/30 px-4 py-2.5">
                <Text className="text-gray-200 truncate block">{item.title || item.name || item}</Text>
              </Box>
            ))}
          </Box>
        </Box>
      ) : <EmptyState text="没有章节数据" />}
    </Box>
  );
}

/* ── Notes ─────────────────────────────────────────── */

interface NoteSection {
  level: number;
  title: string;
  content: string;
  id: string;
}

function parseMarkdownSections(content: string): NoteSection[] {
  const lines = content.split("\n");
  const sections: NoteSection[] = [];
  let current: NoteSection | null = null;
  let buf: string[] = [];
  let sid = 0;
  const flush = () => {
    if (current) { current.content = buf.join("\n").trim(); sections.push(current); buf = []; }
  };
  for (const line of lines) {
    const m = line.match(/^(#{1,3})\s+(.+)$/);
    if (m) {
      flush();
      current = { level: m[1].length, title: m[2], content: "", id: `s-${sid++}` };
    } else if (current) {
      buf.push(line);
    } else if (line.trim()) {
      current = { level: 0, title: "", content: "", id: `s-${sid++}` };
      buf.push(line);
    }
  }
  flush();
  return sections;
}

function CollapsibleNoteSection({ section }: { section: NoteSection }) {
  const [collapsed, setCollapsed] = useState(false);
  if (section.level === 0) {
    return (
      <Box className="text-sm text-stone-300 break-words">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents as any}>{section.content}</ReactMarkdown>
      </Box>
    );
  }
  const styles: Record<number, string> = {
    1: "text-base font-bold text-amber-400 pb-1 border-b border-amber-900/30",
    2: "text-sm font-bold text-amber-300",
    3: "text-sm font-semibold text-amber-200/90",
  };
  return (
    <Box className="mt-2">
      <Flex align="center" gap="1"
        className={`cursor-pointer hover:opacity-80 transition-opacity ${styles[section.level] || styles[3]}`}
        onClick={() => setCollapsed(!collapsed)}>
        {collapsed ? <ChevronRightIcon className="w-4 h-4 shrink-0" /> : <ChevronDownIcon className="w-4 h-4 shrink-0" />}
        <span>{section.title}</span>
      </Flex>
      {!collapsed && section.content && (
        <Box className="ml-5 text-sm text-stone-300 break-words">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents as any}>{section.content}</ReactMarkdown>
        </Box>
      )}
    </Box>
  );
}

export function NotesTab({ notes }: { notes: any[] }) {
  if (!notes.length) return <EmptyState text="没有笔记数据" />;
  return (
    <Box className="space-y-2">
      {notes.map((n, i) => <NotePreviewCard key={i} note={n} />)}
    </Box>
  );
}

function NotePreviewCard({ note }: { note: any }) {
  const [collapsed, setCollapsed] = useState(true);
  const title = useMemo(() => {
    if (note.title) return note.title;
    const firstLine = (note.content || "").split("\n")[0];
    const clean = firstLine.replace(/^#+\s*/, "").replace(/\*\*/g, "");
    return clean.length > 60 ? clean.slice(0, 60) + "..." : clean || "（空笔记）";
  }, [note.title, note.content]);
  const sections = useMemo(() => note.content ? parseMarkdownSections(note.content) : [], [note.content]);

  return (
    <Box className="bg-[#1a1d24] rounded-lg border border-gray-700/30 overflow-hidden">
      <Flex align="center" gap="2" className="px-4 py-2.5 cursor-pointer hover:bg-[#1e2128] transition-colors"
        onClick={() => setCollapsed(!collapsed)}>
        {collapsed
          ? <ChevronRightIcon className="w-4 h-4 text-gray-400 shrink-0" />
          : <ChevronDownIcon className="w-4 h-4 text-gray-400 shrink-0" />}
        <Text size="2" className="text-gray-200 truncate flex-1">{title}</Text>
      </Flex>
      {!collapsed && (
        <Box className="px-4 pb-3 border-t border-gray-700/50 break-words">
          {sections.length > 0 ? (
            <Box className="mt-2">
              {sections.map((s) => <CollapsibleNoteSection key={s.id} section={s} />)}
            </Box>
          ) : (
            <Text size="2" className="text-gray-500 block mt-2">（空笔记）</Text>
          )}
        </Box>
      )}
    </Box>
  );
}
