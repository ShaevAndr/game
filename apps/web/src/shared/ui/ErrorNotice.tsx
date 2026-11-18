export function ErrorNotice({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  if (!message) return null;
  return <div className="error" role="alert">
    {message}
    {onDismiss && <button onClick={onDismiss} aria-label="Закрыть ошибку">×</button>}
  </div>;
}
