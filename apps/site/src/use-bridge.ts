import { useCallback, useEffect, useRef, useState } from "react";
import {
  BridgeClient,
  BridgeError,
  SESSION_KEY,
  restoreSession,
  takePairCode,
  type BridgeAction,
  type BridgeStatus,
} from "./bridge";

export type ConnectionPhase =
  | "idle"
  | "connecting"
  | "pair-required"
  | "connected"
  | "unavailable";
function sessionStorageSafe() {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}
export function useBridge() {
  const [client] = useState(
    () =>
      new BridgeClient((session) => {
        try {
          if (session)
            sessionStorageSafe()?.setItem(SESSION_KEY, JSON.stringify(session));
          else sessionStorageSafe()?.removeItem(SESSION_KEY);
        } catch {}
      }),
  );
  const [phase, setPhase] = useState<ConnectionPhase>("idle");
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const generation = useRef(0),
    actionLock = useRef(false);
  const refreshTask = useRef<Promise<BridgeStatus | undefined> | null>(null);
  const fail = useCallback((error: unknown, current: number) => {
    if (current !== generation.current) return;
    setError(error instanceof Error ? error.message : "无法连接本地助手");
    setStatus(null);
    setPhase(
      error instanceof BridgeError && error.status === 401
        ? "pair-required"
        : "unavailable",
    );
  }, []);
  const refresh = useCallback(() => {
    if (refreshTask.current) return refreshTask.current;
    const current = generation.current;
    const task = (async () => {
      try {
        // Leave enough authorization time for a confirmed runtime installation.
        if (!actionLock.current && client.expiresAt - Date.now() < 720_000)
          await client.rotate();
        const next = await client.status();
        if (current === generation.current) {
          setStatus(next);
          setPhase("connected");
          return next;
        }
      } catch (error) {
        fail(error, current);
      }
      return undefined;
    })();
    refreshTask.current = task;
    void task.then(() => {
      if (refreshTask.current === task) refreshTask.current = null;
    });
    return task;
  }, [client, fail]);
  const connect = useCallback(
    async (code?: string) => {
      const current = ++generation.current;
      setPhase("connecting");
      setError("");
      setStatus(null);
      try {
        await client.probe();
        if (code) await client.pair(code);
        if (!client.authenticated) {
          if (current === generation.current) setPhase("pair-required");
          return;
        }
        const next = await client.status();
        if (current === generation.current) {
          setStatus(next);
          setPhase("connected");
        }
      } catch (error) {
        fail(error, current);
      }
    },
    [client, fail],
  );
  useEffect(() => {
    let active = true;
    const resume = () => {
      if (!active) return;
      try {
        const code = takePairCode(window.location, (url) =>
          history.replaceState(history.state, "", url),
        );
        if (code) {
          void connect(code);
          return;
        }
        const saved = restoreSession(sessionStorageSafe());
        if (saved) {
          client.restore(saved);
          void connect();
        }
      } catch (error) {
        fail(error, generation.current);
      }
    };
    void Promise.resolve().then(resume);
    const onHash = () => {
      if (window.location.hash.startsWith("#pair=")) resume();
    };
    window.addEventListener("hashchange", onHash);
    return () => {
      active = false;
      ++generation.current;
      client.cancel();
      window.removeEventListener("hashchange", onHash);
    };
  }, [client, connect, fail]);
  useEffect(() => {
    if (phase !== "connected") return;
    const timer = setInterval(() => {
      void refresh();
    }, 3000);
    const onFocus = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [phase, refresh]);
  const disconnect = useCallback(async () => {
    ++generation.current;
    setStatus(null);
    setPhase("idle");
    setError("");
    await client.disconnect();
  }, [client]);
  const action = useCallback(
    async (body: BridgeAction) => {
      if (actionLock.current) throw new BridgeError("请等待当前操作完成。");
      if (!client.authenticated || phase !== "connected")
        throw new BridgeError("请先连接本地助手。", 401);
      actionLock.current = true;
      setPending(true);
      setError("");
      const current = generation.current;
      try {
        if (client.expiresAt - Date.now() < 720_000) await client.rotate();
        const result = await client.action(body);
        if (current !== generation.current)
          throw new DOMException("已断开连接", "AbortError");
        if (!(await refresh()))
          throw new BridgeError(
            "操作已提交，但尚未确认最新状态。请重新连接查看结果，不要重复提交。",
          );
        return result;
      } catch (error) {
        if (current === generation.current) {
          if (
            error instanceof BridgeError &&
            (error.status === 401 || error.status === 0)
          )
            fail(error, current);
          else
            setError(error instanceof Error ? error.message : "本地操作失败");
        }
        throw error;
      } finally {
        actionLock.current = false;
        setPending(false);
      }
    },
    [client, phase, fail, refresh],
  );
  return {
    client,
    phase,
    status,
    error,
    pending,
    connect,
    disconnect,
    refresh,
    action,
  };
}
export type LocalBridge = ReturnType<typeof useBridge>;
