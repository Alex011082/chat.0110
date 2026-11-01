import { getLocale, setLocale } from "../strings.ts";
export function LanguageSwitch() {
  const locale = getLocale();
  return (
    <div
      className="inline-flex shrink-0 rounded-full bg-slot p-1 shadow-recess"
      role="group"
      aria-label={locale === "ru" ? "Язык интерфейса" : "Interface language"}
    >
      {(["ru", "en"] as const).map((lang) => (
        <button
          key={lang}
          type="button"
          lang={lang}
          aria-pressed={locale === lang}
          onClick={() => setLocale(lang)}
          className={`min-h-9 min-w-9 rounded-full border-0 px-2 text-scale ${locale === lang ? "bg-plate text-ink" : "bg-transparent text-ink-2"}`}
        >
          {lang.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
