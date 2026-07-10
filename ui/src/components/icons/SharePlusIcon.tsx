interface Props {
  size?: number
  className?: string
  strokeWidth?: number
}

export default function SharePlusIcon({
  size = 24,
  className,
  strokeWidth = 2,
}: Props) {
  // Combined Share2 + Plus icon in a 36×24 viewBox.
  // Share2 occupies the left 24 units; Plus sits to the right.
  const scale = size / 24
  const width = Math.round(36 * scale)
  const height = size

  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      width={width}
      height={height}
      viewBox='0 0 36 24'
      fill='none'
      stroke='currentColor'
      strokeWidth={strokeWidth}
      strokeLinecap='round'
      strokeLinejoin='round'
      className={className}
      aria-hidden='true'
    >
      {/* Share2 paths (native 24×24 coords) */}
      <circle cx='18' cy='5' r='3' />
      <circle cx='6' cy='12' r='3' />
      <circle cx='18' cy='19' r='3' />
      <line x1='8.59' y1='13.51' x2='15.42' y2='17.49' />
      <line x1='15.41' y1='6.51' x2='8.59' y2='10.49' />

      {/* Plus icon shifted right by 24 units, centred vertically */}
      <line x1='25' y1='12' x2='35' y2='12' />
      <line x1='30' y1='7' x2='30' y2='17' />
    </svg>
  )
}
