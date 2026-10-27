const ASSET_BY_VARIANT = {
  lockup: '/brand/goida-wordmark-ui.png',
  mark: '/brand/goida-icon-transparent.png',
  wordmark: '/brand/goida-wordmark-ui.png',
} as const;

export function GoidaLogo({
  alt = 'Goida Chat',
  className = '',
  imageClassName = '',
  variant = 'lockup',
}: {
  alt?: string;
  className?: string;
  imageClassName?: string;
  variant?: keyof typeof ASSET_BY_VARIANT;
}) {
  return (
    <span className={className}>
      <img
        alt={alt}
        className={imageClassName}
        draggable={false}
        loading="eager"
        src={ASSET_BY_VARIANT[variant]}
      />
    </span>
  );
}
