import { Item } from '@game/core';

export function ItemIcon({ item, slot }: { item?: Item; slot?: string }) {
  const kind = item?.equipSlot ?? slot ?? item?.groupId;
  return <svg className={`item-icon icon-${item?.groupId ?? 'empty'}`} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === 'main-hand' ? <><path d="m15 31 19-23 6-1-1 7-22 20" fill="currentColor" fillOpacity=".22"/><path d="m11 26 12 12M17 33l-8 9-4-4 9-8M29 18l5-6"/></>
      : kind === 'body' ? <><path d="m16 8-10 6 4 11 6-3-2 18h20l-2-18 6 3 4-11-10-6c-3 7-13 7-16 0Z" fill="currentColor" fillOpacity=".18"/><path d="M18 10c0 9 12 9 12 0M24 19v19M16 29h16"/></>
      : kind === 'head' ? <><path d="M10 31V21a14 14 0 0 1 28 0v10l-10 7V25h-8v13Z"/><path d="M24 7v13M10 23l10 2m8 0 10-2"/></>
      : kind === 'neck' ? <><path d="M12 9c-5 21 29 21 24 0M24 28l-7 7 7 8 7-8Z"/><path d="m24 28 1 8"/></>
      : kind === 'ring' ? <><circle cx="24" cy="29" r="12"/><path d="m17 12 7-7 7 7-7 8ZM19 17l-3 4m13-4 3 4"/></>
      : kind === 'hands' ? <path d="M12 37 8 25c-1-5 4-6 6-1V11c0-4 5-4 5 0v11V7c0-4 5-4 5 0v15V10c0-4 5-4 5 0v12-7c0-4 5-4 5 0v15l-4 10H15Z"/>
      : kind === 'legs' ? <path d="M12 8h24l-2 32H24V23h-2v17H12ZM12 14h23"/>
      : kind === 'feet' ? <><path d="M13 7h13l-1 23 13 6v6H11l-2-7ZM13 15h12M12 23h13"/><path d="m28 9 8 2-1 17 7 5" opacity=".45"/></>
      : kind === 'potions' ? <><path d="M19 7h10v10c16 12 13 25-5 25S3 29 19 17Z" fill="currentColor" fillOpacity=".16"/><path d="M17 7h14M17 3h14M12 29h24c3 9-4 13-12 13s-15-4-12-13Z" fill="currentColor" fillOpacity=".45"/><path d="M18 22c-3 3-5 7-4 10" stroke="#fff" opacity=".4"/></>
      : kind === 'scrolls' ? <><path d="M12 10c0-7 24-7 24 0v25c0 9-24 9-24 0Z" fill="currentColor" fillOpacity=".2"/><path d="M12 10c0 7 24 7 24 0M12 35c0-7 24-7 24 0M18 19h12M18 25h8M9 10h6m18 0h6"/></>
      : kind === 'resources' ? <><path d="m5 29 10-16 17-5 11 20-14 13-19-2Z" fill="currentColor" fillOpacity=".2"/><path d="m15 13 5 15 12-20m-12 20 9 13m-9-13 23 0m-38 1 15-1"/></>
      : <><path d="m24 7 16 9v17l-16 9-16-9V16Z"/><path d="m8 16 16 9 16-9M24 25v17"/></>}
  </svg>;
}
