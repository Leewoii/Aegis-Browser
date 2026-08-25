/** Futuristic gem logo — rounded hexagon with glass highlights and glow. */
export function Logo({ size = 60 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="app-logo"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="sx-gem" x1="10" y1="6" x2="54" y2="58" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#9be8ff" />
          <stop offset="45%" stopColor="#5f8bff" />
          <stop offset="100%" stopColor="#a06bff" />
        </linearGradient>
        <linearGradient id="sx-gem-inner" x1="22" y1="20" x2="44" y2="48" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#1a2140" />
          <stop offset="100%" stopColor="#0a0d1c" />
        </linearGradient>
        <radialGradient id="sx-gem-sheen" cx="0.35" cy="0.25" r="0.6">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.85" />
          <stop offset="60%" stopColor="#ffffff" stopOpacity="0.08" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Rounded hexagonal gem body */}
      <path
        d="M29 5.5c2-1.15 4-1.15 6 0l17.5 10.1c2 1.15 3 3 3 5.3v20.2c0 2.3-1 4.15-3 5.3L35 56.5c-2 1.15-4 1.15-6 0L11.5 46.4c-2-1.15-3-3-3-5.3V20.9c0-2.3 1-4.15 3-5.3L29 5.5z"
        fill="url(#sx-gem)"
      />
      <path
        d="M29 5.5c2-1.15 4-1.15 6 0l17.5 10.1c2 1.15 3 3 3 5.3v20.2c0 2.3-1 4.15-3 5.3L35 56.5c-2 1.15-4 1.15-6 0L11.5 46.4c-2-1.15-3-3-3-5.3V20.9c0-2.3 1-4.15 3-5.3L29 5.5z"
        fill="url(#sx-gem-sheen)"
      />

      {/* Dark glass core */}
      <circle cx="32" cy="33" r="13.5" fill="url(#sx-gem-inner)" />
      <circle cx="32" cy="33" r="13.5" stroke="#bcd7ff" strokeOpacity="0.35" strokeWidth="1" />

      {/* Orbiting accent dot */}
      <circle cx="43.5" cy="22.5" r="3.4" fill="#dff4ff" />
      <circle cx="42.6" cy="21.6" r="1.5" fill="#ffffff" />
    </svg>
  );
}
