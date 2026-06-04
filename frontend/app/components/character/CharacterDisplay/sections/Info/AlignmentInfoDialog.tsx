import * as Dialog from "@radix-ui/react-dialog";

interface AlignmentInfoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentAlignment?: string;
}

const alignments = [
  {
    id: "lawful-good",
    name: "守序善良",
    nameEn: "Lawful Good (LG)",
    shortName: "LG",
    description: "守序善良的生物会尽其所能按照社会期许行事。金龙、圣武士和大部分矮人都属守序善良阵营。",
    traits: [
      "遵守法律和传统",
      "帮助需要帮助的人",
      "将荣誉置于个人利益之上",
      "相信秩序和善良结合能创造最好的社会"
    ]
  },
  {
    id: "neutral-good",
    name: "中立善良",
    nameEn: "Neutral Good (NG)",
    shortName: "NG",
    description: "中立善良的生物会尽力行善，但不会特别偏好秩序或混乱。许多天界生物、部分云巨人和大部分侏儒属于中立善良阵营。",
    traits: [
      "尽力做正确的事",
      "不受法律或传统束缚",
      "灵活应对不同情况",
      "以最好的方式帮助他人"
    ]
  },
  {
    id: "chaotic-good",
    name: "混乱善良",
    nameEn: "Chaotic Good (CG)",
    shortName: "CG",
    description: "混乱善良的生物会按自己的良心行事，几乎不顾他人的期许。铜龙、许多精灵和独角兽都属混乱善良阵营。",
    traits: [
      "重视个人自由和善良",
      "反对压迫和暴政",
      "不喜欢规则和限制",
      "相信每个人都应自由地行善"
    ]
  },
  {
    id: "lawful-neutral",
    name: "守序中立",
    nameEn: "Lawful Neutral (LN)",
    shortName: "LN",
    description: "守序中立的个体会按照法律、传统或个人守则行事。许多僧侣和部分法师属守序中立阵营。",
    traits: [
      "严格遵守规则和传统",
      "认为秩序是社会的基础",
      "不偏向善良或邪恶",
      "重视可靠性和纪律"
    ]
  },
  {
    id: "true-neutral",
    name: "绝对中立",
    nameEn: "True Neutral (N)",
    shortName: "N",
    description: "绝对中立是那些不会对道德或秩序特别偏好的阵营。许多德鲁伊和普通人属绝对中立阵营。",
    traits: [
      "在善恶、秩序混乱间保持平衡",
      "优先考虑自然和平衡",
      "不受意识形态束缚",
      "根据具体情况做决定"
    ]
  },
  {
    id: "chaotic-neutral",
    name: "混乱中立",
    nameEn: "Chaotic Neutral (CN)",
    shortName: "CN",
    description: "混乱中立的生物追随自己的心意，完全自我为中心。许多野蛮人和游荡者，以及部分吟游诗人属混乱中立阵营。",
    traits: [
      "重视个人自由高于一切",
      "反抗权威和限制",
      "不可预测和冲动",
      "追随自己的欲望"
    ]
  },
  {
    id: "lawful-evil",
    name: "守序邪恶",
    nameEn: "Lawful Evil (LE)",
    shortName: "LE",
    description: "守序邪恶的生物会在自己的能力范围内，有条理地获取自己想要的东西。魔鬼、蓝龙和霍布地精都属守序邪恶阵营。",
    traits: [
      "利用法律和秩序谋取私利",
      "重视传统和等级制度",
      "有组织有计划地作恶",
      "遵守承诺（出于利益考虑）"
    ]
  },
  {
    id: "neutral-evil",
    name: "中立邪恶",
    nameEn: "Neutral Evil (NE)",
    shortName: "NE",
    description: "中立邪恶是那些会做任何能让自己脱身的事的阵营。许多卓尔、部分云巨人和豺狼人属中立邪恶阵营。",
    traits: [
      "纯粹的自私自利",
      "不受道德或法律约束",
      "为达目的不择手段",
      "不在乎他人的死活"
    ]
  },
  {
    id: "chaotic-evil",
    name: "混乱邪恶",
    nameEn: "Chaotic Evil (CE)",
    shortName: "CE",
    description: "混乱邪恶的生物会肆意妄为，只受自己的贪欲、仇恨或嗜血驱使。恶魔、红龙和兽人都属混乱邪恶阵营。",
    traits: [
      "暴力和破坏性",
      "不可预测且危险",
      "蔑视一切规则和生命",
      "为混乱和毁灭而狂喜"
    ]
  }
];

