export function LensStatus({ message }: { message: string }) {
  return (
    <output className="ml-sr-status" data-marimo-lens-status aria-live="polite" aria-atomic="true">
      {message}
    </output>
  );
}
