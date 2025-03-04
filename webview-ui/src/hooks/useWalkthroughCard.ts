import { useState } from "react";
import { getLocalStorage, setLocalStorage } from "../utils/localStorage";

export type UseWalkthroughCard = {
  showWalkthroughCard: boolean;
  closeWalkthroughCard: () => void;
  openWalkthroughCard: () => void;
};

export function useWalkthroughCard(): UseWalkthroughCard {
  const [showWalkthroughCard, setShowWalkthroughCard] = useState<boolean>(
    getLocalStorage("showWalkthroughCard") ?? true,
  );

  function closeWalkthroughCard() {
    setLocalStorage("showWalkthroughCard", false);
    setShowWalkthroughCard(false);
  }

  function openWalkthroughCard() {
    setLocalStorage("showWalkthroughCard", true);
    setShowWalkthroughCard(true);
  }

  return { showWalkthroughCard, closeWalkthroughCard, openWalkthroughCard };
}

export default UseWalkthroughCard;
