// pages/_app.tsx
import '@rainbow-me/rainbowkit/styles.css'
import { getDefaultConfig, RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit'
import { WagmiConfig } from 'wagmi'
import { base } from 'wagmi/chains'
import type { AppProps } from 'next/app'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'

// Configuração com seu Project ID válido da WalletConnect
const wagmiConfig = getDefaultConfig({
  appName: 'VamosPraCrypto',
  projectId: 'de7c30118e4d4ec60397c81845e63ae9',
  chains: [base],
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
