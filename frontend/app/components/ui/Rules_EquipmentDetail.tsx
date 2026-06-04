// Equipment detail rendering for Rules Panel
import { translateId } from "./Rules_Types";

// Render equipment details
export function renderEquipmentDetail(eqData: any): React.ReactNode {
  return (
    <div className="space-y-6">
      {/* Basic Info */}
      <div>
        <h3 className="text-lg font-semibold text-slate-400 mb-2">{eqData.name}</h3>
        <p className="text-sm text-gray-400 italic mb-2">{eqData.nameEn}</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-4">
        {eqData.type && (
          <div>
            <div className="text-sm text-gray-500">类型</div>
            <div className="text-base text-slate-300">{translateId(eqData.type)}</div>
          </div>
        )}
        {eqData.ac && (
          <div>
            <div className="text-sm text-gray-500">护甲等级</div>
            <div className="text-base text-blue-400">{eqData.ac}</div>
          </div>
        )}
        {eqData.damage && (
          <div>
            <div className="text-sm text-gray-500">伤害</div>
            <div className="text-base text-red-400">{eqData.damage}</div>
          </div>
        )}
        {eqData.damageType && (
          <div>
            <div className="text-sm text-gray-500">伤害类型</div>
            <div className="text-base text-red-300">{eqData.damageType}</div>
          </div>
        )}
        {eqData.weight !== undefined && (
          <div>
            <div className="text-sm text-gray-500">重量</div>
            <div className="text-base text-gray-300">{eqData.weight} 磅</div>
          </div>
        )}
        {eqData.cost && (
          <div>
            <div className="text-sm text-gray-500">价格</div>
            <div className="text-base text-amber-400">
              {eqData.cost.gp && `${eqData.cost.gp}gp`}
              {eqData.cost.sp && ` ${eqData.cost.sp}sp`}
              {eqData.cost.cp && ` ${eqData.cost.cp}cp`}
            </div>
          </div>
        )}
      </div>

      {/* Special Properties */}
      {eqData.strengthRequired && (
        <div className="bg-yellow-900/20 p-3 rounded border-l-2 border-yellow-500">
          <span className="text-sm text-yellow-400">力量需求: {eqData.strengthRequired}</span>
        </div>
      )}
      {eqData.stealthDisadvantage && (
        <div className="bg-red-900/20 p-3 rounded border-l-2 border-red-500">
          <span className="text-sm text-red-400">隐匿劣势</span>
        </div>
      )}

      {/* Properties */}
      {eqData.properties && eqData.properties.length > 0 && (
        <div>
          <div className="text-sm font-medium text-slate-400 mb-2">属性</div>
          <div className="flex flex-wrap gap-2">
            {eqData.properties.map((prop: string, idx: number) => (
              <span key={idx} className="px-2 py-1 bg-slate-700 rounded text-xs text-slate-300">
                {translateId(prop)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Description */}
      {eqData.description && (
        <div>
          <div className="text-sm font-medium text-slate-400 mb-2">描述</div>
          <p className="text-sm text-gray-300 leading-relaxed">{eqData.description}</p>
        </div>
      )}
    </div>
  );
}
