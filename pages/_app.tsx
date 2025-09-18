// pages/_app.tsx
import '@rainbow-me/rainbowkit/styles.css'
import {
  RainbowKitProvider,
  darkTheme,
  connectorsForWallets,
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

const projectId = 'de7c30118e4d4ec60397c81845e63ae9' // seu WalletConnect Project ID
const appName = 'VamosPraCrypto'

// ✅ O segredo: defina como tuplo readonly
const chains = [base] as const

// Conectores (garante MetaMask e Browser Wallet/Injected)
const connectors = connectorsForWallets(
  [
    {
      groupName: 'Recommended',
      wallets: [
        metaMaskWallet,
        injectedWallet,       // aparece como "Browser Wallet" quando apropriado
        coinbaseWallet,
        walletConnectWallet,
      ],
    },
  ],
  { appName, projectId }
)

// Transports (RPC) – use o seu RPC/Alchemy se quiser
const wagmiConfig = createConfig({
  chains, // agora é readonly [base]
  transports: {
    [base.id]: http(), // ou http(`https://base-mainnet.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_KEY}`)
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
