import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import classesData from "~/data/rules/classes.json";

export default function TestClassFeatures() {
  const [showAllLevelsDialog, setShowAllLevelsDialog] = useState<string | null>(null);
  const classes = classesData.classes;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold text-amber-400 mb-8">职业特性测试页面</h1>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {classes.map((cls: any) => {
            const levelCount = new Set(cls.features.map((f: any) => f.level)).size;
            const featureCount = cls.features.length;
            
            return (
              <div key={cls.id} className="bg-gray-900 border-2 border-gray-700 rounded-lg p-6">
                <h2 className="text-2xl font-bold text-amber-400 mb-2">{cls.name}</h2>
                <p className="text-sm text-gray-400 mb-4">{cls.nameEn}</p>
                
                <div className="space-y-2 mb-4">
                  <div className="text-sm">
                    <span className="text-gray-400">等级覆盖：</span>
                    <span className={`ml-2 font-bold ${levelCount === 20 ? 'text-green-400' : 'text-yellow-400'}`}>
                      {levelCount}/20
                    </span>
                  </div>
                  <div className="text-sm">
                    <span className="text-gray-400">特性总数：</span>
                    <span className="ml-2 font-bold text-blue-400">{featureCount}</span>
                  </div>
                </div>
                
                <button
                  onClick={() => setShowAllLevelsDialog(cls.id)}
                  className="w-full px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg transition-colors font-medium"
                >
                  查看所有等级特性 →
                </button>
              </div>
            );
          })}
        </div>

        {/* 查看所有等级对话框 */}
        {showAllLevelsDialog && (
          <Dialog.Root open={!!showAllLevelsDialog} onOpenChange={() => setShowAllLevelsDialog(null)}>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 bg-black/80 z-50" />
              <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gray-900 border-2 border-amber-400 rounded-lg shadow-2xl w-[90vw] max-w-4xl max-h-[85dvh] overflow-hidden z-50 flex flex-col">
                <div className="p-6 border-b border-gray-700 flex items-center justify-between">
                  <Dialog.Title className="text-2xl font-bold text-amber-400">
                    {classes.find(c => c.id === showAllLevelsDialog)?.name} - 所有等级特性
                  </Dialog.Title>
                  <Dialog.Close className="text-gray-400 hover:text-gray-200 transition-colors">
                    <span className="text-2xl">×</span>
                  </Dialog.Close>
                </div>
                
                <div className="flex-1 overflow-y-auto p-6">
                  <div className="space-y-6">
                    {Array.from({ length: 20 }, (_, i) => i + 1).map(level => {
                      const levelFeatures = classes
                        .find(c => c.id === showAllLevelsDialog)
                        ?.features.filter((f: any) => f.level === level) || [];
                      
                      if (levelFeatures.length === 0) {
                        return (
                          <div key={level} className="bg-red-900/20 rounded-lg p-4 border border-red-700">
                            <h3 className="text-lg font-bold text-red-400 flex items-center gap-2">
                              <span className="bg-red-400 text-gray-900 px-2 py-1 rounded text-sm">
                                {level}级
                              </span>
                              <span className="text-sm">⚠️ 缺失特性</span>
                            </h3>
                          </div>
                        );
                      }
                      
                      return (
                        <div key={level} className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
                          <h3 className="text-lg font-bold text-amber-400 mb-3 flex items-center gap-2">
                            <span className="bg-amber-400 text-gray-900 px-2 py-1 rounded text-sm">
                              {level}级
                            </span>
                            <span className="text-xs text-gray-500">
                              ({levelFeatures.length} 个特性)
                            </span>
                          </h3>
                          <div className="space-y-3">
                            {levelFeatures.map((feature: any, idx: number) => (
                              <div key={idx} className="bg-gray-900/50 rounded p-3">
                                <div className="font-semibold text-amber-300 mb-1">
                                  {feature.name}
                                  {feature.nameEn && (
                                    <span className="text-xs text-gray-500 ml-2">({feature.nameEn})</span>
                                  )}
                                </div>
                                <div className="text-sm text-gray-300 whitespace-pre-wrap">
                                  {feature.description}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="p-4 border-t border-gray-700 flex justify-between items-center">
                  <div className="text-sm text-gray-400">
                    总计: {classes.find(c => c.id === showAllLevelsDialog)?.features.length} 个特性
                  </div>
                  <Dialog.Close asChild>
                    <button className="px-6 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors">
                      关闭
                    </button>
                  </Dialog.Close>
                </div>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        )}
      </div>
    </div>
  );
}

