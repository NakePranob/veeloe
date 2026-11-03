import { useCallback, useEffect, useRef, useState } from "react";
import { openDatabase, openedDatabase, retryOpenAfterReload, takeOverDatabase, tryHoldDatabase, type Database } from "../../shared/db";
import { applySavedLanguage } from "../../shared/i18n";

type State = { status: "opening" } | { status: "elsewhere" } | { status: "failed" } | { status: "ready"; database: Database };

/** Holds the database for this tab, opens it, and gives it up when another tab asks. */
export function useAppDatabase() {
  const [state, setState] = useState<State>({ status: "opening" });
  const openRef = useRef<Database | null>(null);

  // The page reloads right after this (tab-lock.web.ts), so there is no state to change.
  const onTaken = useCallback(async () => {
    await openRef.current?.close();
  }, []);

  const open = useCallback(async () => {
    try {
      const database = await openDatabase();
      await applySavedLanguage(database);
      openRef.current = database;
      openedDatabase();
      setState({ status: "ready", database });
    } catch (error) {
      if (retryOpenAfterReload()) {
        // Off the "Use here" page: this page's worker cannot open anything now, so pressing again would only fail.
        setState({ status: "opening" });
      } else {
        console.error(error);
        setState({ status: "failed" });
      }
    }
  }, []);

  useEffect(() => {
    void (async () => {
      if (await tryHoldDatabase(onTaken)) await open();
      else setState({ status: "elsewhere" });
    })();
  }, [onTaken, open]);

  const useHere = useCallback(async () => {
    await takeOverDatabase(onTaken);
    await open();
  }, [onTaken, open]);

  // On web a worker that failed to open stays broken, so only a new page can try again.
  const retry = useCallback(() => {
    if (process.env.EXPO_OS === "web") location.reload();
    else {
      setState({ status: "opening" });
      void open();
    }
  }, [open]);

  return { state, useHere, retry };
}
