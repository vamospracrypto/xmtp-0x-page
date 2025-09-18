// pages/_app.tsx
import '@rainbow-me/rainbowkit/styles.css'
import {
  RainbowKitProvider,
  darkTheme,
  connectorsForWallets
} from '@rainbow-me/rainbowkit'
import {
  metaMaskWallet,
  walletConnectWallet,
  coinbaseWallet,
  injectedWallet,
} from '@rainbow-me/rainbowkit/wallets'
import { WagmiConfig, createConfig, http } from 'wagmi'
import { base } from 'wagmi/chains'
import type { AppProps } from 'next/app'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'

const projectId = 'de7c30118e4d4ec60397c81845e63ae9' // WalletConnect
const appName = 'VamosPraCrypto'
const chains = [base]

// 🔧 Conectores explícitos (garante MetaMask e Browser Wallet)
const connectors = connectorsForWallets([
  {
    groupName: 'Recommended',
    wallets: [
      // Mostra a bala MetaMask quando disponível (mobile + desktop)
      metaMaskWallet({ projectId, chains }),
      // Fallback genérico para qualquer carteira injetada (no mobile mostra "Browser Wallet")
      injectedWallet({ chains, shimDisconnect: true }),
      // Outras opções
      coinbaseWallet({ appName, chains }),
      walletConnectWallet({ projectId, chains }),
    ],
  },
])

// Transports (RPC) – use o que já tem configurado no projeto
const wagmiConfig = createConfig({
  chains,
  transports: {
    [base.id]: http(), // pode trocar por seu RPC/Alchemy se quiser
  },
  connectors,
  ssr: true,
})

export default function App({ Component, pageProps }: AppProps) {
  const [queryClient] = useState(() => new QueryClient())
  return (
    <QueryClientProvider client={queryClient}>
      <WagmiConfig config={wagmiConfig}>
        <RainbowKitProvider theme={darkTheme()} modalSize="compact">
          <Component {...pageProps} />
        </RainbowKitProvider>
      </WagmiConfig>
    </QueryClientProvider>
  )
}
