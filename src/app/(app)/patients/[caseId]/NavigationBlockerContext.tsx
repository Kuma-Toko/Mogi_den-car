"use client";

import { createContext, useContext, useState } from "react";

interface NavigationBlockerContextType {
  isBlocked: boolean;
  setIsBlocked: (isBlocked: boolean) => void;
}

const NavigationBlockerContext = createContext<NavigationBlockerContextType>({
  isBlocked: false,
  setIsBlocked: () => {},
});

// カルテ記載タブなど、書きかけの入力があるときに他タブへのリンク遷移を確認なしで許可しないためのガード。
// ページ単位（CaseDetailPageのタブ領域）でProviderを配置し、タブ切替はTabLinkのonNavigateで判定する。
export function NavigationBlockerProvider({ children }: { children: React.ReactNode }) {
  const [isBlocked, setIsBlocked] = useState(false);
  return (
    <NavigationBlockerContext.Provider value={{ isBlocked, setIsBlocked }}>
      {children}
    </NavigationBlockerContext.Provider>
  );
}

export function useNavigationBlocker() {
  return useContext(NavigationBlockerContext);
}
