// Languages offered for comment templates. Any other ISO code typed by hand works
// too; these are just the ready-made choices.
export const LANGUAGES = [
  { code: 'uk', label: 'Українська' },
  { code: 'en', label: 'English' },
  { code: 'pl', label: 'Polski' },
  { code: 'de', label: 'Deutsch' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'it', label: 'Italiano' },
  { code: 'pt', label: 'Português' },
  { code: 'ro', label: 'Română' },
  { code: 'cs', label: 'Čeština' },
  { code: 'tr', label: 'Türkçe' },
  { code: 'kk', label: 'Қазақша' },
  { code: 'be', label: 'Беларуская' },
  { code: 'ru', label: 'Русский' },
];

export function languageLabel(code) {
  const lang = LANGUAGES.find((l) => l.code === code);
  return lang ? lang.label : code;
}