export function AlignmentInfoDialog({ open, onOpenChange, currentAlignment }: AlignmentInfoDialogProps) {
  // 优先精确匹配 shortName 或 name，避免 includes 误匹配
  const current = alignments.find(a =>
    a.shortName === currentAlignment ||
    a.name === currentAlignment
  ) || alignments.find(a =>
    a.nameEn.toLowerCase().includes(currentAlignment?.toLowerCase() || "")
  );

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/70 z-[10198]" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gray-800 border border-gray-700 rounded-lg shadow-2xl z-[10200] w-[95vw] max-w-4xl max-h-[85dvh] overflow-y-auto p-6">
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-xl font-semibold text-amber-400">
              阵营系统
            </Dialog.Title>
            <Dialog.Close className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-gray-700/50 hover:bg-gray-600/50 text-gray-400 hover:text-white transition-colors">
              ✕
            </Dialog.Close>
          </div>

          {/* Current Alignment Highlight */}
          {current && (
            <div className="mb-6 p-4 bg-amber-900/20 border border-amber-700 rounded-lg">
              <h3 className="text-lg font-semibold text-amber-300 mb-2">
                当前阵营：{current.name} ({current.shortName})
              </h3>
              <p className="text-sm text-gray-300 mb-3">{current.description}</p>
              <div className="space-y-1">
                <div className="text-xs font-semibold text-gray-400">特征：</div>
                {current.traits.map((trait, idx) => (
                  <div key={idx} className="text-sm text-gray-300 flex items-start gap-2">
                    <span className="text-amber-400">•</span>
                    <span>{trait}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Overview */}
          <div className="mb-6">
            <h3 className="text-lg font-semibold text-gray-300 mb-2">什么是阵营？</h3>
            <p className="text-sm text-gray-400 leading-relaxed">
              阵营是描述生物道德和个人态度的组合。阵营由两个因素组合而成：一个指明道德观（善良、邪恶或中立），另一个描述其对社会和秩序的态度（守序、混乱或中立）。
            </p>
          </div>

          {/* All Alignments Grid */}
          <div>
            <h3 className="text-lg font-semibold text-gray-300 mb-3">九种阵营</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {alignments.map((alignment) => (
                <div
                  key={alignment.id}
                  className={`p-3 rounded border ${
                    alignment.name === current?.name
                      ? "bg-amber-900/30 border-amber-600"
                      : "bg-gray-900/50 border-gray-700 hover:border-gray-600"
                  } transition-colors`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-semibold text-white">{alignment.name}</h4>
                    <span className="text-xs text-gray-500">{alignment.shortName}</span>
                  </div>
                  <p className="text-xs text-gray-400 mb-2">{alignment.description}</p>
                  <div className="space-y-0.5">
                    {alignment.traits.slice(0, 2).map((trait, idx) => (
                      <div key={idx} className="text-xs text-gray-500 flex items-start gap-1">
                        <span className="text-amber-500">•</span>
                        <span>{trait}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Alignment Grid Visual */}
          <div className="mt-6 p-4 bg-gray-900/50 rounded-lg">
            <h4 className="text-sm font-semibold text-gray-300 mb-3 text-center">阵营九宫格</h4>
            <div className="grid grid-cols-3 gap-2 max-w-2xl mx-auto">
              {[
                ["守序善良\n(LG)", "中立善良\n(NG)", "混乱善良\n(CG)"],
                ["守序中立\n(LN)", "绝对中立\n(N)", "混乱中立\n(CN)"],
                ["守序邪恶\n(LE)", "中立邪恶\n(NE)", "混乱邪恶\n(CE)"]
              ].map((row, rowIdx) => (
                row.map((cell, colIdx) => (
                  <div
                    key={`${rowIdx}-${colIdx}`}
                    className={`p-3 text-center rounded text-xs whitespace-pre-line ${
                      cell.includes(current?.shortName || "")
                        ? "bg-amber-600 text-white font-semibold"
                        : "bg-gray-800 text-gray-400"
                    }`}
                  >
                    {cell}
                  </div>
                ))
              ))}
            </div>
            <div className="mt-3 text-xs text-gray-500 text-center">
              <div className="flex justify-between items-center max-w-2xl mx-auto">
                <span>← 守序</span>
                <span>混乱 →</span>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-6">
            <Dialog.Close className="btn-secondary text-sm">关闭</Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
