interface AiEmblemProps {
  size?: number;
}

/** Rounded AI emblem — soft white core, blue/violet body, ambient glow. */
export function AiEmblem({ size = 64 }: AiEmblemProps) {
  return (
    <div className="ai-emblem" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="sx-emblem-body" x1="10" y1="6" x2="54" y2="60" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#dbe4ff" />
            <stop offset="45%" stopColor="#8ea2f8" />
            <stop offset="100%" stopColor="#5b5bd6" />
          </linearGradient>
          <radialGradient id="sx-emblem-core" cx="0.5" cy="0.42" r="0.55">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="70%" stopColor="#e8edff" />
            <stop offset="100%" stopColor="#c3cdf5" />
          </radialGradient>
          <linearGradient id="sx-emblem-sheen" x1="14" y1="8" x2="34" y2="30" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.85" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
        </defs>

        <path
          d="M32 3.5c3.1 0 6.1 0.9 8.7 2.5l12 7.3c2.5 1.5 4.4 3.8 5.5 6.5 0.9 2.3 1.3 4.7 1.3 7.2v10c0 2.5-0.4 4.9-1.3 7.2-1.1 2.7-3 5-5.5 6.5l-12 7.3c-2.6 1.6-5.6 2.5-8.7 2.5s-6.1-0.9-8.7-2.5l-12-7.3c-2.5-1.5-4.4-3.8-5.5-6.5-0.9-2.3-1.3-4.7-1.3-7.2v-10c0-2.5 0.4-4.9 1.3-7.2 1.1-2.7 3-5 5.5-6.5l12-7.3C25.9 4.4 28.9 3.5 32 3.5Z"
          fill="url(#sx-emblem-body)"
        />
        <path
          d="M32 3.5c3.1 0 6.1 0.9 8.7 2.5l12 7.3c2.5 1.5 4.4 3.8 5.5 6.5 0.9 2.3 1.3 4.7 1.3 7.2v10c0 2.5-0.4 4.9-1.3 7.2-1.1 2.7-3 5-5.5 6.5l-12 7.3c-2.6 1.6-5.6 2.5-8.7 2.5s-6.1-0.9-8.7-2.5l-12-7.3c-2.5-1.5-4.4-3.8-5.5-6.5-0.9-2.3-1.3-4.7-1.3-7.2v-10c0-2.5 0.4-4.9 1.3-7.2 1.1-2.7 3-5 5.5-6.5l12-7.3C25.9 4.4 28.9 3.5 32 3.5Z"
          fill="url(#sx-emblem-sheen)"
          opacity="0.5"
        />
        <ellipse cx="32" cy="33" rx="15.5" ry="14.5" fill="url(#sx-emblem-core)" />
        <rect x="24.4" y="30.4" width="4.6" height="7" rx="2.3" fill="#3d3d99" />
        <rect x="35" y="30.4" width="4.6" height="7" rx="2.3" fill="#3d3d99" />
      </svg>
    </div>
  );
}
