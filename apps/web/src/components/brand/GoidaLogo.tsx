const ASSET_BY_VARIANT = {
  lockup: '/brand/goida-lockup.svg',
  mark: '/brand/goida-mark.svg',
  wordmark: '/brand/goida-wordmark.svg',
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
