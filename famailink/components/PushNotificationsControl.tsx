"use client";

import { useCallback, useEffect, useState } from "react";

type PushSupportResponse = {
  supported?: boolean;
  publicKey?: string;
};

type ControlState = "loading" | "ready" | "enabled" | "unsupported" | "install_required" | "blocked" | "error";

function normalize(value?: unknown) {
  return String(value ?? "").trim();
}

function isStandaloneDisplayMode() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches || Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
}

function isAppleMobileDevice() {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function deviceLabelFromUserAgent() {
  const userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent.toLowerCase();
  if (userAgent.includes("iphone")) return "iPhone";
  if (userAgent.includes("ipad")) return "iPad";
  if (userAgent.includes("android")) return "Android device";
  return "This device";
}

function base64UrlToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    output[index] = raw.charCodeAt(index);
  }
  return output;
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    throw new Error("service_worker_not_supported");
  }
  return navigator.serviceWorker.register("/sw.js");
}

export function PushNotificationsControl() {
  const [state, setState] = useState<ControlState>("loading");
  const [message, setMessage] = useState("Checking notification support...");
  const [busy, setBusy] = useState(false);
  const [publicKey, setPublicKey] = useState("");

  const refreshState = useCallback(async () => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setState("unsupported");
      setMessage("This browser does not support web push notifications.");
      return;
    }

    try {
      const supportResponse = await fetch("/api/push/public-key", { cache: "no-store" });
      const supportBody = (await supportResponse.json().catch(() => null)) as PushSupportResponse | null;
      const nextPublicKey = normalize(supportBody?.publicKey);
      if (!supportResponse.ok || !supportBody?.supported || !nextPublicKey) {
        setPublicKey("");
        setState("unsupported");
        setMessage("Notifications are not configured on the server yet.");
        return;
      }

      setPublicKey(nextPublicKey);

      if (isAppleMobileDevice() && !isStandaloneDisplayMode()) {
        setState("install_required");
        setMessage("Install this app to your home screen in Safari first to enable alerts.");
        return;
      }

      if (Notification.permission === "denied") {
        setState("blocked");
        setMessage("Notifications are blocked for this app in browser settings.");
        return;
      }

      const registration = await registerServiceWorker();
      const existingSubscription = await registration.pushManager.getSubscription();
      if (existingSubscription) {
        setState("enabled");
        setMessage("Notifications are on for this device.");
        return;
      }

      setState("ready");
      setMessage("Get alerts for new Group messages and comments on this device.");
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Unable to check notification support.");
    }
  }, []);

  useEffect(() => {
    void refreshState();
  }, [refreshState]);

  async function enableNotifications() {
    if (busy) return;
    setBusy(true);
    try {
      if (!publicKey) {
        throw new Error("Notifications are not configured on the server yet.");
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "ready");
        setMessage(permission === "denied" ? "Notifications are blocked for this app in browser settings." : "Notification permission was not granted.");
        return;
      }

      const registration = await registerServiceWorker();
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64UrlToUint8Array(publicKey),
        });
      }

      const json = subscription.toJSON();
      const saveResponse = await fetch("/api/push/subscriptions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          endpoint: normalize(subscription.endpoint),
          keys: {
            p256dh: normalize(json.keys?.p256dh),
            auth: normalize(json.keys?.auth),
          },
          deviceLabel: deviceLabelFromUserAgent(),
          userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
        }),
      });
      const saveBody = (await saveResponse.json().catch(() => null)) as { error?: string } | null;
      if (!saveResponse.ok) {
        throw new Error(normalize(saveBody?.error) || "Failed to save the push subscription.");
      }

      setState("enabled");
      setMessage("Notifications are on for this device.");
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Unable to enable notifications.");
    } finally {
      setBusy(false);
    }
  }

  async function disableNotifications() {
    if (busy) return;
    setBusy(true);
    try {
      const registration = await registerServiceWorker();
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await fetch("/api/push/subscriptions", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: normalize(subscription.endpoint) }),
        }).catch(() => null);
        await subscription.unsubscribe().catch(() => null);
      }
      setState("ready");
      setMessage("Notifications are off for this device.");
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Unable to disable notifications.");
    } finally {
      setBusy(false);
    }
  }

  const canEnable = state === "ready" || state === "error";
  const canDisable = state === "enabled";
  const buttonLabel = canDisable ? "Turn Off Alerts" : "Enable Alerts";

  return (
    <div className="conversation-push-card">
      <div className="conversation-push-copy">
        <strong>Notifications</strong>
        <p className="conversation-meta">Get alerts for new Group messages and comments on this device.</p>
        <p className={`conversation-push-status is-${state}`}>{message}</p>
      </div>
      <div className="conversation-push-actions">
        <button
          className="secondary-button"
          type="button"
          disabled={busy || (!canEnable && !canDisable)}
          onClick={() => {
            if (canDisable) {
              void disableNotifications();
              return;
            }
            void enableNotifications();
          }}
        >
          {busy ? "Working..." : buttonLabel}
        </button>
      </div>
    </div>
  );
}
