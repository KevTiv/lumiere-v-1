"use client";

import { readPreference, writePreference } from "../lib/theme-storage";

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
export type Density = "comfortable" | "compact";

export interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: "light" | "dark";
  setTheme: (theme: Theme) => void;
  palette: PaletteId;
  setPalette: (palette: PaletteId) => void;
  shell: ShellId;
  setShell: (shell: ShellId) => void;
  density: Density;
  setDensity: (density: Density) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = "lumiere-theme";
const PALETTE_STORAGE_KEY = "lumiere-palette";
const SHELL_STORAGE_KEY = "lumiere-shell";
const DENSITY_STORAGE_KEY = "lumiere-density";



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
  const [density, setDensityState] = useState<Density>("comfortable");
  const [systemTheme, setSystemTheme] = useState<"light" | "dark">("light");

  const resolvedTheme: "light" | "dark" = theme === "system" ? systemTheme : theme;

  useEffect(() => {
    const storedTheme = readPreference(storageKey) as Theme | null;
    if (storedTheme === "light" || storedTheme === "dark" || storedTheme === "system") {
      setThemeState(storedTheme);
    }
    const storedPalette = readPreference(paletteStorageKey);
    if (storedPalette !== null) setPaletteState(parsePalette(storedPalette));
    const storedShell = readPreference(shellStorageKey);
    if (storedShell !== null) setShellState(parseShell(storedShell));
    const storedDensity = readPreference(DENSITY_STORAGE_KEY);
    if (storedDensity === "compact" || storedDensity === "comfortable") setDensityState(storedDensity);
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
    document.documentElement.dataset.density = density;
  }, [density]);

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
      writePreference(storageKey, next);
      setThemeState(next);
    },
    [storageKey],
  );

  const setPalette = useCallback(
    (next: PaletteId) => {
      writePreference(paletteStorageKey, next);
      setPaletteState(next);
    },
    [paletteStorageKey],
  );

  const setShell = useCallback(
    (next: ShellId) => {
      writePreference(shellStorageKey, next);
      setShellState(next);
    },
    [shellStorageKey],
  );

  const setDensity = useCallback((next: Density) => {
    writePreference(DENSITY_STORAGE_KEY, next);
    setDensityState(next);
  }, []);

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
        density,
        setDensity,
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
