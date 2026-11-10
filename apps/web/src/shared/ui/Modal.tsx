import { useEffect, useRef, type ReactNode } from 'react';
export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const node = dialog.current!; node.showModal(); return () => node.close(); }, []);
  return <dialog ref={dialog} className={`game-modal${wide ? ' game-modal-wide' : ''}`} aria-label={title} onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="game-modal-heading"><h2>{title}</h2><button className="ghost" onClick={onClose}>Закрыть · Esc</button></div>{children}
  </dialog>;
}
