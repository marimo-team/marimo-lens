import { createContext, useContext } from "react";

export type LensTheme = "light" | "dark";

export const LensThemeContext = createContext<LensTheme>("light");

export function useLensTheme(): LensTheme {
  return useContext(LensThemeContext);
}
