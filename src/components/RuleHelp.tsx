import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { CircleAlert } from 'lucide-react';

/** Explanations remain available to pointer, keyboard and touch users without taking a row. */
export function RuleHelp({ label, children }: { label: string; children: string }) {
  const id = useId();
  const host = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const tooltip = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 8, top: 8 });

  useLayoutEffect(() => {
    if (!open || !trigger.current || !tooltip.current) return;
    const anchor = trigger.current.getBoundingClientRect();
    const box = tooltip.current.getBoundingClientRect();
    setPosition({
      left: Math.max(8, Math.min(anchor.left, window.innerWidth - box.width - 8)),
      top: Math.max(8, Math.min(anchor.bottom + 5, window.innerHeight - box.height - 8)),
    });
  }, [open, children]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const outside = (event: PointerEvent) => { if (!host.current?.contains(event.target as Node)) close(); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  return <span className="rule-help" ref={host}
    onPointerEnter={event => { if (event.pointerType === 'mouse') setOpen(true); }}
    onPointerLeave={() => { if (!host.current?.contains(document.activeElement)) setOpen(false); }}
    onBlur={event => { if (!host.current?.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
    <button ref={trigger} type="button" className="rule-help-trigger" aria-label={`${label}说明`}
      aria-describedby={open ? id : undefined} onFocus={() => setOpen(true)} onClick={() => setOpen(true)}>
      <CircleAlert aria-hidden="true" />
    </button>
    {open && <span ref={tooltip} id={id} role="tooltip" className="rule-help-tooltip" style={position}>{children}</span>}
  </span>;
}
