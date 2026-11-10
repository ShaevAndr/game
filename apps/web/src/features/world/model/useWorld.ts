import { useCallback, useEffect, useRef, useState } from 'react';
import type { InventoryView, Party, WorldAction, WorldCargoDocument, WorldCommandResult, WorldExpeditionView } from '@game/core';
import { ApiError } from '../../../shared/api/http';
import { operationId } from '../../../shared/api/operation-id';
import { inventoryApi } from '../../inventory/api/inventory.api';
import { worldApi } from '../api/world.api';
import { parsePendingWorldCommand, pendingOperationId, type PendingWorldCommand } from './commands';

export function useWorld(playerId: string, characterId: string, party: Party | null, onChanged: () => Promise<void>) {
  const key = `world-operation:${playerId}:${characterId}`;
  const [view, setView] = useState<WorldExpeditionView | null>(null), [inventory, setInventory] = useState<InventoryView | null>(null);
  const [cargo, setCargo] = useState<WorldCargoDocument[]>([]), [ready, setReady] = useState(false), [stale, setStale] = useState(true);
  const [error, setError] = useState(''), [loadError, setLoadError] = useState(''), [cargoError, setCargoError] = useState(''), [inventoryError, setInventoryError] = useState('');
  const [motionReset, setMotionReset] = useState(0);
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [pending, setPending] = useState<PendingWorldCommand | null>(() => {
    try { return parsePendingWorldCommand(sessionStorage.getItem(key)); } catch { return null; }
  });
  const pendingRef = useRef(pending), viewRef = useRef(view), sending = useRef(false), sequence = useRef(0), mounted = useRef(true);
  const changed = useRef(onChanged); changed.current = onChanged; pendingRef.current = pending; viewRef.current = view;
  const inventoryRef = useRef(inventory); inventoryRef.current = inventory;
  const lastLoot = useRef('');
  const collectionAttempt = useRef('');
  const importedDocuments = useRef(new Set<string>());
  const finish = useCallback((command: PendingWorldCommand) => {
    if (pendingRef.current && pendingOperationId(pendingRef.current) === pendingOperationId(command)) {
      sessionStorage.removeItem(key); pendingRef.current = null; setPending(null);
    }
  }, [key]);
  const report = useCallback((result: WorldCommandResult) => {
    const outcome = result.outcome;
    if (outcome.type === 'move') return;
    if (outcome.hit && !outcome.hit.destroyed) { setMessage(`Удар: −${outcome.hit.damage} HP. Прочность ${outcome.hit.hp} / ${outcome.hit.maxHp}.`); return; }
    const loot = outcome.loot.map(entry => `${inventoryRef.current?.definitions.find(item => item.id === entry.itemId)?.name ?? entry.itemId} ×${entry.quantity}`).join(', ');
    if (outcome.type === 'harvest' && outcome.success) lastLoot.current = loot;
    setMessage(outcome.type === 'collect' ? result.inventoryDelivery?.status === 'available' ? `Рюкзак заполнен: ${result.inventoryDelivery.reason ?? 'освободи место'}. Добыча сохранена для получения.` : `В рюкзаке: ${lastLoot.current || 'добыча экспедиции'}.`
      : outcome.type === 'close' ? 'Экспедиция завершена. Добыча доставляется в рюкзак.'
      : outcome.type === 'harvest' ? outcome.success ? `${loot ? `Получено: ${loot}.` : 'Объект добыт без материалов.'} Передаём в рюкзак · +${outcome.xpGained} XP.` : 'Добыча не удалась. Попробуйте ещё раз.'
      : outcome.type === 'build' ? 'Постройка установлена. Материалы списаны из рюкзака.'
      : outcome.type === 'start' ? 'Экспедиция открыта. Выберите участок на карте.' : 'Отряд переместился.');
  }, []);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const attempt = ++sequence.current;
    const live = () => mounted.current && !signal?.aborted && attempt === sequence.current;
    const loadWorld = async () => {
      try {
        const current = await worldApi.current(signal);
        const snapshot = current.worldId ? await worldApi.get(current.worldId, signal) : null;
        const next = snapshot?.status === 'closed' ? null : snapshot;
        if (live()) {
          setView(previous => previous?.id === next?.id && previous?.revision === next?.revision && previous?.partyRevision === next?.partyRevision ? previous : next);
          setStale(current.state === 'closing'); setLoadError(''); setReady(true);
        }
      } catch (reason) {
        if (live()) { setStale(true); setLoadError((reason as Error).message);
          if (reason instanceof ApiError && (reason.status === 403 || reason.status === 409)) setView(null); }
      }
    };
    const inventorySignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000);
    const results = await Promise.allSettled([loadWorld(), worldApi.cargo(characterId, signal), inventoryApi.get(characterId, inventorySignal)]);
    if (!live()) return;
    const documents = results[1], backpack = results[2];
    if (documents.status === 'fulfilled') {
      setCargo(documents.value); setCargoError('');
      const imported = documents.value.filter(document => document.status === 'imported');
      if (imported.some(document => !importedDocuments.current.has(document.id))) void changed.current().catch(() => {});
      importedDocuments.current = new Set(imported.map(document => document.id));
    } else setCargoError(documents.reason.message);
    if (backpack.status === 'fulfilled') { setInventory(backpack.value); setInventoryError(''); } else { setInventory(null); setInventoryError(backpack.reason.message); }
    const saved = pendingRef.current;
    if (!saved || sending.current) return;
    if (saved.kind === 'claim') {
      if (documents.status === 'fulfilled' && documents.value.some(document => document.id === saved.manifestId && document.status === 'imported')) {
        finish(saved); setMessage('Добыча получена в рюкзак.'); void changed.current().catch(() => {});
      }
      return;
    }
    try {
      const receipt = await worldApi.operation(saved.kind === 'start' ? saved.request.worldId : saved.worldId, pendingOperationId(saved), signal);
      if (!live() || receipt.state !== 'complete' || !receipt.result) return;
      finish(saved); setStale(true); setError('');
      if ('outcome' in receipt.result.body) report(receipt.result.body); else { setError(receipt.result.body.message); if (saved.kind === 'action' && saved.command.action.type === 'move') setMotionReset(value => value + 1); }
      void changed.current().catch(() => {});
    } catch { /* An absent receipt or unavailable service keeps the original command retryable. */ }
  }, [characterId, finish, report]);
  const membership = party?.members.find(member => member.playerId === playerId)?.membershipId;
  useEffect(() => {
    mounted.current = true; setView(null); setStale(true); setReady(false);
    const controller = new AbortController(); let loading = false;
    const load = async () => { if (loading || sending.current) return; loading = true;
      try { await refresh(controller.signal); } finally { loading = false; } };
    void load(); const timer = setInterval(() => { void load(); }, 2000);
    window.addEventListener('focus', load);
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener('focus', load); sequence.current++; };
  }, [refresh, party?.id, party?.revision, membership]);
  useEffect(() => () => { mounted.current = false; sequence.current++; }, []);

  const send = async (command: PendingWorldCommand) => {
    if (sending.current || pendingRef.current && pendingOperationId(pendingRef.current) !== pendingOperationId(command)) return;
    // Persist before sending: an uncertain network result must retain the same operation ID.
    try { sessionStorage.setItem(key, JSON.stringify(command)); } catch { setError('Не удалось сохранить действие в браузере. Проверьте доступ к хранилищу.'); return; }
    let motionApplied = false;
    const moving = command.kind === 'action' && command.command.action.type === 'move';
    sending.current = true; pendingRef.current = command; setPending(command); setBusy(true); setError(''); if (command.kind !== 'action' || !['move', 'collect'].includes(command.command.action.type)) setMessage('');
    sequence.current++;
    try {
      if (command.kind === 'claim') { await worldApi.claim(command.manifestId, command.command); if (mounted.current) setMessage('Добыча получена в рюкзак.'); }
      else {
        const result = command.kind === 'start' ? await worldApi.start(command.request) : await worldApi.execute(command.worldId, command.command);
        if (mounted.current) {
          report(result);
          if (moving && result.motion) {
            const current = viewRef.current;
            if (current?.id === result.worldId && result.revision >= current.revision && current.location) {
              const { position, ...motion } = result.motion;
              const next = { ...current, revision: result.revision, location: { ...current.location, position, motion } };
              viewRef.current = next; setView(next); setStale(false); motionApplied = true;
            }
          }
        }
      }
      if (mounted.current) finish(command);
      else sessionStorage.removeItem(key);
      if (!moving) void changed.current().catch(() => {});
    } catch (reason) {
      if (reason instanceof ApiError && reason.status < 500) {
        if (mounted.current) { finish(command); if (moving) setMotionReset(value => value + 1); } else sessionStorage.removeItem(key);
      }
      if (mounted.current) setError(reason instanceof DOMException && reason.name === 'TimeoutError' ? 'Ответ задерживается. Действие сохранено; можно безопасно повторить запрос.' : (reason as Error).message);
    } finally {
      sending.current = false;
      if (mounted.current) { setBusy(false); if (!motionApplied) { setStale(true); void refresh(); } }
    }
  };
  useEffect(() => {
    if (!view?.cargo.length || !ready || stale || busy || pending || sending.current || pendingRef.current) return;
    const revision = `${view.id}:${view.revision}`;
    if (collectionAttempt.current === revision) return;
    collectionAttempt.current = revision;
    void send({ kind: 'action', worldId: view.id, command: { operationId: operationId(), expectedRevision: view.revision, action: { type: 'collect' } } });
  }, [view, ready, stale, busy, pending]);
  return { view, inventory, cargo, ready, stale, error: error || loadError, cargoError, inventoryError, message, busy, motionReset, moving: busy && pending?.kind === 'action' && pending.command.action.type === 'move', pending: !!pending && !busy, refresh: () => { void refresh(); },
    start: () => { if (!pendingRef.current && !sending.current) void send({ kind: 'start', request: { worldId: operationId(), operationId: operationId() } }); },
    act: (action: WorldAction) => { const current = viewRef.current;
      if (current && !pendingRef.current && !sending.current && !stale) { void send({ kind: 'action', worldId: current.id, command: { operationId: operationId(), expectedRevision: current.revision, action } }); return true; } return false; },
    claim: (manifestId: string) => { if (!pendingRef.current && !sending.current) void send({ kind: 'claim', manifestId, command: { operationId: operationId(), characterId } }); },
    retry: () => { if (pendingRef.current) void send(pendingRef.current); },
  };
}
