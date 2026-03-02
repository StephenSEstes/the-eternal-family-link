"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

const SPLASH_SEEN_KEY = "efl_launch_splash_seen_v1";

function isStandaloneMode() {
  if (typeof window === "undefined") {
    return false;
  }
  const navigatorWithStandalone = window.navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || navigatorWithStandalone.standalone === true;
}

export function AppLaunchSplash() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!isStandaloneMode()) {
      return;
    }
    try {
      if (window.sessionStorage.getItem(SPLASH_SEEN_KEY) === "1") {
        return;
      }
    } catch {
      return;
    }

    setVisible(true);
    const timer = window.setTimeout(() => {
      setVisible(false);
      try {
        window.sessionStorage.setItem(SPLASH_SEEN_KEY, "1");
      } catch {
        // Ignore storage write errors; splash is non-critical.
      }
    }, 1400);
    return () => window.clearTimeout(timer);
  }, []);

  if (!visible) {
    return null;
  }

  return (
    <div className="app-launch-splash" role="status" aria-live="polite" aria-label="Launching app">
      <div className="app-launch-splash-card">
        <Image
          src="/brand/logo-arch-tree.png"
          alt="EFL logo"
          width={80}
          height={116}
          className="app-launch-splash-logo"
          priority
        />
        <h1 className="app-launch-splash-title">The Eternal Family Link</h1>
        <p className="app-launch-splash-tagline">Keep your family story alive.</p>
      </div>
    </div>
  );
}
