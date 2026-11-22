import { useCallback, useEffect, useState } from "react";
import { openDatabase, type Database } from "../../shared/db";
import { applySavedLanguage } from "../../shared/i18n";

type State = { status: "opening" } | { status: "failed" } | { status: "ready"; database: Database };

/** Opens the database on this device; a failed open can be tried again from the page that says so. */
export function useAppDatabase() {
  const [state, setState] = useState<State>({ status: "opening" });

  const open = useCallback(async () => {
    try {
      const database = await openDatabase();
      await applySavedLanguage(database);
      setState({ status: "ready", database });
    } catch (error) {
      console.error(error);
      setState({ status: "failed" });
    }
  }, []);

  useEffect(() => {
    void open();
  }, [open]);

  const retry = useCallback(() => {
    setState({ status: "opening" });
    void open();
  }, [open]);

  return { state, retry };
}
