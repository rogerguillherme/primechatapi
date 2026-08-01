/**
 * Fundo ambiente com movimento de fumaça (blobs desfocados em deriva lenta).
 * Puramente decorativo — fica atrás de todo o conteúdo.
 */
export function SmokeBackground() {
  return (
    <div className="smoke-field" aria-hidden="true">
      <div className="smoke-veil" />
      <div className="smoke-blob smoke-blob-1" />
      <div className="smoke-blob smoke-blob-2" />
      <div className="smoke-blob smoke-blob-3" />
    </div>
  );
}
