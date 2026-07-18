"use client";

import { useEffect, useRef } from "react";

export function DemoVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

    const syncPlaybackPreference = () => {
      const video = videoRef.current;
      if (!video) return;

      if (mediaQuery.matches) {
        video.pause();
        return;
      }

      void video.play().catch(() => undefined);
    };

    syncPlaybackPreference();
    mediaQuery.addEventListener("change", syncPlaybackPreference);
    return () =>
      mediaQuery.removeEventListener("change", syncPlaybackPreference);
  }, []);

  return (
    <figure className="demo-video">
      <video
        aria-label="Silent Telic product walkthrough showing a recommendation-bias analysis"
        autoPlay
        loop
        muted
        playsInline
        poster="/media/telic-recommendation-bias-poster.webp"
        preload="metadata"
        ref={videoRef}
      >
        <source
          src="/media/telic-recommendation-bias-demo.mp4"
          type="video/mp4"
        />
        Your browser does not support this video format.
      </video>
    </figure>
  );
}
