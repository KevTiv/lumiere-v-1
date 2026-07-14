"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type Theme = "light" | "dark" | "system";

export type PaletteId = "default" | "ocean";

export type ShellId = "default" | "css-art";

export interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: "light" | "dark";
  setTheme: (theme: Theme) => void;
  palette: PaletteId;
  setPalette: (palette: PaletteId) => void;
  shell: ShellId;
  setShell: (shell: ShellId) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = "lumiere-theme";
const PALETTE_STORAGE_KEY = "lumiere-palette";
const SHELL_STORAGE_KEY = "lumiere-shell";



function applyTheme(resolved: "light" | "dark") {
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(resolved);
}

function parsePalette(raw: string | null): PaletteId {
  if (raw === "default" || raw === "ocean") return raw;
  return "default";
}

function parseShell(raw: string | null): ShellId {
  if (raw === "default" || raw === "css-art") return raw;
  return "default";
}

function applyPalette(id: PaletteId) {
  document.documentElement.dataset.palette = id;
}

function applyShell(id: ShellId) {
  document.documentElement.dataset.shell = id;
}

interface ThemeProviderProps {
  children: ReactNode;
  defaultTheme?: Theme;
  defaultPalette?: PaletteId;
  defaultShell?: ShellId;
  storageKey?: string;
  paletteStorageKey?: string;
  shellStorageKey?: string;
}

export function ThemeProvider({
  children,
  defaultTheme = "system",
  defaultPalette = "default",
  defaultShell = "default",
  storageKey = STORAGE_KEY,
  paletteStorageKey = PALETTE_STORAGE_KEY,
  shellStorageKey = SHELL_STORAGE_KEY,
}: ThemeProviderProps) {
  // Use the supplied defaults for SSR and the first client render so hydration
  // never depends on browser-only storage.
  const [theme, setThemeState] = useState<Theme>(defaultTheme);
  const [palette, setPaletteState] = useState<PaletteId>(defaultPalette);
  const [shell, setShellState] = useState<ShellId>(defaultShell);
  const [systemTheme, setSystemTheme] = useState<"light" | "dark">("light");

  const resolvedTheme: "light" | "dark" = theme === "system" ? systemTheme : theme;

  useEffect(() => {
    const storedTheme = localStorage.getItem(storageKey) as Theme | null;
    if (storedTheme === "light" || storedTheme === "dark" || storedTheme === "system") {
      setThemeState(storedTheme);
    }
    setPaletteState(parsePalette(localStorage.getItem(paletteStorageKey)));
    setShellState(parseShell(localStorage.getItem(shellStorageKey)));
  }, [storageKey, paletteStorageKey, shellStorageKey]);

  useEffect(() => {
    applyTheme(resolvedTheme);
  }, [resolvedTheme]);

  useEffect(() => {
    applyPalette(palette);
  }, [palette]);

  useEffect(() => {
    applyShell(shell);
  }, [shell]);

  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const updateSystemTheme = () => setSystemTheme(mq.matches ? "dark" : "light");
    updateSystemTheme();
    mq.addEventListener("change", updateSystemTheme);
    return () => mq.removeEventListener("change", updateSystemTheme);
  }, [theme]);

  const setTheme = useCallback(
    (next: Theme) => {
      localStorage.setItem(storageKey, next);
      setThemeState(next);
    },
    [storageKey],
  );

  const setPalette = useCallback(
    (next: PaletteId) => {
      localStorage.setItem(paletteStorageKey, next);
      setPaletteState(next);
    },
    [paletteStorageKey],
  );

  const setShell = useCallback(
    (next: ShellId) => {
      localStorage.setItem(shellStorageKey, next);
      setShellState(next);
    },
    [shellStorageKey],
  );

  return (
    <ThemeContext
      value={{
        theme,
        resolvedTheme,
        setTheme,
        palette,
        setPalette,
        shell,
        setShell,
      }}
    >
      {children}
    </ThemeContext>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
