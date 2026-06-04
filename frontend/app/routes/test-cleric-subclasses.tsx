import classesData from "~/data/rules/classes.json";

export default function TestClericSubclasses() {
  const cleric = classesData.classes.find((c: any) => c.id === "cleric");
  
  if (!cleric) {
    return <div className="p-8">找不到牧师数据</div>;
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-amber-400 mb-8">牧师子职业测试</h1>
        
        <div className="bg-gray-800/50 rounded-lg p-6 mb-6">
          <h2 className="text-xl font-semibold text-amber-300 mb-4">
            子职业总数: {cleric.subclasses?.length || 0}
          </h2>
          
          <div className="space-y-4">
            {cleric.subclasses?.map((subclass: any) => (
              <div key={subclass.id} className="bg-gray-900/50 rounded-lg p-4 border border-gray-700">
                <div className="flex items-baseline gap-3 mb-2">
                  <span className="text-lg font-semibold text-white">{subclass.name}</span>
                  <span className="text-sm text-gray-500">{subclass.nameEn}</span>
                  <span className="text-xs text-gray-600">ID: {subclass.id}</span>
                </div>
                
                <p className="text-sm text-gray-300 mb-3">{subclass.description}</p>
                
                {subclass.featureChoices && (
                  <div className="bg-amber-900/20 border border-amber-700/30 rounded p-3 mt-3">
                    <div className="text-xs font-semibold text-amber-400 mb-2">
                      ✓ 有 featureChoices
                    </div>
                    {subclass.featureChoices.map((fc: any, idx: number) => (
                      <div key={idx} className="text-xs text-gray-300">
                        <div className="font-medium text-amber-300">
                          {fc.featureName} - {fc.featureNameEn}
                        </div>
                        <div className="ml-3 mt-1 space-y-1">
                          {fc.choices.map((choice: any, cIdx: number) => (
                            <div key={cIdx} className="text-gray-400">
                              • {choice.description} (类型: {choice.type}, 数量: {choice.count})
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                
                {!subclass.featureChoices && (
                  <div className="bg-gray-800/50 border border-gray-600 rounded p-2 mt-3">
                    <div className="text-xs text-gray-500">
                      ✗ 没有 featureChoices（这是正常的，该领域在1级不需要玩家做选择）
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
        
        <div className="bg-blue-900/20 border border-blue-700/30 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-blue-400 mb-2">说明</h3>
          <ul className="text-xs text-gray-300 space-y-1">
            <li>• 只有<strong>知识领域</strong>在1级需要玩家做选择（2门语言 + 2项技能）</li>
            <li>• 其他领域在1级都是自动获得能力，不需要选择</li>
            <li>• 所有领域都应该可以正常选择，如果某个领域选不了，可能是前端UI的问题</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

