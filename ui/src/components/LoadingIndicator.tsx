interface LoadingIndicatorProps {
  label: string
  className?: string
}

export default function LoadingIndicator({
  label,
  className = 'h-[60vh]',
}: LoadingIndicatorProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-3 ${className}`}
    >
      <span className='h-8 w-8 rounded-full border-2 border-neutral-700 border-t-neutral-300 animate-spin' />
      <p className='text-sm text-neutral-500'>{label}</p>
    </div>
  )
}
