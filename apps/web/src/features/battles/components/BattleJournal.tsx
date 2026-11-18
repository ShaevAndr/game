export function BattleJournal({ log }: { log: string[] }) {
  return <section className="panel journal"><div className="section-label">ЛЕТОПИСЬ СРАЖЕНИЯ</div>
        {[...log].reverse().slice(0, 30).map((line, index) => <div key={`${log.length}-${index}`}><span>{String(log.length - index).padStart(2, '0')}</span>{line}</div>)}
      </section>;
}
