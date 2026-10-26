// Icons for common category names. Unknown categories get a folder.
const icons: [RegExp, string][] = [
  [/保险|insurance/i, "🛡️"],
  [/证件|身份|护照|id|passport/i, "🪪"],
  [/医疗|病历|体检|medical|health/i, "🏥"],
  [/房|house|home/i, "🏠"],
  [/车|car|vehicle/i, "🚗"],
  [/票|发票|收据|receipt|bill/i, "🧾"],
  [/银行|存款|bank/i, "🏦"],
  [/合同|contract/i, "📝"],
];

export function categoryIcon(name: string): string {
  return icons.find(([re]) => re.test(name))?.[1] ?? "📁";
}

const palette = ["#b5532f", "#3f7d5c", "#3b6aa0", "#8a5aa8", "#b0832b", "#4f7f86"];

export function personColor(id: number): string {
  return palette[id % palette.length];
}
