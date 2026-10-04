import messages from './zh-CN.json';

export type TranslationKey = keyof typeof messages;

export function t(key: TranslationKey, values: Record<string, string | number> = {}): string {
  return Object.entries(values).reduce(
    (text, [name, value]) => text.replaceAll('{' + name + '}', String(value)),
    messages[key],
  );
}
