import '@rainbow-me/rainbowkit/styles.css'
import { getDefaultConfig, RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit'
import { WagmiConfig } from 'wagmi'
import { base } from 'wagmi/chains'
import type { AppProps } from 'next/app'

const config = getDefaultConfig({
  appName: 'VamosPraCrypto',
  projectId: 'SUA_WALLETCONNECT_PROJECT_ID_AQUI',
  chains: [base],
  ssr: true,
})

export default function App({ Component, pageProps }: AppProps) {
  return (
    <WagmiConfig config={config}>
      <RainbowKitProvider theme={darkTheme()} modalSize="compact">
        <Component {...pageProps} />
      </RainbowKitProvider>
    </WagmiConfig>
  )
}
