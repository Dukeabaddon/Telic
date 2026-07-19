export function DemoVideo() {
  return (
    <figure className="demo-video">
      <video
        aria-describedby="build-week-video-caption"
        aria-label="Muted Telic Build Week presentation"
        controls
        muted
        playsInline
        poster="/media/telic-build-week-presentation-poster.webp"
        preload="metadata"
      >
        <source
          src="/media/telic-build-week-presentation.mp4"
          type="video/mp4"
        />
        Your browser does not support this video format.
      </video>
      <figcaption id="build-week-video-caption">
        94-second Build Week walkthrough. Installation, configuration, and an
        evidence-backed analysis in one recording.
      </figcaption>
    </figure>
  );
}
