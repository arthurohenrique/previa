import Link from 'next/link'

/**
 * Lista agrupada do iPadOS. Um cartão, hairlines entre as células, nada de card
 * dentro de card.
 */
export function List({ children }: { children: React.ReactNode }) {
  return (
    <ul className="overflow-hidden rounded-md bg-elevated">
      {children}
    </ul>
  )
}

interface ListRowProps {
  href?: string
  title: string
  detail?: string
  trailing?: React.ReactNode
}

export function ListRow({ href, title, detail, trailing }: ListRowProps) {
  const content = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body text-label">{title}</span>
        {detail ? (
          <span className="block truncate text-subhead text-label-secondary">{detail}</span>
        ) : null}
      </span>
      {trailing ? <span className="shrink-0 text-label-tertiary">{trailing}</span> : null}
    </>
  )

  return (
    <li className="not-last:hairline-b">
      {href ? (
        <Link
          href={href}
          className="flex min-h-(--touch-target) items-center gap-2 px-2 py-1 active:bg-fill-secondary"
        >
          {content}
        </Link>
      ) : (
        <div className="flex min-h-(--touch-target) items-center gap-2 px-2 py-1">{content}</div>
      )}
    </li>
  )
}

export function EmptyState({ message, action }: { message: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
      <p className="max-w-80 text-body text-label-secondary">{message}</p>
      {action}
    </div>
  )
}
