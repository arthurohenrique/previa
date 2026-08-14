// Ícones de traço, 24 × 24, peso casado ao da tipografia ao lado.
// SF Symbols não é distribuível na web (E-05); estes são o equivalente mínimo.

type IconProps = { className?: string }

function Svg({ children, className }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {children}
    </svg>
  )
}

export function IconPeople(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19.5c.6-3.2 2.9-5 5.5-5s4.9 1.8 5.5 5" />
      <path d="M16 5.6a3.2 3.2 0 0 1 0 6.3M17.4 14.9c2 .5 3.4 2.2 3.9 4.6" />
    </Svg>
  )
}

export function IconProtocol(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 3.5h9l4 4v13H6z" />
      <path d="M15 3.5v4h4" />
      <path d="M9.5 12.5h6M9.5 16h4" />
    </Svg>
  )
}

export function IconCamera(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.5 8.5h3.2l1.4-2.4h7.8l1.4 2.4h3.2v10.5h-17z" />
      <circle cx="12" cy="13.5" r="3.4" />
    </Svg>
  )
}

export function IconUndo(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 9.5h9.5a5 5 0 0 1 0 10H8" />
      <path d="M7.5 5.5 3.7 9.5l3.8 4" />
    </Svg>
  )
}

export function IconRedo(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20 9.5h-9.5a5 5 0 0 0 0 10H16" />
      <path d="M16.5 5.5 20.3 9.5l-3.8 4" />
    </Svg>
  )
}

export function IconCompare(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M12 4.5v15" />
    </Svg>
  )
}

export function IconShare(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3.5v11" />
      <path d="M8.5 7 12 3.5 15.5 7" />
      <path d="M6 11.5H4.5v9h15v-9H18" />
    </Svg>
  )
}

export function IconTrash(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4.5 6.5h15" />
      <path d="M9.5 6.5V4.2h5v2.3" />
      <path d="M6.5 6.5 7.4 20h9.2l.9-13.5" />
    </Svg>
  )
}

export function IconSidebar(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M9.5 4.5v15" />
    </Svg>
  )
}
