import { createContext, useContext, useState, ReactNode } from "react";

export type Platform = "whatsapp" | "instagram";

interface PlatformContextType {
  platform: Platform;
  setPlatform: (p: Platform) => void;
}

const PlatformContext = createContext<PlatformContextType>({
  platform: "whatsapp",
  setPlatform: () => {},
});

export function PlatformProvider({ children }: { children: ReactNode }) {
  const [platform, setPlatform] = useState<Platform>(
    () => (localStorage.getItem("platform") as Platform) || "whatsapp"
  );

  const handleSet = (p: Platform) => {
    setPlatform(p);
    localStorage.setItem("platform", p);
  };

  return (
    <PlatformContext.Provider value={{ platform, setPlatform: handleSet }}>
      {children}
    </PlatformContext.Provider>
  );
}

export const usePlatform = () => useContext(PlatformContext);
