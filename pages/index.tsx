// pages/index.tsx
import { useMemo, useState } from 'react'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useAccount, usePublicClient, useWalletClient, useBalance } from 'wagmi'
import { base } from 'wagmi/chains'
import axios, { AxiosError } from 'axios'
import { erc20Abi, formatUnits, getAddress } from 'viem'
import Image from 'next/image'

// --- Detector de mobile ---
const isMobile = typeof navigator !== 'undefined'
  ? /iphone|ipad|ipod|android/i.test(navigator.userAgent)
  : false

const USDC  = getAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913')
const CBBTC = getAddress('0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf')
const USDC_DECIMALS = 6

type ZeroExQuote = {
  to: `0x${string}`
  data: `0x${string}`
  allowanceTarget?: `0x${string}`
  buyAmount: string
  sellAmount: string
}

async function get0xQuoteBase(opts: {
  sellToken: string
  buyToken: string
  sellAmountWei: string
  takerAddress: string
  slippagePerc?: number
}): Promise<ZeroExQuote> {
  const { sellToken, buyToken, sellAmountWei, takerAddress, slippagePerc = 0.005 } = opts
  const { data } = await axios.get('https://base.api.0x.org/swap/v1/quote', {
    params: {
      sellToken,
      buyToken,
      sellAmount: sellAmountWei,
      takerAddress,
      slippagePercentage: slippagePerc.toString(),
    },
  })
  return {
    to: data.to,
    data: data.data,
    allowanceTarget: data.allowanceTarget || data.spender,
    buyAmount: data.buyAmount,
    sellAmount: data.sellAmount,
  }
}

