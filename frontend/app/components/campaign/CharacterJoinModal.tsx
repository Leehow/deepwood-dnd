import * as Dialog from "@radix-ui/react-dialog";
import racesData from "~/data/rules/races.json";
import classesData from "~/data/rules/classes_with_structured_subclass_features.json";

interface CharacterJoinModalProps {
  open: boolean;
  onClose: () => void;
  characters: any[];
  isLoading: boolean;
  onSelectCharacter: (characterId: string) => void;
  onCreateCharacter: () => void;
}

export function CharacterJoinModal({
  open,
  onClose,
  characters,
  isLoading,
  onSelectCharacter,
  onCreateCharacter,
}: CharacterJoinModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-50 animate-fade-in" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[90vw] max-w-md rounded-xl overflow-hidden"
          style={{
            background: 'linear-gradient(180deg, #1a1d24 0%, #13151a 100%)',
            border: '1px solid rgba(212, 175, 55, 0.2)',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.8), inset 0 1px 0 rgba(255, 255, 255, 0.05)',
          }}
        >
          {/* Header */}
          <div
            className="px-5 py-4"
            style={{
              background: 'linear-gradient(180deg, rgba(212, 175, 55, 0.08) 0%, transparent 100%)',
              borderBottom: '1px solid rgba(212, 175, 55, 0.1)',
            }}
          >
            <Dialog.Title className="m-0">
              <div className="flex items-center gap-3">
                <span className="text-2xl">⚔️</span>
                <div>
                  <h2 className="text-lg font-bold text-white" style={{ fontFamily: 'Georgia, serif' }}>
                    选择你的冒险者
                  </h2>
                  <p className="text-xs text-gray-400 mt-0.5">选择一位角色加入战役</p>
                </div>
              </div>
            </Dialog.Title>
          </div>

          {/* Character List */}
          <div className="px-5 py-3 max-h-[50vh] overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                <span className="ml-2 text-sm text-gray-400">加载角色中...</span>
              </div>
            ) : characters.length === 0 ? (
              <div className="text-center py-8">
                <div className="text-4xl mb-3">🎭</div>
                <p className="text-gray-300 font-medium mb-1">还没有角色</p>
                <p className="text-xs text-gray-500">创建一位角色开始你的冒险吧</p>
              </div>
            ) : (
              <div className="space-y-2">
                {characters.map((char: any) => {
                  const race = racesData.races.find((r: any) => r.id === char.race_id);
                  const charClass = classesData.classes.find((c: any) => c.id === char.class_id);
                  return (
                    <button
                      key={char.id}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg bg-gray-800/50 border border-gray-700/50 hover:border-amber-500/40 hover:bg-gray-800 transition-all text-left group"
                      onClick={() => onSelectCharacter(char.id.toString())}
                    >
                      {/* Avatar */}
                      <div className="w-10 h-10 rounded-full bg-gray-700 flex-shrink-0 overflow-hidden border border-gray-600 group-hover:border-amber-500/50 transition-colors">
                        {char.avatar ? (
                          <img src={char.avatar} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-lg text-gray-500">
                            🧙
                          </div>
                        )}
                      </div>
                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-200 group-hover:text-amber-400 transition-colors truncate">
                          {char.name}
                        </div>
                        <div className="text-xs text-gray-500">
                          {race?.name || char.race_id} · {charClass?.name || char.class_id} · {char.level}级
                        </div>
                      </div>
                      {/* Arrow */}
                      <span className="text-gray-600 group-hover:text-amber-500/60 transition-colors text-sm">
                        ›
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          <div
            className="px-5 py-3 flex gap-2"
            style={{ borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}
          >
            <button
              className="flex-1 fantasy-btn-primary text-sm py-2"
              onClick={onCreateCharacter}
            >
              创建新角色
            </button>
            <button
              className="flex-1 fantasy-btn text-sm py-2"
              onClick={onClose}
            >
              👁️ 旁观模式
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
