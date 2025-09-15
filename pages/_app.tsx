// pages/_app.tsx
import '@rainbow-me/rainbowkit/styles.css'
import { getDefaultConfig, RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit'
import { WagmiConfig } from 'wagmi'
import { base } from 'wagmi/chains'
import type { AppProps } from 'next/app'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'

// Crie um Project ID grátis em https://cloud.walletconnect.com
const wagmiConfig = getDefaultConfig({
  appName: 'VamosPraCrypto',
  projectId: 'SUA_WALLETCONNECT_PROJECT_ID_AQUI',
  chains: [base],
  ssr: true, // habilita SSR no Wagmi/RainbowKit (ok para Next)
})

export default function App({ Component, pageProps }: AppProps) {
  // garante um QueryClient único por mount
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
