// pages/index.tsx
import { useMemo, useState } from 'react'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useAccount, usePublicClient, useWalletClient, useBalance } from 'wagmi'
import { base } from 'wagmi/chains'
import axios, { AxiosError } from 'axios'
import { erc20Abi, getAddress, formatUnits } from 'viem'

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
  sellToken: string; buyToken: string; sellAmountWei: string; takerAddress: string; slippagePerc?: number
}): Promise<ZeroExQuote> {
  const { sellToken, buyToken, sellAmountWei, takerAddress, slippagePerc = 0.005 } = opts
  const { data } = await axios.get('https://base.api.0x.org/swap/v1/quote', {
    params: {
      sellToken,
      buyToken,            // 'ETH' para nativo
      sellAmount: sellAmountWei,
      takerAddress,
      slippagePercentage: slippagePerc.toString(),
    },
  })
  return {
    to: data.to, data: data.data,
    allowanceTarget: data.allowanceTarget || data.spender,
    buyAmount: data.buyAmount, sellAmount: data.sellAmount,
  }
}

export default function Home() {
  const { address, chainId, isConnected } = useAccount()
  const publicClient = usePublicClient()
  const { data: walletClient } = useWalletClient()

  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState('')

  const [showCowCbBtc, setShowCowCbBtc] = useState(false)
  const [showCowEth, setShowCowEth]   = useState(false)
  const [halfAmountWei, setHalfAmountWei] = useState<bigint>(0n)

  const { data: usdcBalUi } = useBalance({ address, token: USDC, chainId: base.id })

  // URLs do widget CoW (iframe) – usam chain 8453 (Base) e tokens por endereço
  const cowUrlCbBtc = useMemo(() => {
    if (!halfAmountWei) return ''
    const sellAmount = formatUnits(halfAmountWei, USDC_DECIMALS) // decimal
    // Formato: https://swap.cow.fi/#/<chainId>/swap/<SELL>/<BUY>?sellAmount=<decimal>&theme=light
    return `https://swap.cow.fi/#/8453/swap/${USDC}/${CBBTC}?sellAmount=${sellAmount}&theme=light&hideNetworkSelector=true`
  }, [halfAmountWei])

  const cowUrlEth = useMemo(() => {
    if (!halfAmountWei) return ''
    const sellAmount = formatUnits(halfAmountWei, USDC_DECIMALS)
    // Para ETH nativo, o CoW aceita 'ETH'
    return `https://swap.cow.fi/#/8453/swap/${USDC}/ETH?sellAmount=${sellAmount}&theme=light&hideNetworkSelector=true`
  }, [halfAmountWei])

  async function handleExecute() {
    try {
      if (!address || !publicClient || !walletClient) return
      if (chainId !== base.id) throw new Error('Troque a rede para Base.')

      setBusy(true)
      setShowCowCbBtc(false)
      setShowCowEth(false)
      setLog('Lendo saldo USDC on-chain...')

      const [dec, rawBal] = await Promise.all([
        publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: 'decimals' }) as Promise<number>,
        publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [address] }) as Promise<bigint>,
      ])
      if (dec !== USDC_DECIMALS) throw new Error('Decimais de USDC inesperados.')
      if (rawBal === 0n) throw new Error('Sem USDC na Base.')

      const half = rawBal / 2n
      setHalfAmountWei(half)
      setLog(p => p + `\nMetade do USDC: ${formatUnits(half, USDC_DECIMALS)}.`)
      setLog(p => p + `\nBuscando cotações na 0x...`)

      // tenta 0x nas duas pernas
      let qCb: ZeroExQuote | null = null
      let qEth: ZeroExQuote | null = null

      try {
        qCb = await get0xQuoteBase({ sellToken: USDC, buyToken: CBBTC, sellAmountWei: half.toString(), takerAddress: address })
      } catch (err) {
        const ax = err as AxiosError<any>
        setLog(p => p + `\n⚠️ cbBTC via 0x falhou: ${ax.response?.status ?? ''} ${ax.response?.data?.reason || ax.message}`)
        setShowCowCbBtc(true)
      }
      try {
        qEth = await get0xQuoteBase({ sellToken: USDC, buyToken: 'ETH', sellAmountWei: half.toString(), takerAddress: address })
      } catch (err) {
        const ax = err as AxiosError<any>
        setLog(p => p + `\n⚠️ ETH via 0x falhou: ${ax.response?.status ?? ''} ${ax.response?.data?.reason || ax.message}`)
        setShowCowEth(true)
      }

      if (qCb) {
        setLog(p => p + `\nEnviando swap USDC → cbBTC (0x)...`)
        const hash = await walletClient.sendTransaction({ to: qCb.to, data: qCb.data, value: 0n, chain: base })
        await publicClient.waitForTransactionReceipt({ hash })
        setLog(p => p + `\n✔️ cbBTC confirmado (0x).`)
      }
      if (qEth) {
        setLog(p => p + `\nEnviando swap USDC → ETH (0x)...`)
        const hash = await walletClient.sendTransaction({ to: qEth.to, data: qEth.data, value: 0n, chain: base })
        await publicClient.waitForTransactionReceipt({ hash })
        setLog(p => p + `\n✔️ ETH confirmado (0x).`)
      }

      if (showCowCbBtc || showCowEth) {
        setLog(p => p + `\n➡️ Para a(s) perna(s) sem rota na 0x, use o Widget da CoW abaixo.`)
      } else {
        setLog(p => p + `\n✅ Concluído!`)
      }
    } catch (e: any) {
      const msg = e?.response?.data?.reason || e?.response?.data?.validationErrors?.[0]?.reason || e?.shortMessage || e?.message || String(e)
      setLog(p => p + `\n❌ Erro: ${msg}`)
      console.error(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main style={{ maxWidth: 820, margin: '40px auto', padding: 16 }}>
      <h1>Executar 50/50 Swap</h1>

      <ConnectButton />

      {isConnected ? (
        <>
          <p style={{ marginTop: 16 }}>
            Saldo em USDC: {usdcBalUi ? `${usdcBalUi.formatted} ${usdcBalUi.symbol}` : '-'}
          </p>

          <button
            onClick={handleExecute}
            disabled={busy}
            style={{ marginTop: 16, padding: '12px 20px', fontSize: 16, fontWeight: 700, borderRadius: 10, background: '#16a34a', color: '#fff', border: 'none', cursor: 'pointer' }}
          >
            {busy ? 'Processando…' : 'Executar 50/50'}
          </button>

          <pre style={{ background: '#0b0b0b', color: '#a7f3d0', padding: 12, marginTop: 16, whiteSpace: 'pre-wrap' }}>
            {log || 'Logs aparecerão aqui.'}
          </pre>

          {showCowCbBtc && cowUrlCbBtc && (
            <>
              <h3 style={{ marginTop: 18 }}>Fallback CoW — USDC → cbBTC (50%)</h3>
              <iframe
                src={cowUrlCbBtc}
                style={{ width: '100%', height: 680, border: 0, borderRadius: 12 }}
                allow="clipboard-write; payment; accelerometer; autoplay; camera; gyroscope; microphone"
              />
            </>
          )}

          {showCowEth && cowUrlEth && (
            <>
              <h3 style={{ marginTop: 18 }}>Fallback CoW — USDC → ETH (50%)</h3>
              <iframe
                src={cowUrlEth}
                style={{ width: '100%', height: 680, border: 0, borderRadius: 12 }}
                allow="clipboard-write; payment; accelerometer; autoplay; camera; gyroscope; microphone"
              />
            </>
          )}

          <p style={{ marginTop: 8, fontSize: 12, opacity: .8 }}>
            Tenha ETH na Base para o gás nas transações via 0x. As ordens da CoW (abaixo) são gasless (assinatura off-chain).
          </p>
        </>
      ) : (
        <p style={{ marginTop: 16 }}>Conecte sua carteira para continuar.</p>
      )}
    </main>
  )
}
