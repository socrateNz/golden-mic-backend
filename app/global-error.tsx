'use client';

export default function GlobalError({
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <html lang="fr">
      <body>
        <h2>Une erreur est survenue</h2>
        <button onClick={() => unstable_retry()}>Réessayer</button>
      </body>
    </html>
  );
}