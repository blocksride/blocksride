# Ratio Client

Frontend application for the Ratio grid-based prediction platform.

## Tech Stack

- **Framework**: React 18 + Vite
- **Language**: TypeScript
- **UI Components**: ShadCN UI
- **Styling**: Tailwind CSS
- **Web3**: Privy (authentication) + Wagmi (blockchain interaction)
- **State Management**: React Context

## Quick Start

```bash
npm install
npm run dev
```

The app will be available at `http://localhost:5173`

## Environment Variables

Create a `.env.local` file:

```env
VITE_SERVER_URL=http://localhost:8080
VITE_RATIO_VAULT_ADDRESS=<your_vault_contract_address>
VITE_RPC_URL=http://127.0.0.1:8545
```

## Adding ShadCN Components

```bash
npx shadcn@latest add COMPONENT_NAME
```

## Project Structure

```
src/
├── components/     # Reusable UI components
├── pages/          # Page components
├── providers/      # Context providers (Web3, Theme)
├── styles/         # Global styles and themes
└── main.tsx        # Application entry point
```

## Customizing Theme

Update `src/styles/index.css` with themes from [ShadCN Themes](https://ui.shadcn.com/themes)

## WebSocket Connection

The client connects to the backend WebSocket for real-time ETH-USD price updates:

```typescript
const ws = new WebSocket('ws://localhost:8080/api/ws')
```

## Building for Production

```bash
npm run build
```

The optimized build will be in the `dist/` directory.
