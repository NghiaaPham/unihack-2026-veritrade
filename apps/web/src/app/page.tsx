const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const CHAIN_ID = process.env.NEXT_PUBLIC_CHAIN_ID ?? '43113';

export default function HomePage() {
  return (
    <main>
      <h1>VeriTrade</h1>
      <p>
        Verifiable trade settlement on Avalanche. The monorepo scaffold is in place; business
        features land in later milestones.
      </p>

      <h2>Services</h2>
      <ul>
        <li>
          Web health: <a href="/api/health">/api/health</a>
        </li>
        <li>
          API health: <a href={`${API_URL}/health`}>{API_URL}/health</a>
        </li>
        <li>
          Avalanche Fuji chain id: <code>{CHAIN_ID}</code>
        </li>
      </ul>
    </main>
  );
}