export default function Home() {
  const { address, chainId, isConnected } = useAccount()
  const publicClient = usePublicClient()
  const { data: walletClient } = useWalletClient()

  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState('')
  const [showCow, setShowCow] = useState(false)
  const [amountCbBtcWei, setAmountCbBtcWei] = useState<bigint>(0n) // 45%
  const [amountEthWei, setAmountEthWei] = useState<bigint>(0n)     // 35%
  const [enableZeroX, setEnableZeroX] = useState(false)

  const { data: usdcBalUi } = useBalance({ address, token: USDC, chainId: base.id })

  // URL CoW para cbBTC com 45%
  const cowUrlCbBtc = useMemo(() => {
    if (!amountCbBtcWei) return ''
    const sellAmount = formatUnits(amountCbBtcWei, USDC_DECIMALS)
    return `https://swap.cow.fi/#/8453/swap/${USDC}/${CBBTC}?sellAmount=${sellAmount}&theme=dark&hideNetworkSelector=true`
  }, [amountCbBtcWei])

  // URL CoW para ETH com 35%
  const cowUrlEth = useMemo(() => {
    if (!amountEthWei) return ''
    const sellAmount = formatUnits(amountEthWei, USDC_DECIMALS)
    return `https://swap.cow.fi/#/8453/swap/${USDC}/ETH?sellAmount=${sellAmount}&theme=dark&hideNetworkSelector=true`
  }, [amountEthWei])

  async function prepareAmountsAndShowCow() {
    if (!address || !publicClient) return
    if (chainId !== base.id) throw new Error('Troque a rede para Base.')
    setShowCow(false)
    setLog('Lendo saldo USDC on-chain...')

    const [dec, rawBal] = await Promise.all([
      publicClient.readContract({
        address: USDC,
        abi: erc20Abi,
        functionName: 'decimals',
      }) as Promise<number>,
      publicClient.readContract({
        address: USDC,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [address],
      }) as Promise<bigint>,
    ])
    if (dec !== USDC_DECIMALS) throw new Error('Decimais de USDC inesperados.')
    if (rawBal === 0n) throw new Error('Sem USDC na Base.')

    // 45% para cbBTC e 35% para ETH (20% permanece em USDC)
    const fortyFive = (rawBal * 45n) / 100n
    const thirtyFive = (rawBal * 35n) / 100n

    setAmountCbBtcWei(fortyFive)
    setAmountEthWei(thirtyFive)

    setLog((p) =>
      p +
      `\n45% (cbBTC): ${formatUnits(fortyFive, USDC_DECIMALS)} USDC.` +
      `\n35% (ETH): ${formatUnits(thirtyFive, USDC_DECIMALS)} USDC.` +
      `\nRestante ~20% permanece em USDC.`
    )
    setShowCow(true)
  }

  async function handleExecuteCowFirst() {
    try {
      setBusy(true)
      await prepareAmountsAndShowCow()
      setEnableZeroX(true)
      setLog((p) => p + `\nWidgets da CoW carregados. Se preferir execução automática, use o fallback 0x abaixo.`)
    } catch (e: any) {
      const msg = e?.shortMessage || e?.message || String(e)
      setLog((p) => p + `\n❌ Erro: ${msg}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main style={{ maxWidth: 900, margin: '40px auto', padding: 16, textAlign: 'center', background: '#000', color: '#fff', borderRadius: 12 }}>
      <div style={{ marginBottom: 20 }}>
        <Image src="/logo-vamos.png" alt="Vamos Pra Crypto" width={160} height={160} priority />
      </div>

      <h1 style={{ color: '#4ade80' }}>Executar Swap Inicial</h1>
      <ConnectButton />

      {isConnected ? (
        <>
          <div style={{ marginTop: 12, display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button
              onClick={handleExecuteCowFirst}
              disabled={busy}
              style={{ padding: '10px 16px', fontWeight: 700, borderRadius: 10, background: '#16a34a', color: '#fff', border: 'none' }}
            >
              {busy ? 'Preparando…' : 'Executar Swap Inicial'}
            </button>
          </div>

          <p style={{ marginTop: 12 }}>
            Saldo em USDC: {usdcBalUi ? `${usdcBalUi.formatted} ${usdcBalUi.symbol}` : '-'}
          </p>

          <pre style={{ background: '#0b0b0b', color: '#a7f3d0', padding: 12, marginTop: 16, whiteSpace: 'pre-wrap', textAlign: 'left' }}>
            {log || 'Logs aparecerão aqui.'}
          </pre>

          {showCow && (amountCbBtcWei > 0n || amountEthWei > 0n) && (
            <>
              <h3 style={{ marginTop: 18, color: '#38bdf8' }}>
                CoW — USDC → cbBTC (45%)
              </h3>

              {isMobile ? (
                <a
                  href={cowUrlCbBtc}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-block',
                    padding: '12px 16px',
                    borderRadius: 10,
                    background: '#1f2937',
                    color: '#fff',
                    textDecoration: 'none',
                    marginBottom: 16,
                  }}
                >
                  Abrir na CoW (nova aba)
                </a>
              ) : (
                <iframe
                  src={cowUrlCbBtc}
                  style={{ width: '100%', height: 680, border: 0, borderRadius: 12 }}
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                  allow="clipboard-write; payment; accelerometer; autoplay; camera; gyroscope; microphone; web-share"
                />
              )}

              <h3 style={{ marginTop: 18, color: '#38bdf8' }}>
                CoW — USDC → ETH (35%)
              </h3>

              {isMobile ? (
                <a
                  href={cowUrlEth}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-block',
                    padding: '12px 16px',
                    borderRadius: 10,
                    background: '#1f2937',
                    color: '#fff',
                    textDecoration: 'none',
                    marginBottom: 16,
                  }}
                >
                  Abrir na CoW (nova aba)
                </a>
              ) : (
                <iframe
                  src={cowUrlEth}
                  style={{ width: '100%', height: 680, border: 0, borderRadius: 12 }}
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                  allow="clipboard-write; payment; accelerometer; autoplay; camera; gyroscope; microphone; web-share"
                />
              )}

              <p style={{ marginTop: 8, fontSize: 12, opacity: .8 }}>
                No iPhone/iPad, carteiras não injetam o provider em iframes. Por isso abrimos a CoW em uma nova aba.
              </p>
            </>
          )}
        </>
      ) : (
        <p style={{ marginTop: 16 }}>Conecte sua carteira para continuar.</p>
      )}
    </main>
  )
}
