"use client";

import { useRouter } from "next/navigation";

type ProfileBackButtonProps = {
  fallbackHref: string;
};

export function ProfileBackButton({ fallbackHref }: ProfileBackButtonProps) {
  const router = useRouter();

  return (
    <button
      type="button"
      className="button secondary"
      onClick={() => {
        if (window.history.length > 1) {
          router.back();
          return;
        }
        router.push(fallbackHref);
      }}
    >
      Close Profile
    </button>
  );
}

