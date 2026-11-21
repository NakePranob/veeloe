import { createContext, useContext } from "react";

// What a control sits on. On the white screen a quiet pill, track or field is grey; on a grey card
// it turns white, so it never sinks into the card (the Design system board).
export const OnCard = createContext(false);

export const useOnCard = () => useContext(OnCard);
