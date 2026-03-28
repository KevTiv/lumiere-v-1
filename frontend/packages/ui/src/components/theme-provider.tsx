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

function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

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
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === "undefined") return defaultTheme;
    return (localStorage.getItem(storageKey) as Theme) ?? defaultTheme;
  });

  const [palette, setPaletteState] = useState<PaletteId>(() => {
    if (typeof window === "undefined") return defaultPalette;
    return parsePalette(localStorage.getItem(paletteStorageKey));
  });

  const [shell, setShellState] = useState<ShellId>(() => {
    if (typeof window === "undefined") return defaultShell;
    return parseShell(localStorage.getItem(shellStorageKey));
  });

  const resolvedTheme: "light" | "dark" =
    theme === "system" ? getSystemTheme() : theme;

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
    const handler = () => applyTheme(mq.matches ? "dark" : "light");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
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
