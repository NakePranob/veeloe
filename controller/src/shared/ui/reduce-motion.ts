import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

// True while the device asks for less motion: anything that moves on its own stays still then.
export function useReduceMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduce);
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduce);
    return () => sub.remove();
  }, []);
  return reduce;
}
