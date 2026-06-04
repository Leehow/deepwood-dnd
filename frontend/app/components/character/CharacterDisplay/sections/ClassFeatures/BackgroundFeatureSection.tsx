import React from "react";

interface Props {
  background: any;
}

export function BackgroundFeatureSection({ background }: Props) {
  if (!background?.feature) return null;

  return (
    <div className="space-y-2">
      <div className="rounded-lg border-l-2 border-emerald-600/50 bg-gray-800/30 border border-gray-700/40 pl-3 pr-2 py-2">
        <div className="text-sm text-gray-200 font-medium">{background.feature.name}</div>
        <div className="text-xs text-gray-400 whitespace-pre-wrap mt-0.5">{background.feature.description}</div>
      </div>
    </div>
  );
}
