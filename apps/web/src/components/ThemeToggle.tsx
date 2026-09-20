import { useTheme } from "../state/ThemeContext";
import { MoonIcon, SunIcon } from "./icons";

/** Light/dark switch — placed in the top bar, works everywhere the app renders since ThemeProvider wraps the whole tree. */
export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition-all hover:bg-slate-100 hover:text-slate-700 active:scale-90 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
    >
      <span className="inline-block transition-transform duration-300 ease-out" style={{ transform: isDark ? "rotate(0deg)" : "rotate(180deg)" }}>
        {isDark ? <SunIcon className="h-4 w-4" /> : <MoonIcon className="h-4 w-4" />}
      </span>
    </button>
  );
}
