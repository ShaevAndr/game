import { BattlefieldMoveReport, tileTypeNames, tileTypes, RemovedElements } from '@game/core';

function describe(removed: RemovedElements) {
  return tileTypes.filter(type => removed.byType[type]).map(type => `${tileTypeNames[type]}: ${removed.byType[type]}`).join(' · ') || 'Нет сокращений';
}
export function BattlefieldSummary({ report, actorName }: { report?: BattlefieldMoveReport & { continuation?: boolean }; actorName?: string }) {
  if (!report) return null;
  return <div className="battlefield-summary" aria-label="Результат перестановки">
    <div className="section-label">{report.continuation ? 'КАСКАДЫ' : 'СОКРАЩЕНИЯ'} · {actorName}</div>
    {!report.continuation && <div><strong>Прямое совпадение: {report.direct.count}</strong><span>{describe(report.direct)}</span></div>}
    <div><strong>При заполнении: {report.generated.count}</strong><span>{describe(report.generated)}</span></div>
    <p className="hint">Всего: {report.total.count} · Каскадов: {report.cascades}{report.shuffled ? ' · Поле обновлено' : ''}</p>
  </div>;
}
