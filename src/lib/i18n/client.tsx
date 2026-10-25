"use client";

// クライアントコンポーネントで翻訳を使う。layout.tsx の LangProvider が、いまの言語の辞書だけを渡す。
import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Lang } from "./config";
import { interpolate, type DictKey, type Translator } from "./translate";

interface LangContextValue {
  lang: Lang;
  dict: unknown;
}
const LangContext = createContext<LangContextValue>({ lang: "ja", dict: {} });

export function LangProvider({ lang, dict, children }: { lang: Lang; dict: unknown; children: ReactNode }) {
  const value = useMemo(() => ({ lang, dict }), [lang, dict]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang(): Lang {
  return useContext(LangContext).lang;
}

export function useT(): Translator {
  const { dict } = useContext(LangContext);
  return (key: DictKey, vars) => {
    let cur: unknown = dict;
    for (const part of key.split(".")) {
      if (cur && typeof cur === "object" && part in (cur as Record<string, unknown>)) cur = (cur as Record<string, unknown>)[part];
      else return key;
    }
    return typeof cur === "string" ? interpolate(cur, vars) : key;
  };
}
