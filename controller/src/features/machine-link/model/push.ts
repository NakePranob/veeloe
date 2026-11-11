import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { useMachines } from "../../../entities/machine";
import { useLanguage } from "../../../shared/i18n";
import { useMachineLink } from "./use-machine-links";

/** The Task on screen, so its own push does not also draw a banner (ADR 0044). */
let activeTask: string | null = null;

export function setActiveTask(task: string | null) {
  activeTask = task;
}

if (process.env.EXPO_OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const task = notification.request.content.data?.task;
      const onScreen = typeof task === "string" && task === activeTask;
      return {
        shouldShowBanner: !onScreen,
        shouldShowList: !onScreen,
        shouldPlaySound: !onScreen,
        shouldSetBadge: false,
      };
    },
  });
}

function projectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId;
}

/**
 * Ask for notification permission once, give the Expo token to every Machine,
 * and open the Task a tapped push names. A build without an Expo project ID
 * simply has no token yet, so nothing is registered and nothing crashes.
 */
export function usePushRegistration() {
  const machines = useMachines();
  const link = useMachineLink();
  const language = useLanguage();
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    if (process.env.EXPO_OS === "web" || !Device.isDevice) return;
    let cancelled = false;
    void (async () => {
      await Notifications.setNotificationChannelAsync("default", {
        name: "Veeloe",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
      const current = await Notifications.getPermissionsAsync();
      const granted =
        current.granted ||
        (current.canAskAgain && (await Notifications.requestPermissionsAsync()).granted);
      if (!granted) return;
      const id = projectId();
      if (!id) return;
      const got = await Notifications.getExpoPushTokenAsync({ projectId: id });
      if (!cancelled) setToken(got.data);
    })().catch(() => {
      // A simulator, a missing project ID, or a refused permission: no token, no crash.
    });
    const response = Notifications.addNotificationResponseReceivedListener((event) => {
      const data = event.notification.request.content.data;
      const task = typeof data?.task === "string" ? data.task : null;
      const agent = typeof data?.agent === "string" ? data.agent : null;
      if (task && agent) router.push({ pathname: "/tasks/[task]", params: { task, agent } });
    });
    return () => {
      cancelled = true;
      response.remove();
    };
  }, []);

  useEffect(() => {
    if (!token || !link || !machines) return;
    for (const machine of machines) link.registerPush(machine, token, language);
  }, [token, link, machines, language]);
}
