import { useState, type ReactNode } from 'react'
import {
  useFloating,
  useHover,
  useInteractions,
  offset,
  flip,
  shift,
  safePolygon,
  FloatingPortal,
} from '@floating-ui/react'

interface Props {
  content: ReactNode
  children: ReactNode
  // Interactive: tooltip stays open while mouse is over it (e.g. to click links inside).
  // Default: non-interactive (faster close for simple text tooltips).
  interactive?: boolean
  placement?: 'top' | 'bottom' | 'left' | 'right'
}

export default function Tooltip({ content, children, interactive = false, placement = 'top' }: Props) {
  const [open, setOpen] = useState(false)

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    middleware: [offset(6), flip(), shift({ padding: 8 })],
  })

  const hover = useHover(context, {
    delay: { open: 100, close: interactive ? 100 : 0 },
    handleClose: interactive ? safePolygon() : null,
  })
  const { getReferenceProps, getFloatingProps } = useInteractions([hover])

  return (
    <>
      <span ref={refs.setReference} {...getReferenceProps()}>
        {children}
      </span>
      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className={`tooltip${interactive ? ' tooltip-interactive' : ''}`}
          >
            {content}
          </div>
        </FloatingPortal>
      )}
    </>
  )
}
